// W1-06②：真实后台鉴权链与真库；审批类型只用写侧已提供的样例登记。
import type { ApprovalCounts, ApprovalDetail, ApprovalItem, AdminPage } from "@liyoxi/contract";
import { runSeed, uuidv7 } from "@liyoxi/services";
import {
  approvalReadFixture,
  createFactories,
  createSampleApproval,
  SAMPLE_APPROVAL_KINDS,
  sampleStaffContext,
  signInAsStaff,
  snapshotTables,
} from "@liyoxi/services/testing";
import { describe, expect, it } from "vitest";
import { useTestApi } from "../src/testing/index.js";

const testApi = useTestApi();
const SLOW = { timeout: 120_000 };
async function world(kinds = SAMPLE_APPROVAL_KINDS) {
  await testApi.db.reset();
  const api = await testApi.start();
  await runSeed({ tx: api.runtime.tx, clock: api.clock });
  const prisma = await testApi.db.prisma();
  const sample = createSampleApproval(prisma, { kinds });
  Object.assign(api.runtime.approval, sample.approval);
  const make = createFactories({ db: prisma, clock: api.clock });
  const insert = approvalReadFixture(prisma, api.clock);
  const merchant = await make.merchant();
  const staff = await signInAsStaff(prisma, { roleKey: "delivery_manager" });
  const colleague = await signInAsStaff(prisma, {
    roleKey: "delivery_manager",
    staffGroupId: staff.staff.staffGroupId,
  });
  const outsider = await signInAsStaff(prisma, { roleKey: "delivery_manager", staffGroupId: null });
  const admin = await signInAsStaff(prisma, { roleKey: "super_admin" });
  const publisher = await signInAsStaff(prisma, { roleKey: "publisher" });
  const qualification = async (
    owner: string,
    status = "pending",
    submittedAt = api.clock.now(),
  ) => {
    const other = await make.merchant();
    await prisma.store.update({
      where: { id: other.store.id },
      data: { deliveryManagerId: owner },
    });
    return insert({
      kind: "qualification",
      category: "review",
      subjectType: "store",
      subjectId: other.store.id,
      storeId: other.store.id,
      entityId: other.entity.id,
      status,
      summarySnapshot: {
        title: `审核 ${owner}`,
        domain: { type: "qualification_submission", id: uuidv7() },
      },
      submitActorType: "merchant",
      submitActorId: other.user.id,
      submitClient: "weapp",
      dedupeKey: `qualification:${other.store.id}`,
      submittedAt,
      ...(status === "pending"
        ? {}
        : { decidedAt: api.clock.now(), isDecidedBySystem: true, decisionNote: "系统结论" }),
    });
  };
  return {
    ...api,
    prisma,
    make,
    insert,
    merchant,
    staff,
    colleague,
    outsider,
    admin,
    publisher,
    qualification,
  };
}
const dataOf = async <T>(response: Response): Promise<T> => {
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return ((await response.json()) as { data: T }).data;
};

