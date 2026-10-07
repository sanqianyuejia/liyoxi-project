// 审批读侧（W1-06②）：可读类型、数据范围与动作由同一判定生成；GET 只读。
import {
  ApprovalDetailSchema,
  ApprovalDecisionViewSchema,
  ApprovalItemSchema,
} from "@liyoxi/contract";
import type {
  AdminPage,
  ApprovalCounts,
  ApprovalDetail,
  ApprovalDecisionView,
  ApprovalFilter,
  ApprovalItem,
  ApprovalListQuery,
  ApprovalKind,
} from "@liyoxi/contract";
import type { Prisma } from "@liyoxi/db";
import { addDays, calendarDate, endOfDay, startOfDay } from "@liyoxi/shared/time";
import { dueAt } from "@liyoxi/shared/workcal";
import { hasPermission, satisfiesLevel } from "../authz/index.js";
import type { StaffContext } from "../authz/index.js";
import { paramsAt } from "../config/index.js";
import { AppError } from "../kernel/index.js";
import type { Clock, Tx } from "../kernel/index.js";
import { loadWorkCalendar, workHoursAt } from "../sla/index.js";
import type { ApprovalKindRegistration, ApprovalRow } from "./kinds.js";
import {
  approvalHistory,
  detailFacts,
  findApproval,
  approvalScopes,
  merchantLabels,
  pointsAdjustments,
  readApprovals,
  reasonLabels,
  staffBriefs,
  staffFactsOf,
} from "./repo.js";

export interface ApprovalReads {
  list(tx: Tx, staff: StaffContext, query: ApprovalListQuery): Promise<AdminPage<ApprovalItem>>;
  summary(tx: Tx, staff: StaffContext, query?: ApprovalFilter): Promise<ApprovalCounts>;
  get(tx: Tx, staff: StaffContext, approvalId: string): Promise<ApprovalDetail>;
  decisionView(tx: Tx, staff: StaffContext, approvalId: string): Promise<ApprovalDecisionView>;
  countTodo(tx: Tx, staff: StaffContext, query?: ApprovalFilter): Promise<number>;
}
interface ReadDeps {
  readonly kinds: ReadonlyMap<string, ApprovalKindRegistration>;
  readonly clock: Clock;
}
interface Visible {
  row: ApprovalRow;
  kind: ApprovalKindRegistration;
  handlerId: string | null | undefined;
  scoped: boolean;
  overdue: boolean;
  actions: ApprovalItem["actions"];
}

const roleQueue = (kind: ApprovalKindRegistration, ctx: StaffContext): boolean =>
  kind.roleQueue === true && hasPermission(ctx, kind.decidePermission);
const readable = (kind: ApprovalKindRegistration, ctx: StaffContext): boolean =>
  roleQueue(kind, ctx) ||
  kind.viewModules.some((module) => satisfiesLevel(ctx.moduleLevels[module], "view"));
const mine = (row: ApprovalRow, ctx: StaffContext): boolean =>
  row.requesterStaffId === ctx.staff.id;
const inMonth = (at: Date | null, now: Date): boolean =>
  at !== null && calendarDate(at).slice(0, 7) === calendarDate(now).slice(0, 7);
const doneToday = (row: ApprovalRow, now: Date): boolean =>
  row.status !== "pending" &&
  row.decidedAt !== null &&
  calendarDate(row.decidedAt) === calendarDate(now);

/** 唯一 todo 判定：列表、每类计数、total.todo 与导出的 countTodo 全部调用它。 */
export function countTodo(rows: readonly Pick<Visible, "actions">[]): number {
  return rows.filter(
    (item) => item.actions.includes("approve") || item.actions.includes("approve-review"),
  ).length;
}

