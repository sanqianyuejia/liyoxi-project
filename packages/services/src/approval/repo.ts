// approval 的仓储（W1-06）：本模块读写库的语句只在这里。
// 同层的表（staff、store、entity）只读查表，不引对方模块（docs/plan/tasks/README.md 第 7.5 节）；
// 下层 config 的字典与清单模板在事务里直接读一行，不走它的缓存：守卫要看提交那一刻库里的值。
import { ApprovalSummarySchema } from "@liyoxi/contract";
import type { ApprovalKind, ApprovalStatus } from "@liyoxi/contract";
import type { ApprovalRequest, Prisma } from "@liyoxi/db";

import { entityScope, scopeCovers, storeScope } from "../authz/index.js";
import type { DataScope } from "../authz/index.js";
import type { Tx } from "../kernel/index.js";

import type {
  ApprovalCategory,
  ApprovalKindRegistration,
  ApprovalRow,
  ApprovalSubmitActorType,
} from "./kinds.js";

/** 读一行；没有返回 null。摘要按契约的结构读回：写入时校验过，读不回来即库被人改坏 */
export async function findApproval(tx: Tx, id: string): Promise<ApprovalRow | null> {
  const row = await tx.approvalRequest.findUnique({ where: { id } });
  if (row === null) return null;
  return approvalRow(row);
}

export function approvalRow(row: ApprovalRequest): ApprovalRow {
  return {
    id: row.id,
    requestNo: row.requestNo,
    kind: row.kind as ApprovalKind,
    category: row.category as ApprovalCategory,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    entityId: row.entityId,
    storeId: row.storeId,
    deliveryTicketId: row.deliveryTicketId,
    roundNo: row.roundNo,
    status: row.status as ApprovalStatus,
    summary: ApprovalSummarySchema.parse(row.summarySnapshot),
    reasonCodes: row.reasonCodes,
    decisionNote: row.decisionNote,
    submitActorType: row.submitActorType as ApprovalSubmitActorType,
    submitActorId: row.submitActorId,
    requesterStaffId: row.requesterStaffId,
    requesterStaffGroupId: row.requesterStaffGroupId,
    submittedAt: row.submittedAt,
    dueAt: row.dueAt,
    decidedByStaffId: row.decidedByStaffId,
    isDecidedBySystem: row.isDecidedBySystem,
    decidedAt: row.decidedAt,
    dedupeKey: row.dedupeKey,
    lockVersion: row.lockVersion,
  };
}

/** 读侧的基础过滤；当前处理人与范围留给每个 kind 的读端口判定。 */
export async function readApprovals(tx: Tx, where: Prisma.ApprovalRequestWhereInput) {
  return (await tx.approvalRequest.findMany({ where })).map(approvalRow);
}

/** 只读 staff 展示列：不调用同层 staff 模块，批量取当前姓名、角色与状态。 */
export async function staffBriefs(tx: Tx, ids: readonly string[]) {
  const rows = await tx.staff.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, staffNo: true, name: true, staffRoleKey: true, isLead: true, status: true },
  });
  return new Map(
    rows.map(({ id, staffRoleKey, ...rest }) => [
      id,
      { staffId: id, roleKey: staffRoleKey, ...rest },
    ]),
  );
}

export async function merchantLabels(tx: Tx, ids: readonly string[]) {
  const rows = await tx.merchantUser.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, displayName: true },
  });
  return new Map(rows.map((row) => [row.id, `老板 · ${row.displayName ?? "商家"}`]));
}

export async function reasonLabels(tx: Tx, codes: readonly string[]) {
  const rows = await tx.dictItem.findMany({
    where: { dictTypeKey: "reject_reason", code: { in: [...new Set(codes)] } },
    select: { code: true, name: true },
  });
  return new Map(rows.map((row) => [row.code, row.name]));
}

export function detailFacts(tx: Tx, id: string) {
  return tx.approvalRequest.findUniqueOrThrow({ where: { id } });
}
export function approvalHistory(tx: Tx, id: string) {
  return tx.statusTransition.findMany({
    where: { machine: "approval_request", stateField: "status", subjectId: id },
    orderBy: { seq: "asc" },
  });
}
export function pointsAdjustments(tx: Tx, ids: readonly string[]) {
  return tx.pointAdjustmentRequest.findMany({
    where: { approvalRequestId: { in: [...ids] } },
    select: { direction: true, adjustPoints: true },
  });
}

export interface NewApproval {
  readonly id: string;
  readonly requestNo: string | null;
  readonly kind: string;
  readonly category: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly entityId: string | null;
  readonly storeId: string | null;
  readonly deliveryTicketId: string | null;
  readonly roundNo: number;
  readonly summary: object;
  readonly submitActorType: string;
  readonly submitActorId: string | null;
  readonly submitClient: string | null;
  readonly requesterStaffId: string | null;
  readonly requesterStaffGroupId: string | null;
  readonly dedupeKey: string | null;
  readonly idempotencyKey: string | null;
  readonly now: Date;
}

/**
 * 插入一张待审的审批单。同对象已有在途单（撞 uq_approval_request_dedupe_key_pending）时不插、返回 false：
 * 用 ON CONFLICT 而不是接唯一冲突的报错，事务不会被中止；并发的两个提交，后到的等前一个提交后同样返回 false。
 */