describe("admin.approval.list", () => {
  it("本人、本组、全部范围；详情范围外404，发起人自读不会获得决定动作", SLOW, async () => {
    const w = await world();
    const own = await w.qualification(w.staff.staff.id);
    const group = await w.qualification(w.colleague.staff.id);
    const outside = await w.qualification(w.outsider.staff.id);
    const list = async (headers: Record<string, string>) =>
      dataOf<AdminPage<ApprovalItem>>(
        await w.request("/api/v1/admin/approvals?kind=qualification&tab=all", { headers }),
      );
    expect((await list(w.staff.headers)).items.map((row) => row.approvalId)).toEqual([own.id]);
    const lead = await signInAsStaff(w.prisma, {
      roleKey: "delivery_manager",
      isLead: true,
      staffGroupId: w.staff.staff.staffGroupId,
    });
    expect(new Set((await list(lead.headers)).items.map((row) => row.approvalId))).toEqual(
      new Set([own.id, group.id]),
    );
    expect((await list(w.admin.headers)).total).toBe(3);
    expect(
      (await w.request(`/api/v1/admin/approvals/${outside.id}`, { headers: w.staff.headers }))
        .status,
    ).toBe(404);
    const self = await w.insert({
      kind: "subscription_extend",
      category: "approval",
      subjectType: "subscription_term",
      subjectId: uuidv7(),
      entityId: w.merchant.entity.id,
      status: "pending",
      requestNo: `YQ20260105${uuidv7().slice(-8)}`,
      summarySnapshot: { title: "本人申请" },
      submitActorType: "staff",
      submitActorId: w.staff.staff.id,
      submitClient: "admin",
      requesterStaffId: w.staff.staff.id,
      requesterStaffGroupId: w.staff.staff.staffGroupId,
      dedupeKey: `subscription_extend:${uuidv7()}`,
    });
    const item = await dataOf<ApprovalDetail>(
      await w.request(`/api/v1/admin/approvals/${self.id}`, { headers: w.staff.headers }),
    );
    expect(item.actions).toEqual(["withdraw"]);
    expect(item.requester?.staffId).toBe(w.staff.staff.id);
    expect(
      (
        await dataOf<AdminPage<ApprovalItem>>(
          await w.request("/api/v1/admin/approvals?kind=subscription_extend&tab=submitted", {
            headers: w.staff.headers,
          }),
        )
      ).items.map((row) => row.approvalId),
    ).toEqual([self.id]);
  });

  it(
    "不可读kind：列表403、计数忽略、详情404；channel_account 权限持有者可跨范围决定",
    SLOW,
    async () => {
      const w = await world();
      const account = await w.insert({
        kind: "channel_account",
        category: "review",
        subjectType: "channel_account",
        subjectId: uuidv7(),
        entityId: w.merchant.entity.id,
        storeId: w.merchant.store.id,
        status: "pending",
        summarySnapshot: { title: "账号核验" },
        submitActorType: "merchant",
        submitActorId: w.merchant.user.id,
        submitClient: "weapp",
        dedupeKey: `channel_account:${uuidv7()}`,
      });
      expect(
        (
          await w.request("/api/v1/admin/approvals?kind=points_adjust", {
            headers: w.publisher.headers,
          })
        ).status,
      ).toBe(403);
      const counts = await dataOf<ApprovalCounts>(
        await w.request("/api/v1/admin/approvals/summary?kind=points_adjust", {
          headers: w.publisher.headers,
        }),
      );
      expect(counts.items).toEqual([]);
      expect(
        (await w.request(`/api/v1/admin/approvals/${account.id}`, { headers: w.outsider.headers }))
          .status,
      ).toBe(404);
      const item = await dataOf<ApprovalDetail>(
        await w.request(`/api/v1/admin/approvals/${account.id}`, { headers: w.publisher.headers }),
      );
      expect(item.actions).toEqual(["approve", "reject"]);
      expect(
        (
          await dataOf<AdminPage<ApprovalItem>>(
            await w.request("/api/v1/admin/approvals?kind=channel_account", {
              headers: w.publisher.headers,
            }),
          )
        ).total,
      ).toBe(1);
    },
  );

  it("admin.approval.summary", SLOW, async () => {
    const w = await world();
    const headers = w.admin.headers;
    const pending = await w.qualification(
      w.staff.staff.id,
      "pending",
      new Date("2025-12-01T04:00:00Z"),
    );
    const today = await w.qualification(w.staff.staff.id, "approved");
    const gone = await w.qualification(
      w.staff.staff.id,
      "rejected",
      new Date("2026-01-04T16:00:00Z"),
    );
    await w.prisma.approvalRequest.update({
      where: { id: gone.id },
      data: { decidedAt: new Date("2026-01-04T16:00:00Z") },
    });
    const before = await snapshotTables(w.prisma, [
      "approval_request",
      "status_transition",
      "audit_log",
      "outbox_event",
      "biz_sequence",
      "timer",
      "staff_session",
      "alert_event",
    ]);
    const counts = await dataOf<ApprovalCounts>(
      await w.request("/api/v1/admin/approvals/summary?kind=qualification", {
        headers,
      }),
    );
    for (const [tab, field] of [
      ["todo", "todo"],
      ["submitted", "submitted"],
      ["done_today", "doneToday"],
      ["all", "all"],
    ] as const) {
      const list = await dataOf<AdminPage<ApprovalItem>>(
        await w.request(`/api/v1/admin/approvals?kind=qualification&tab=${tab}`, {
          headers,
        }),
      );
      expect(list.total).toBe(counts.items[0]![field]);
    }
    expect(counts.total.todo).toBe(counts.items[0]!.todo);
    expect(counts.items[0]).toMatchObject({
      todo: 1,
      doneToday: 2,
      all: 3,
      overdue: 1,
      approvedThisMonth: 1,
      rejectedThisMonth: 1,
    });
    const filtered = await dataOf<AdminPage<ApprovalItem>>(
      await w.request(
        "/api/v1/admin/approvals?kind=qualification&tab=all&status=approved,rejected&submittedFrom=2026-01-05&submittedTo=2026-01-05&pageSize=1&page=2&sort=-submittedAt",
        { headers },
      ),
    );
    expect(filtered.total).toBe(2);
    expect(filtered.items).toHaveLength(1);
    const details = await dataOf<ApprovalDetail>(
      await w.request(`/api/v1/admin/approvals/${pending.id}`, { headers }),
    );
    expect(details.badges).toContain("overdue");
    expect(details.sla).toBeNull();
    expect(
      new Set(
        (
          await dataOf<AdminPage<ApprovalItem>>(
            await w.request("/api/v1/admin/approvals?tab=done_today&kind=qualification", {
              headers,
            }),
          )
        ).items.map((row) => row.approvalId),
      ),
    ).toEqual(new Set([today.id, gone.id]));
    expect(await snapshotTables(w.prisma, Object.keys(before))).toEqual(before);
  });

  it("admin.approval.get", SLOW, async () => {
    let handlerId: string | null = null;
    const w = await world({
      ...SAMPLE_APPROVAL_KINDS,
      qualification: {
        ...SAMPLE_APPROVAL_KINDS.qualification!,
        handlerOf: () => Promise.resolve(handlerId),
        badges: () => Promise.resolve(["check_mismatch"]),
      },
    });
    handlerId = w.staff.staff.id;
    const row = await w.qualification(w.outsider.staff.id);
    const reason = await w.prisma.dictItem.findFirstOrThrow({
      where: { dictTypeKey: "reject_reason" },
    });
    await w.prisma.dictItem.update({ where: { id: reason.id }, data: { isEnabled: false } });
    await w.prisma.staff.update({ where: { id: handlerId }, data: { name: "当前处理人" } });
    await w.prisma.approvalRequest.update({
      where: { id: row.id },
      data: { reasonCodes: [reason.code] },
    });
    for (const [event, actorType, actorId, fromState, toState] of [
      ["submit", "merchant", row.submitActorId, null, "pending"],
      ["approve", "staff", handlerId, "pending", "approved"],
    ] as const) {
      await w.prisma.statusTransition.create({
        data: {
          id: uuidv7(),
          machine: "approval_request",
          subjectId: row.id,
          stateField: "status",
          fromState,
          toState,
          event,
          actorType,
          actorId,
          client: actorType === "staff" ? "admin" : "weapp",
          occurredAt: w.clock.now(),
          bizDate: new Date("2026-01-05"),
          elapsedWorkMin: event === "approve" ? 15 : null,
        },
      });
    }
    const detail = await dataOf<ApprovalDetail>(
      await w.request(`/api/v1/admin/approvals/${row.id}`, { headers: w.staff.headers }),
    );
    expect(detail.handler?.name).toBe("当前处理人");
    expect(detail.badges).toContain("check_mismatch");
    expect(detail.reasons).toEqual([{ code: reason.code, name: reason.name }]);
    expect(detail.timeline.map((item) => item.event)).toEqual(["submit", "approve"]);
    expect(detail.timeline[0]!.actorLabel).toMatch(/^老板 · /);
    expect(detail.timeline[1]).toMatchObject({ actorLabel: "当前处理人", elapsedWorkMin: 15 });
    expect(detail.operations.get).toBe("lyxtest.qualification.get");
    expect(
      (await w.request(`/api/v1/admin/approvals/${row.id}`, { headers: w.outsider.headers }))
        .status,
    ).toBe(404);
    const staff = await sampleStaffContext(w.prisma, w.staff.staff.id);
    const decision = await w.runtime.tx.run((tx) =>
      w.runtime.approval.decisionView(tx, staff, row.id),
    );
    expect(decision).toMatchObject({
      approvalId: row.id,
      badges: detail.badges,
      actions: detail.actions,
    });
    expect(
      await w.runtime.tx.run((tx) =>
        w.runtime.approval.countTodo(tx, staff, { kind: ["qualification"] }),
      ),
    ).toBe(0);
  });

  it("绑定申请组：本组主管决定，自己申请和他组主管不决定；停用发起人可代撤", SLOW, async () => {
    const w = await world();
    const lead = await signInAsStaff(w.prisma, {
      roleKey: "delivery_manager",
      isLead: true,
      staffGroupId: w.staff.staff.staffGroupId,
    });
    const otherGroup = await w.prisma.staffGroup.create({
      data: {
        id: uuidv7(),
        name: "他组",
        staffRoleKey: "delivery_manager",
        createdAt: w.clock.now(),
        updatedAt: w.clock.now(),
      },
    });
    const otherLead = await signInAsStaff(w.prisma, {
      roleKey: "delivery_manager",
      isLead: true,
      staffGroupId: otherGroup.id,
    });
    // 可配置角色给全部范围后，组约束仍单独阻止他组主管决定。
    await w.prisma.staffRole.update({
      where: { key: "delivery_manager" },
      data: { dataScope: "all" },
    });
    const row = await w.insert({
      kind: "subscription_extend",
      category: "approval",
      subjectType: "subscription_term",
      subjectId: uuidv7(),
      storeId: w.merchant.store.id,
      entityId: w.merchant.entity.id,
      status: "pending",
      summarySnapshot: { title: "组内申请" },
      requestNo: `YQ20260105${uuidv7().slice(-8)}`,
      submitActorType: "staff",
      submitActorId: w.staff.staff.id,
      submitClient: "admin",
      requesterStaffId: w.staff.staff.id,
      requesterStaffGroupId: w.staff.staff.staffGroupId,
      dedupeKey: `subscription_extend:${uuidv7()}`,
    });
    await w.prisma.store.update({
      where: { id: w.merchant.store.id },
      data: { deliveryManagerId: w.staff.staff.id },
    });
    const detail = async (headers: Record<string, string>) =>
      dataOf<ApprovalDetail>(await w.request(`/api/v1/admin/approvals/${row.id}`, { headers }));
    expect((await detail(lead.headers)).actions).toEqual(["approve", "reject"]);
    expect((await detail(w.staff.headers)).actions).toEqual(["withdraw"]);
    expect((await detail(otherLead.headers)).actions).toEqual([]);
    await w.prisma.staff.update({
      where: { id: w.staff.staff.id },
      data: { status: "disabled", disabledAt: w.clock.now(), disabledReason: "other" },
    });
    expect((await detail(lead.headers)).actions).toEqual(["approve", "reject", "withdraw"]);
    expect((await detail(lead.headers)).requester?.status).toBe("disabled");
  });

  it.each([
    { observer: "本人", disabled: false },
    { observer: "停用发起人的代撤人", disabled: true },
  ])("无撤回入口：transfer_confirm 的 $observer 不获得 withdraw", SLOW, async ({ disabled }) => {
    const w = await world({
      ...SAMPLE_APPROVAL_KINDS,
      transfer_confirm: {
        ...SAMPLE_APPROVAL_KINDS.points_adjust!,
        viewModules: ["finance"],
        decidePermission: "finance.receipt.confirm",
        numberPrefix: null,
        dedupeKey: (submission) => `transfer_confirm:${submission.subjectId}`,
        operations: {
          get: "admin.transferProof.get",
          approve: "admin.transferProof.approveReview",
          reject: "admin.transferProof.rejectReview",
          withdraw: null,
        },
      },
    });
    const requester = await signInAsStaff(w.prisma, { roleKey: "finance" });
    const observer = disabled ? await signInAsStaff(w.prisma, { roleKey: "finance" }) : requester;
    const row = await w.insert({
      kind: "transfer_confirm",
      category: "approval",
      subjectType: "transfer_proof",
      subjectId: uuidv7(),
      storeId: w.merchant.store.id,
      entityId: w.merchant.entity.id,
      status: "pending",
      summarySnapshot: { title: "对公二人复核" },
      submitActorType: "staff",
      submitActorId: requester.staff.id,
      submitClient: "admin",
      requesterStaffId: requester.staff.id,
      requesterStaffGroupId: requester.staff.staffGroupId,
      dedupeKey: `transfer_confirm:${uuidv7()}`,
    });
    if (disabled)
      await w.prisma.staff.update({
        where: { id: requester.staff.id },
        data: { status: "disabled", disabledAt: w.clock.now(), disabledReason: "other" },
      });
    const actions = disabled ? ["approve-review", "reject-review"] : [];
    const list = await dataOf<AdminPage<ApprovalItem>>(
      await w.request("/api/v1/admin/approvals?kind=transfer_confirm&tab=all", {
        headers: observer.headers,
      }),
    );
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.actions).toEqual(actions);
    const detail = await dataOf<ApprovalDetail>(
      await w.request(`/api/v1/admin/approvals/${row.id}`, { headers: observer.headers }),
    );
    expect(detail.operations.withdraw).toBeNull();
    expect(detail.actions).toEqual(actions);
    const staff = await sampleStaffContext(w.prisma, observer.staff.id);
    const decision = await w.runtime.tx.run((tx) =>
      w.runtime.approval.decisionView(tx, staff, row.id),
    );
    expect(decision.actions).toEqual(actions);
  });
});