export function createApprovalReads(deps: ReadDeps): ApprovalReads {
  async function visible(
    tx: Tx,
    ctx: StaffContext,
    query: ApprovalFilter,
    explicit = false,
  ): Promise<Visible[]> {
    const kinds = [...deps.kinds.entries()].filter(([, kind]) => readable(kind, ctx));
    if (explicit && query.kind?.some((key) => !kinds.some(([kind]) => kind === key)))
      throw new AppError("PERMISSION_DENIED");
    const keys = kinds
      .map(([key]) => key)
      .filter((key) => query.kind === undefined || query.kind.includes(key));
    if (keys.length === 0) return [];
    const where: Prisma.ApprovalRequestWhereInput = {
      kind: { in: keys },
      ...(query.storeId === undefined ? {} : { storeId: query.storeId }),
      ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
      ...(query.q === undefined
        ? {}
        : {
            OR: [
              { requestNo: { startsWith: query.q } },
              { summarySnapshot: { path: ["title"], string_contains: query.q } },
            ],
          }),
      ...(query.submittedFrom === undefined && query.submittedTo === undefined
        ? {}
        : {
            submittedAt: {
              ...(query.submittedFrom === undefined
                ? {}
                : { gte: startOfDay(query.submittedFrom) }),
              ...(query.submittedTo === undefined ? {} : { lt: endOfDay(query.submittedTo) }),
            },
          }),
    };
    return evaluate(tx, ctx, await readApprovals(tx, where), query.overdue);
  }

  async function evaluate(
    tx: Tx,
    ctx: StaffContext,
    rows: readonly ApprovalRow[],
    filterOverdue?: boolean,
  ): Promise<Visible[]> {
    const now = deps.clock.now();
    const staffIds = rows.flatMap((row) =>
      row.requesterStaffId === null ? [] : [row.requesterStaffId],
    );
    const requesterFacts = await staffFactsOf(tx, staffIds);
    const scope = await approvalScopes(tx, ctx.scope, rows);
    const values = await paramsAt(tx, ["approval.escalate_workdays"], now);
    const hours = await workHoursAt(tx, now);
    const calendar =
      rows.length === 0
        ? null
        : await loadWorkCalendar(
            tx,
            {
              from: rows.reduce(
                (date, row) =>
                  calendarDate(row.submittedAt) < date ? calendarDate(row.submittedAt) : date,
                calendarDate(now),
              ),
              to: addDays(calendarDate(now), values["approval.escalate_workdays"] * 4 + 45),
            },
            hours,
          );
    const result: Visible[] = [];
    const permissions = new Map(
      [...deps.kinds].map(([key, kind]) => [
        key,
        {
          readable: readable(kind, ctx),
          roleQueue: roleQueue(kind, ctx),
          decide: hasPermission(ctx, kind.decidePermission),
        },
      ]),
    );
    const overdueBySubmittedAt = new Map<number, boolean>();
    for (const row of rows) {
      const kind = deps.kinds.get(row.kind);
      const permission = permissions.get(row.kind);
      if (kind === undefined || !permission?.readable) continue;
      // 全部范围与角色队列已确定 scoped；列表只给实际分页项解析当前处理人。
      const globallyScoped = permission.roleQueue || ctx.scope.kind === "all";
      const handlerId = globallyScoped ? undefined : ((await kind.handlerOf?.(tx, row)) ?? null);
      const scoped = globallyScoped || scope(row, handlerId ?? null);
      if (!scoped && !mine(row, ctx)) continue;
      let overdue = false;
      if (row.status === "pending") {
        if (row.dueAt !== null) overdue = row.dueAt < now;
        else if (calendar !== null) {
          const submittedAt = row.submittedAt.getTime();
          let calculated = overdueBySubmittedAt.get(submittedAt);
          if (calculated === undefined) {
            calculated =
              dueAt(calendar, row.submittedAt, {
                amount: values["approval.escalate_workdays"],
                unit: "work_days",
              }).at < now;
            overdueBySubmittedAt.set(submittedAt, calculated);
          }
          overdue = calculated;
        }
      }
      if (filterOverdue !== undefined && overdue !== filterOverdue) continue;
      const actions: ApprovalItem["actions"] = [];
      if (row.status === "pending") {
        const group =
          !kind.groupBound ||
          ctx.staff.roleKey === "super_admin" ||
          (ctx.staff.isLead &&
            ctx.staff.staffGroupId !== null &&
            ctx.staff.staffGroupId === row.requesterStaffGroupId);
        if (
          permission.decide &&
          scoped &&
          !mine(row, ctx) &&
          row.submitActorId !== ctx.staff.id &&
          group
        )
          actions.push(
            ...(row.kind === "transfer_confirm"
              ? (["approve-review", "reject-review"] as const)
              : (["approve", "reject"] as const)),
          );
        if (
          row.category === "approval" &&
          kind.operations.withdraw !== null &&
          (mine(row, ctx) ||
            (permission.decide &&
              scoped &&
              group &&
              row.requesterStaffId !== null &&
              requesterFacts.get(row.requesterStaffId)?.status !== "active"))
        )
          actions.push("withdraw");
      }
      result.push({ row, kind, handlerId, scoped, overdue, actions });
    }
    return result;
  }

  async function items(tx: Tx, visibleRows: readonly Visible[]): Promise<ApprovalItem[]> {
    const rows: Array<Visible & { handlerId: string | null }> = [];
    for (const entry of visibleRows)
      rows.push({
        ...entry,
        handlerId:
          entry.handlerId === undefined
            ? ((await entry.kind.handlerOf?.(tx, entry.row)) ?? null)
            : entry.handlerId,
      });
    const [staff, merchants, reasons] = await Promise.all([
      staffBriefs(
        tx,
        rows.flatMap(({ row, handlerId }) =>
          [
            row.requesterStaffId,
            row.decidedByStaffId,
            handlerId,
            row.submitActorType === "staff" ? row.submitActorId : null,
          ].filter((id): id is string => id !== null),
        ),
      ),
      merchantLabels(
        tx,
        rows.flatMap(({ row }) =>
          row.submitActorType === "merchant" && row.submitActorId !== null
            ? [row.submitActorId]
            : [],
        ),
      ),
      reasonLabels(
        tx,
        rows.flatMap(({ row }) => [...row.reasonCodes]),
      ),
    ]);
    return Promise.all(
      rows.map(async ({ row, kind, handlerId, overdue, actions }) => {
        const brief = (id: string | null) => (id === null ? null : (staff.get(id) ?? null));
        const label =
          row.submitActorType === "system"
            ? "系统"
            : row.submitActorType === "merchant"
              ? (merchants.get(row.submitActorId ?? "") ?? "老板 · 商家")
              : (brief(row.submitActorId)?.name ?? "员工");
        return ApprovalItemSchema.parse({
          approvalId: row.id,
          requestNo: row.requestNo,
          kind: row.kind,
          category: row.category,
          status: row.status,
          roundNo: row.roundNo,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          entityId: row.entityId,
          storeId: row.storeId,
          deliveryTicketId: row.deliveryTicketId,
          summary: row.summary,
          domain: row.summary.domain ?? { type: row.subjectType, id: row.subjectId },
          badges: [
            ...new Set([
              ...((await kind.badges?.(tx, row)) ?? []),
              ...(overdue ? ["overdue"] : []),
            ]),
          ],
          submitter: { actorType: row.submitActorType, actorId: row.submitActorId, label },
          requester: brief(row.requesterStaffId),
          handler: brief(handlerId),
          submittedAt: row.submittedAt.toISOString(),
          dueAt: row.dueAt?.toISOString() ?? null,
          decidedBy: brief(row.decidedByStaffId),
          isDecidedBySystem: row.isDecidedBySystem,
          decidedAt: row.decidedAt?.toISOString() ?? null,
          decisionNote: row.decisionNote,
          reasons: row.reasonCodes.map((code) => ({ code, name: reasons.get(code) ?? code })),
          lockVersion: row.lockVersion,
          actions,
        });
      }),
    );
  }

  async function one(
    tx: Tx,
    staff: StaffContext,
    approvalId: string,
  ): Promise<{ entry: Visible; item: ApprovalItem }> {
    const row = await findApproval(tx, approvalId);
    const entry = row === null ? undefined : (await evaluate(tx, staff, [row]))[0];
    if (entry === undefined) throw new AppError("NOT_FOUND");
    return { entry, item: (await items(tx, [entry]))[0]! };
  }

  return {
    async list(tx, staff, query) {
      let rows = await visible(tx, staff, query, true);
      if (query.tab === "todo") rows = rows.filter((row) => countTodo([row]) > 0);
      if (query.tab === "submitted") rows = rows.filter(({ row }) => mine(row, staff));
      if (query.tab === "done_today")
        rows = rows.filter(({ row }) => doneToday(row, deps.clock.now()));
      if ((query.tab === "all" || query.tab === "submitted") && query.status !== undefined)
        rows = rows.filter(({ row }) => query.status!.includes(row.status));
      const sort = query.sort ?? (query.tab === "todo" ? "due" : "-submittedAt");
      rows.sort((a, b) => {
        const time = (row: ApprovalRow) =>
          sort === "due"
            ? (row.dueAt?.getTime() ?? Infinity)
            : sort === "-decidedAt"
              ? -(row.decidedAt?.getTime() ?? 0)
              : -row.submittedAt.getTime();
        const delta = time(a.row) - time(b.row);
        return Number.isNaN(delta) || delta === 0 ? a.row.id.localeCompare(b.row.id) : delta;
      });
      return {
        items: await items(
          tx,
          rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
        ),
        page: query.page,
        pageSize: query.pageSize,
        total: query.tab === "todo" ? countTodo(rows) : rows.length,
      };
    },
    async summary(tx, staff, query = {}) {
      const rows = await visible(tx, staff, query);
      const now = deps.clock.now();
      const counts: ApprovalCounts["items"] = [...deps.kinds.entries()]
        .filter(
          ([key, kind]) =>
            readable(kind, staff) && (query.kind === undefined || query.kind.includes(key)),
        )
        .map(([key]) => {
          const subset = rows.filter(({ row }) => row.kind === key);
          const byStatus = { pending: 0, approved: 0, rejected: 0, withdrawn: 0 };
          for (const { row } of subset) byStatus[row.status] += 1;
          return {
            kind: key as ApprovalKind,
            todo: countTodo(subset),
            submitted: subset.filter(({ row }) => mine(row, staff)).length,
            doneToday: subset.filter(({ row }) => doneToday(row, now)).length,
            all: subset.length,
            byStatus,
            overdue: subset.filter((row) => row.overdue).length,
            approvedThisMonth: subset.filter(
              ({ row }) => row.status === "approved" && inMonth(row.decidedAt, now),
            ).length,
            rejectedThisMonth: subset.filter(
              ({ row }) => row.status === "rejected" && inMonth(row.decidedAt, now),
            ).length,
          };
        });
      const pointsAdjustMonth = counts.some((count) => count.kind === "points_adjust")
        ? { increasePoints: 0, decreasePoints: 0 }
        : null;
      if (pointsAdjustMonth !== null) {
        const ids = rows
          .filter(
            ({ row }) =>
              row.kind === "points_adjust" &&
              row.status === "approved" &&
              inMonth(row.decidedAt, now),
          )
          .map(({ row }) => row.id);
        for (const row of await pointsAdjustments(tx, ids))
          pointsAdjustMonth[row.direction === "increase" ? "increasePoints" : "decreasePoints"] +=
            row.adjustPoints;
      }
      return {
        items: counts,
        total: { todo: countTodo(rows), overdue: rows.filter((row) => row.overdue).length },
        pointsAdjustMonth,
      };
    },
    async get(tx, staff, id) {
      const { entry, item } = await one(tx, staff, id);
      const [facts, history] = await Promise.all([detailFacts(tx, id), approvalHistory(tx, id)]);
      const [staffNames, merchants] = await Promise.all([
        staffBriefs(
          tx,
          history.flatMap((row) =>
            row.actorType === "staff" && row.actorId !== null ? [row.actorId] : [],
          ),
        ),
        merchantLabels(
          tx,
          history.flatMap((row) =>
            row.actorType === "merchant" && row.actorId !== null ? [row.actorId] : [],
          ),
        ),
      ]);
      return ApprovalDetailSchema.parse({
        ...item,
        checklist:
          facts.checklistCode === null
            ? null
            : {
                code: facts.checklistCode,
                versionNo: facts.checklistVersionNo,
                result: facts.checklistResult,
              },
        confirmChecks: facts.confirmChecks,
        sla: facts.slaSnapshot,
        timeline: history.map((row) => ({
          fromState: row.fromState,
          toState: row.toState,
          event: row.event,
          actorType: row.actorType,
          actorLabel:
            row.actorType === "system"
              ? "系统"
              : row.actorType === "staff"
                ? (staffNames.get(row.actorId ?? "")?.name ?? "员工")
                : (merchants.get(row.actorId ?? "") ?? "老板 · 商家"),
          occurredAt: row.occurredAt.toISOString(),
          reasonCode: row.reasonCode,
          note: row.note,
          elapsedWorkMin: row.elapsedWorkMin,
        })),
        operations: entry.kind.operations,
      });
    },
    async decisionView(tx, staff, id) {
      return ApprovalDecisionViewSchema.parse((await one(tx, staff, id)).item);
    },
    async countTodo(tx, staff, query = {}) {
      return countTodo(await visible(tx, staff, query));
    },
  };
}