export async function insertPending(tx: Tx, row: NewApproval): Promise<boolean> {
  const inserted = await tx.$executeRaw`
    INSERT INTO approval_request (
      id, request_no, kind, category, subject_type, subject_id, entity_id, store_id,
      delivery_ticket_id, round_no, status, summary_snapshot, submit_actor_type, submit_actor_id,
      submit_client, requester_staff_id, requester_staff_group_id, submitted_at, dedupe_key,
      idempotency_key, created_at, updated_at)
    VALUES (
      ${row.id}::uuid, ${row.requestNo}, ${row.kind}, ${row.category}, ${row.subjectType},
      ${row.subjectId}::uuid, ${row.entityId}::uuid, ${row.storeId}::uuid,
      ${row.deliveryTicketId}::uuid, ${row.roundNo}, 'pending', ${JSON.stringify(row.summary)}::jsonb,
      ${row.submitActorType}, ${row.submitActorId}::uuid, ${row.submitClient},
      ${row.requesterStaffId}::uuid, ${row.requesterStaffGroupId}::uuid, ${row.now},
      ${row.dedupeKey}, ${row.idempotencyKey}, ${row.now}, ${row.now})
    ON CONFLICT (dedupe_key) WHERE status = 'pending' AND dedupe_key IS NOT NULL DO NOTHING`;
  return inserted === 1;
}

/** 这个去重键上在途的那一张 */
export function findPendingByDedupeKey(
  tx: Tx,
  dedupeKey: string,
): Promise<{ id: string; requestNo: string | null } | null> {
  return tx.approvalRequest.findFirst({
    where: { dedupeKey, status: "pending" },
    select: { id: true, requestNo: true },
  });
}

export interface StaffFacts {
  readonly status: string;
  readonly isLead: boolean;
  readonly staffGroupId: string | null;
}

/** 员工行的几列：是否启用、是否主管、所在组。调用之前这些行已经加了共享锁 */
export async function staffFactsOf(
  tx: Tx,
  ids: readonly string[],
): Promise<ReadonlyMap<string, StaffFacts>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.staff.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, status: true, isLead: true, staffGroupId: true },
  });
  return new Map(rows.map(({ id, ...facts }) => [id, facts]));
}

/**
 * 对象在不在这名员工的数据范围内。有当前处理人的类型（链接核验）看处理人；否则按门店、再按主体；
 * 平台级的类型（受控财务配置）没有归属，不套范围。
 */
export async function inScope(
  tx: Tx,
  scope: DataScope,
  row: ApprovalRow,
  kind: Pick<ApprovalKindRegistration, "handlerOf">,
): Promise<boolean> {
  if (scope.kind === "all") return true;
  const handler = (await kind.handlerOf?.(tx, row)) ?? null;
  if (handler !== null) return scopeCovers(scope, handler);
  if (row.storeId !== null) {
    const store = await tx.store.findFirst({
      where: { AND: [{ id: row.storeId }, storeScope(scope)] },
      select: { id: true },
    });
    return store !== null;
  }
  if (row.entityId !== null) {
    const entity = await tx.entity.findFirst({
      where: { AND: [{ id: row.entityId }, entityScope(scope)] },
      select: { id: true },
    });
    return entity !== null;
  }
  return true;
}

/** 读列表批量套同一套 authz 谓词，避免每张审批单各查一次门店与主体。 */
export async function approvalScopes(tx: Tx, scope: DataScope, rows: readonly ApprovalRow[]) {
  if (scope.kind === "all") return () => true;
  const stores = rows.flatMap((row) => (row.storeId === null ? [] : [row.storeId]));
  const entities = rows.flatMap((row) =>
    row.storeId === null && row.entityId !== null ? [row.entityId] : [],
  );
  const [storeRows, entityRows] = await Promise.all([
    tx.store.findMany({
      where: { AND: [{ id: { in: [...new Set(stores)] } }, storeScope(scope)] },
      select: { id: true },
    }),
    tx.entity.findMany({
      where: { AND: [{ id: { in: [...new Set(entities)] } }, entityScope(scope)] },
      select: { id: true },
    }),
  ]);
  const storeIds = new Set(storeRows.map((row) => row.id));
  const entityIds = new Set(entityRows.map((row) => row.id));
  return (row: ApprovalRow, handlerId: string | null): boolean =>
    handlerId !== null
      ? scopeCovers(scope, handlerId)
      : row.storeId !== null
        ? storeIds.has(row.storeId)
        : row.entityId !== null
          ? entityIds.has(row.entityId)
          : true;
}

/** codes 里不是字典 reject_reason 启用项的那些 */
export async function unknownReasonCodes(tx: Tx, codes: readonly string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const known = await tx.dictItem.findMany({
    where: { dictTypeKey: "reject_reason", code: { in: [...codes] }, isEnabled: true },
    select: { code: true },
  });
  const set = new Set(known.map((item) => item.code));
  return codes.filter((code) => !set.has(code));
}

/** 这一版清单模板是不是当前启用的 */
export async function isActiveChecklist(tx: Tx, code: string, versionNo: number): Promise<boolean> {
  const found = await tx.checklistTemplate.findFirst({
    where: { code, versionNo, status: "active" },
    select: { id: true },
  });
  return found !== null;
}