describe("admin.dictItem.list", () => {
  it("种子场景、版本、停用项、权限和M1引用计数；GET不写库", SLOW, async () => {
    const w = await world();
    const disabled = await w.prisma.dictItem.findFirstOrThrow({
      where: { dictTypeKey: "reject_reason", ext: { path: ["scene"], equals: "store_review" } },
    });
    await w.prisma.dictItem.update({ where: { id: disabled.id }, data: { isEnabled: false } });
    const before = await snapshotTables(w.prisma, [
      "dict_type",
      "dict_item",
      "audit_log",
      "outbox_event",
    ]);
    const result = await dataOf<{
      items: Array<{
        dictItemId: string;
        isEnabled: boolean;
        ext: { scene: string };
        refCount: null;
      }>;
      types: Array<{ typeKey: string; versionNo: number }>;
    }>(
      await w.request("/api/v1/admin/dict-items?typeKey=reject_reason&scene=store_review", {
        headers: w.staff.headers,
      }),
    );
    expect(result.items.length).toBeGreaterThan(0);
    expect(
      result.items.every(
        (item) => item.isEnabled && item.ext.scene === "store_review" && item.refCount === null,
      ),
    ).toBe(true);
    expect(result.items.some((item) => item.dictItemId === disabled.id)).toBe(false);
    expect(result.types).toEqual([{ typeKey: "reject_reason", versionNo: 1 }]);
    expect(
      (
        await w.request("/api/v1/admin/dict-items?typeKey=reject_reason&includeDisabled=true", {
          headers: w.staff.headers,
        })
      ).status,
    ).toBe(403);
    const all = await dataOf<{ items: Array<{ dictItemId: string }> }>(
      await w.request(
        "/api/v1/admin/dict-items?typeKey=reject_reason&scene=store_review&includeDisabled=true",
        { headers: w.admin.headers },
      ),
    );
    expect(all.items.some((item) => item.dictItemId === disabled.id)).toBe(true);
    const ref = await w.request(
      "/api/v1/admin/dict-items?typeKey=reject_reason&withRefCount=true",
      {
        headers: w.admin.headers,
      },
    );
    expect(ref.status).toBe(400);
    expect(await ref.json()).toMatchObject({ error: "VALIDATION_FAILED" });
    expect(
      (
        await w.request("/api/v1/admin/dict-items?typeKey=reject_reason&includeDisabled=1", {
          headers: w.admin.headers,
        })
      ).status,
    ).toBe(400);
    expect(await snapshotTables(w.prisma, Object.keys(before))).toEqual(before);
  });

  it("逗号类型数量与树形parentCode；只取直接下级，平面字典拒绝parentCode", SLOW, async () => {
    const w = await world();
    // region 只播种类型，行政区划内容由以后导入；本例造三层合法树。
    for (const [code, parentCode, name] of [
      ["110000", null, "测试省"],
      ["110100", "110000", "测试市"],
      ["110101", "110100", "测试区"],
    ] as const)
      await w.prisma.dictItem.create({
        data: {
          id: uuidv7(),
          dictTypeKey: "region",
          code,
          parentCode,
          name,
          createdAt: w.clock.now(),
          updatedAt: w.clock.now(),
        },
      });
    const parent = { code: "110000" };
    const result = await dataOf<{ items: Array<{ parentCode: string }> }>(
      await w.request(`/api/v1/admin/dict-items?typeKey=region&parentCode=${parent.code}`, {
        headers: w.staff.headers,
      }),
    );
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.parentCode === parent.code)).toBe(true);
    for (const query of [
      "typeKey=reject_reason&parentCode=x",
      "typeKey=region,reject_reason&parentCode=x",
      `typeKey=${Array.from({ length: 11 }, () => "region").join(",")}`,
    ]) {
      expect(
        (await w.request(`/api/v1/admin/dict-items?${query}`, { headers: w.staff.headers })).status,
      ).toBe(400);
    }
  });
});

describe("当前处理人与分页范围", () => {
  it.each([false, true])(
    "roleQueue=%s：仅展示项解析处理人，计数仍覆盖整组",
    SLOW,
    async (roleQueue) => {
      const readIds: string[] = [];
      const w = await world({
        ...SAMPLE_APPROVAL_KINDS,
        qualification: {
          ...SAMPLE_APPROVAL_KINDS.qualification!,
          roleQueue,
          ...(roleQueue ? { decidePermission: "publish.account.verify" } : {}),
          handlerOf: async (tx, row) => {
            readIds.push(row.id);
            return (
              await tx.store.findUniqueOrThrow({
                where: { id: row.storeId! },
                select: { deliveryManagerId: true },
              })
            ).deliveryManagerId;
          },
        },
      });
      const first = await w.qualification(w.staff.staff.id);
      await w.qualification(w.colleague.staff.id);
      await w.qualification(w.outsider.staff.id);
      const observer = roleQueue ? w.publisher : w.admin;
      const page = await dataOf<AdminPage<ApprovalItem>>(
        await w.request("/api/v1/admin/approvals?kind=qualification&tab=all&pageSize=1&page=2", {
          headers: observer.headers,
        }),
      );
      expect(page.total).toBe(3);
      expect(readIds).toEqual([page.items[0]!.approvalId]);
      expect(page.items[0]!.handler).not.toBeNull();
      expect(page.items[0]!.actions).toEqual(["approve", "reject"]);
      await w.prisma.store.update({
        where: { id: page.items[0]!.storeId! },
        data: { deliveryManagerId: w.outsider.staff.id },
      });
      await w.prisma.staff.update({
        where: { id: w.outsider.staff.id },
        data: { name: "实时处理人" },
      });
      readIds.length = 0;
      const detail = await dataOf<ApprovalDetail>(
        await w.request(`/api/v1/admin/approvals/${page.items[0]!.approvalId}`, {
          headers: observer.headers,
        }),
      );
      expect(detail.handler).toMatchObject({ staffId: w.outsider.staff.id, name: "实时处理人" });
      expect(readIds).toEqual([detail.approvalId]);
      readIds.length = 0;
      const ctx = await sampleStaffContext(w.prisma, observer.staff.id);
      expect(
        (
          await w.runtime.tx.run((tx) =>
            w.runtime.approval.summary(tx, ctx, { kind: ["qualification"] }),
          )
        ).items[0],
      ).toMatchObject({ all: 3, todo: 3 });
      expect(
        await w.runtime.tx.run((tx) =>
          w.runtime.approval.countTodo(tx, ctx, { kind: ["qualification"] }),
        ),
      ).toBe(3);
      expect(readIds).toEqual([]);
      if (!roleQueue) {
        const personal = await dataOf<AdminPage<ApprovalItem>>(
          await w.request("/api/v1/admin/approvals?kind=qualification&tab=all", {
            headers: w.staff.headers,
          }),
        );
        expect(personal.items.map((item) => item.approvalId)).toEqual([first.id]);
        expect(personal.items[0]!.actions).toEqual([]);
        expect(readIds).toHaveLength(3);
      }
    },
  );
});
