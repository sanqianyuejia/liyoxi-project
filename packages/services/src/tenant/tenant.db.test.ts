// tenant 的服务层用例（任务书 W1-03 第 7 节验收 5–9 与“模块完整”的四条不变量）。连真库，整份文件共用一个带种子的库。
// 装配是测试装配：计费账户端口换成“记下调用、真的建一行并锁住它”的样例实现（锁序断言在 test 环境下违规即抛错）。
import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { createEvents } from "../events/index.js";
import { createFlow } from "../flow/index.js";
import {
  AppError,
  createIdempotencyContext,
  createIdentityContext,
  createTxRunner,
  defineRegistration,
  implement,
  implementMerchantFacts,
  isUniqueViolation,
  lockRows,
  merchantFactsPort,
} from "../kernel/index.js";
import type { IdentityContext, PortImplementation, TxRunner } from "../kernel/index.js";
import {
  assembleForTest,
  createClock,
  createFactories,
  useSeededDatabase,
} from "../testing/index.js";
import type { AdjustableClock, Factories } from "../testing/index.js";
import {
  billingAccountPort,
  createTenant,
  findI1Violations,
  findI27Violations,
  findI29Violations,
  findI7Violations,
} from "./index.js";
import type { BillingAccountOpener, Tenant, VerifiedEntityFields } from "./index.js";

const db = useSeededDatabase("services");
const SLOW = 90_000;

let prisma: PrismaClient;
let clock: AdjustableClock;
let make: Factories;
let tx: TxRunner;
/** 事实端口一个键都没注册的装配 */
let tenant: Tenant;
/** 计费账户端口收到的主体 id，按先后 */
const opened: string[] = [];

/** 样例的计费账户端口：记下调用，建一行并锁住它（计费账户排在加锁顺序的最后） */
const recorder: BillingAccountOpener = {
  async ensureForEntity(handle, _ctx, entityId) {
    opened.push(entityId);
    await createFactories({ db: handle, clock }).billingAccount({ entityId });
    await lockRows(handle, "billing_account", [entityId], "update");
  },
};

function build(facts: PortImplementation[] = []): Tenant {
  const assembly = assembleForTest({
    entry: "api",
    withoutRealPorts: [billingAccountPort, merchantFactsPort],
    extra: [
      defineRegistration("lyxtest_tenant", {
        portImplementations: [implement(billingAccountPort, recorder), ...facts],
      }),
    ],
  });
  const events = createEvents({ assembly, clock, tx });
  const flow = createFlow({ assembly, clock, events });
  return createTenant({ tx, clock, flow, assembly });
}

beforeAll(async () => {
  prisma = await db.prisma();
  clock = createClock();
  make = createFactories({ db: prisma, clock });
  tx = createTxRunner({ prisma, appEnv: "test" });
  tenant = build();
}, SLOW);

const merchantCtx = (merchantUserId: string): IdentityContext =>
  createIdentityContext({
    actor: { type: "merchant", id: merchantUserId, client: "weapp" },
    requestId: "req_tenant_test",
    ip: "203.0.113.9",
  });
const systemCtx = createIdentityContext({ actor: { type: "system", job: "lyxtest.tenant" } });

/** 一个新账号，经用例建好主体 */
async function newOwner() {
  const user = await make.merchantUser();
  const ctx = merchantCtx(user.id);
  const result = await tenant.createEntity(ctx);
  return { user, ctx, ...result };
}

async function appError(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("本该抛业务错误，却成功了");
}

const historyOf = (subjectId: string, stateField?: string) =>
  prisma.statusTransition.findMany({
    where: { subjectId, ...(stateField === undefined ? {} : { stateField }) },
    orderBy: { seq: "asc" },
  });

const VERIFIED: VerifiedEntityFields = {
  name: "成都星河餐饮有限公司",
  entityType: "enterprise",
  usccEnc: "v1:test:dXNjYw",
  usccBidx: new Uint8Array(32).fill(9),
  usccMask: "91510104MA6B****2R",
  legalRepNameEnc: "v1:test:bmFtZQ",
  legalRepNameMask: "王**",
};

describe("建主体（验收 5–7）", () => {
  it(
    "一次调用建齐三行、三条状态历史、两条事件，计费账户端口调一次；同幂等键重放不多建；已是老板返回已有",
    async () => {
      const user = await make.merchantUser({ sourceChannelCode: "CH01" });
      const ctx = merchantCtx(user.id);
      const idem = () =>
        createIdempotencyContext({
          mode: "required",
          scope: "m.entity.create",
          actor: ctx.actor,
          key: "tenant-test-create-0001",
          request: { method: "POST", pathParams: {}, body: {}, storeId: null },
        });
      const before = opened.length;
      const first = idem();
      const created = await tenant.createEntity(ctx, { idem: first });
      expect(created).toMatchObject({ role: "owner", isNew: true, abandonedEntityId: null });
      expect(first.replayed).toBe(false);
      expect(opened.slice(before)).toEqual([created.entityId]);

      const entity = await prisma.entity.findUniqueOrThrow({ where: { id: created.entityId } });
      expect(entity).toMatchObject({
        lifecycle: "active",
        verificationStatus: "unsubmitted",
        name: null,
        sourceType: "organic",
        sourceChannelCode: "CH01",
        createdByUserId: user.id,
      });
      const stores = await prisma.store.findMany({ where: { entityId: created.entityId } });
      expect(stores).toHaveLength(1);
      expect(stores[0]).toMatchObject({
        id: created.storeId,
        isPrimary: true,
        lifecycle: "active",
        name: null,
        qualificationStatus: "unsubmitted",
      });
      const members = await prisma.entityMember.findMany({
        where: { entityId: created.entityId },
      });
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({
        id: created.memberId,
        merchantUserId: user.id,
        role: "owner",
        status: "active",
        lastStoreId: created.storeId,
      });
      // 档案行不在这里建
      expect(await prisma.storeProfile.count({ where: { storeId: created.storeId } })).toBe(0);
      expect(await prisma.billingAccount.count({ where: { entityId: created.entityId } })).toBe(1);

      // 三条状态历史：都是新建（from 为空），各带主体
      const ids = [created.entityId, created.storeId, created.memberId];
      const history = await prisma.statusTransition.findMany({
        where: { subjectId: { in: ids } },
        orderBy: { seq: "asc" },
      });
      expect(history.map((row) => [row.machine, row.event, row.fromState, row.toState])).toEqual([
        ["entity", "entity.create", null, "active"],
        ["store", "store.create", null, "active"],
        ["entity_member", "entity_member.create_owner", null, "active"],
      ]);
      expect(history.every((row) => row.entityId === created.entityId)).toBe(true);
      // 两条事件：老板成员关系的建立不另发
      const events = await prisma.outboxEvent.findMany({
        where: { aggregateId: { in: ids } },
        orderBy: { seq: "asc" },
      });
      expect(events.map((row) => [row.eventType, row.aggregateType])).toEqual([
        ["entity.created", "entity"],
        ["store.created", "store"],
      ]);
      expect(events[0]?.payload).toEqual({
        v: 1,
        entityId: created.entityId,
        firstStoreId: created.storeId,
        ownerUserId: user.id,
        fromState: null,
        toState: "active",
        transition: "entity.create",
      });
      expect(events[1]?.payload).toMatchObject({ storeId: created.storeId, isFirstStore: true });
      // 三条迁移各一行活动流审计
      const audits = await prisma.auditLog.findMany({ where: { targetId: { in: ids } } });
      expect(audits.map((row) => row.action).sort()).toEqual([
        "tenant.entity.create",
        "tenant.entity_member.create_owner",
        "tenant.store.create",
      ]);
      expect(audits.every((row) => row.stream === "activity")).toBe(true);

      // 同幂等键重放：返回同一结果，不执行、不多建
      const second = idem();
      expect(await tenant.createEntity(ctx, { idem: second })).toEqual(created);
      expect(second.replayed).toBe(true);
      // 已是老板（换一个键）：返回已有主体，isNew 为假
      const again = await tenant.createEntity(ctx);
      expect(again).toEqual({ ...created, isNew: false });
      expect(opened.slice(before)).toEqual([created.entityId]);
      expect(await prisma.entity.count({ where: { createdByUserId: user.id } })).toBe(1);
      expect(await prisma.statusTransition.count({ where: { subjectId: { in: ids } } })).toBe(3);
    },
    SLOW,
  );

  it(
    "别家的有效店员：409 ALREADY_IN_ENTITY，带所在门店的名称；什么都不建",
    async () => {
      const merchant = await make.merchant();
      const clerkUser = await make.merchantUser();
      const clerk = await make.entityMember({
        entityId: merchant.entity.id,
        merchantUserId: clerkUser.id,
      });
      await make.storeMember({ entityMemberId: clerk.id, storeId: merchant.store.id });
      const error = await appError(() => tenant.createEntity(merchantCtx(clerkUser.id)));
      expect(error.error).toBe("ALREADY_IN_ENTITY");
      expect(error.details).toEqual({ storeName: merchant.store.name });
      expect(await prisma.entity.count({ where: { createdByUserId: clerkUser.id } })).toBe(0);
    },
    SLOW,
  );

  it(
    "每主体 1 位老板：直接插第二位被唯一索引拒绝；同一账号并发建主体只建出一个，另一个返回已有",
    async () => {
      const owner = await newOwner();
      const second = await make.entityMember({ entityId: owner.entityId, role: "owner" }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(isUniqueViolation(second, ["uq_entity_member_one_owner"])).toBe(true);

      // 两个事务同时为同一账号建主体：在账号行锁上排队，后到的看到已有的成员关系
      const user = await make.merchantUser();
      const ctx = merchantCtx(user.id);
      const before = opened.length;
      const results = await Promise.all([tenant.createEntity(ctx), tenant.createEntity(ctx)]);
      expect(results.map((result) => result.isNew).sort()).toEqual([false, true]);
      expect(results[0]?.entityId).toBe(results[1]?.entityId);
      expect(results[0]?.storeId).toBe(results[1]?.storeId);
      expect(await prisma.entity.count({ where: { createdByUserId: user.id } })).toBe(1);
      expect(await prisma.entityMember.count({ where: { merchantUserId: user.id } })).toBe(1);
      // 锁序：两个事务都走了“账号行 → …… → 计费账户最后”，test 环境下锁序违规即抛错，走到这里即通过
      expect(opened.slice(before)).toEqual([results[0]?.entityId]);
    },
    SLOW,
  );

  it(
    "操作人不是商家用户：拒绝；账号不存在：NOT_FOUND",
    async () => {
      await expect(tenant.createEntity(systemCtx)).rejects.toThrow(TypeError);
      const ghost = merchantCtx("01890000-0000-7000-8000-0000000000aa");
      expect((await appError(() => tenant.createEntity(ghost))).error).toBe("NOT_FOUND");
    },
    SLOW,
  );
});

describe("成员关系解析与三个写函数（验收 8）", () => {
  it(
    "解析：老板 × 启用、自己停用（收尾）、草稿删除（无）；店员 × 所属、非所属；主体非 active；门店不存在",
    async () => {
      const owner = await newOwner();
      const archived = {
        lifecycle: "archived",
        archivedAt: clock.now(),
        archiveActorType: "merchant",
        archiveActorId: owner.user.id,
        archiveClient: "weapp",
      };
      const byOwner = await make.store({
        entityId: owner.entityId,
        ...archived,
        archiveReason: "by_owner",
      });
      const draftDeleted = await make.store({
        entityId: owner.entityId,
        ...archived,
        archiveReason: "draft_deleted",
      });
      const other = await make.store({ entityId: owner.entityId });
      const clerkUser = await make.merchantUser();
      const clerk = await make.entityMember({
        entityId: owner.entityId,
        merchantUserId: clerkUser.id,
      });
      await make.storeMember({
        entityMemberId: clerk.id,
        storeId: owner.storeId,
        addedByMemberId: owner.memberId,
      });
      // 主体已关闭而成员行还在（不该出现的残留）：照样按无成员关系
      const closedUser = await make.merchantUser();
      const closed = await make.entity({
        createdByUserId: closedUser.id,
        lifecycle: "closed",
        closedAt: clock.now(),
      });
      const closedStore = await make.store({ entityId: closed.id, isPrimary: true });
      await make.entityMember({
        entityId: closed.id,
        merchantUserId: closedUser.id,
        role: "owner",
      });

      const cases: [string, string, string, { role: string; storeMode: string } | null][] = [
        ["老板 × 启用", owner.user.id, owner.storeId, { role: "owner", storeMode: "active" }],
        ["老板 × 自己停用", owner.user.id, byOwner.id, { role: "owner", storeMode: "archived" }],
        ["老板 × 草稿删除", owner.user.id, draftDeleted.id, null],
        ["店员 × 所属", clerkUser.id, owner.storeId, { role: "clerk", storeMode: "active" }],
        ["店员 × 非所属", clerkUser.id, other.id, null],
        ["主体非 active", closedUser.id, closedStore.id, null],
        ["门店不存在", owner.user.id, "01890000-0000-7000-8000-0000000000bb", null],
        ["门店 id 不是 UUID", owner.user.id, "all", null],
        ["别的主体的门店", owner.user.id, closedStore.id, null],
      ];
      for (const [name, merchantUserId, storeId, expected] of cases) {
        const resolved = await tenant.resolveMembership(prisma, { merchantUserId, storeId });
        if (expected === null) expect(resolved, name).toBeNull();
        else
          expect(resolved, name).toMatchObject({ ...expected, entityId: owner.entityId, storeId });
      }
      expect(await tenant.activeMembership(prisma, clerkUser.id)).toMatchObject({
        memberId: clerk.id,
        role: "clerk",
      });
      expect(await tenant.activeMembership(prisma, (await make.merchantUser()).id)).toBeNull();

      // 记住当前门店：能进的门店才记；进不去是 NOT_FOUND
      const remember = (merchantUserId: string, storeId: string) =>
        tenant.rememberCurrentStore({ merchantUserId, storeId });
      expect(await remember(owner.user.id, byOwner.id)).toEqual({ storeId: byOwner.id });
      const member = await prisma.entityMember.findUniqueOrThrow({ where: { id: owner.memberId } });
      expect(member.lastStoreId).toBe(byOwner.id);
      expect((await appError(() => remember(owner.user.id, draftDeleted.id))).error).toBe(
        "NOT_FOUND",
      );
      expect((await appError(() => remember(clerkUser.id, other.id))).error).toBe("NOT_FOUND");
      // 已是老板再调建主体：建议进入的门店取上次选择的
      expect(await tenant.createEntity(owner.ctx)).toMatchObject({
        isNew: false,
        storeId: byOwner.id,
      });
    },
    SLOW,
  );

  it(
    "资质 initial 轮次：提交、驳回、再提交、通过在两条链上各写一行；没起名不能提交；非法迁移被拒",
    async () => {
      const owner = await newOwner();
      const staff = await make.staff();
      const staffCtx = createIdentityContext({
        actor: { type: "staff", id: staff.id, client: "admin" },
        requestId: "req_tenant_review",
      });
      const act = (ctx: IdentityContext, input: object) =>
        tx.run((handle) =>
          tenant.setStoreQualification(handle, ctx, {
            storeId: owner.storeId,
            round: "initial",
            ...input,
          } as Parameters<Tenant["setStoreQualification"]>[2]),
        );

      // 没起名的门店不能提交：服务层先断言，什么都没写
      const unnamed = await appError(() => act(owner.ctx, { action: "submit" }));
      expect(unnamed.error).toBe("STATE_NOT_ALLOWED");
      expect(unnamed.details).toMatchObject({ reason: "store_name_required" });
      // 库里的约束兜底：绕过服务直接改状态同样被拒
      await expect(
        prisma.$executeRaw`UPDATE store SET qualification_status = 'pending' WHERE id = ${owner.storeId}::uuid`,
      ).rejects.toThrow(/ck_store_name_required/);

      // 起名：2 至 30 个字；写一条活动流审计
      const short = await appError(() =>
        tx.run((handle) =>
          tenant.setStoreName(handle, owner.ctx, { storeId: owner.storeId, name: " 店 " }),
        ),
      );
      expect(short.error).toBe("VALIDATION_FAILED");
      const named = await tx.run((handle) =>
        tenant.setStoreName(handle, owner.ctx, { storeId: owner.storeId, name: " 春熙路店 " }),
      );
      expect(named).toEqual({ storeId: owner.storeId, name: "春熙路店" });
      const renameAudit = await prisma.auditLog.findFirstOrThrow({
        where: { targetId: owner.storeId, action: "tenant.store.rename" },
      });
      expect(renameAudit).toMatchObject({ stream: "activity", entityId: owner.entityId });

      // 非法迁移：还没提交就通过
      const early = await appError(() => act(staffCtx, { action: "approve", verified: VERIFIED }));
      expect(early.error).toBe("STATE_NOT_ALLOWED");

      expect(await act(owner.ctx, { action: "submit" })).toMatchObject({
        store: { from: "unsubmitted", to: "pending" },
        entity: { from: "unsubmitted", to: "pending" },
      });
      // 提交之后改名要走变更重审
      const locked = await appError(() =>
        tx.run((handle) =>
          tenant.setStoreName(handle, owner.ctx, { storeId: owner.storeId, name: "别的名字" }),
        ),
      );
      expect(locked.details).toMatchObject({ reason: "rename_needs_review" });
      // 驳回：原因至少一项、说明必填
      const bare = await appError(() =>
        act(staffCtx, { action: "reject", rejection: { reasonCodes: [], note: "" } }),
      );
      expect(bare.error).toBe("STATE_NOT_ALLOWED");
      expect(
        await act(staffCtx, {
          action: "reject",
          rejection: { reasonCodes: ["license_blurry"], note: "营业执照照片不清晰" },
        }),
      ).toMatchObject({ store: { to: "rejected" }, entity: { to: "rejected" } });
      expect(await act(owner.ctx, { action: "submit" })).toMatchObject({
        store: { from: "rejected", to: "pending" },
        entity: { from: "rejected", to: "pending" },
      });
      // 通过：缺认证字段不放行；给齐后主体的名称、信用代码、认证时间与状态一起写上
      const missing = await appError(() => act(staffCtx, { action: "approve" }));
      expect(missing.error).toBe("STATE_NOT_ALLOWED");
      clock.advance(60_000);
      expect(await act(staffCtx, { action: "approve", verified: VERIFIED })).toMatchObject({
        store: { from: "pending", to: "verified" },
        entity: { from: "pending", to: "verified" },
      });
      const entity = await prisma.entity.findUniqueOrThrow({ where: { id: owner.entityId } });
      expect(entity).toMatchObject({
        verificationStatus: "verified",
        name: VERIFIED.name,
        entityType: "enterprise",
        usccMask: VERIFIED.usccMask,
        legalRepNameMask: "王**",
        verifiedAt: clock.now(),
      });
      expect(Buffer.from(entity.usccBidx ?? []).equals(Buffer.from(VERIFIED.usccBidx))).toBe(true);

      // 两条链各四行：提交、驳回、提交、通过；事件码相同，都没有另发出站事件
      const events = ["submit", "reject", "submit", "approve"].map(
        (verb) => `qualification.${verb}`,
      );
      const onStore = await historyOf(owner.storeId, "qualification_status");
      const onEntity = await historyOf(owner.entityId, "verification_status");
      expect(onStore.map((row) => row.event)).toEqual(events);
      expect(onEntity.map((row) => row.event)).toEqual(events);
      expect(onStore[1]).toMatchObject({
        actorType: "staff",
        reasonCode: "license_blurry",
        note: "营业执照照片不清晰",
        payload: { round: "initial", reasonCodes: ["license_blurry"] },
      });
      expect(
        await prisma.outboxEvent.count({
          where: { aggregateId: { in: [owner.storeId, owner.entityId] } },
        }),
      ).toBe(2);
      // 改交付经理：写一条 ops 审计；没变就不写
      const assign = (staffId: string | null) =>
        tx.run((handle) =>
          tenant.setDeliveryManager(handle, staffCtx, { storeId: owner.storeId, staffId }),
        );
      expect(await assign(staff.id)).toMatchObject({ previousStaffId: null, staffId: staff.id });
      expect(await assign(staff.id)).toMatchObject({ previousStaffId: staff.id });
      const assigned = await prisma.auditLog.findMany({
        where: { targetId: owner.storeId, action: "tenant.store.assign_manager" },
      });
      expect(assigned).toHaveLength(1);
      expect(assigned[0]).toMatchObject({ stream: "ops", category: "manager_assign" });
      expect(
        (await prisma.store.findUniqueOrThrow({ where: { id: owner.storeId } })).deliveryManagerId,
      ).toBe(staff.id);
    },
    SLOW,
  );

  it(
    "撤回：只由系统做，两条链各回到提交前的值（未提交过的回 unsubmitted，驳回后再交的回 rejected）",
    async () => {
      const owner = await newOwner();
      const staff = await make.staff();
      const staffCtx = createIdentityContext({
        actor: { type: "staff", id: staff.id, client: "admin" },
      });
      const act = (ctx: IdentityContext, input: object) =>
        tx.run((handle) =>
          tenant.setStoreQualification(handle, ctx, {
            storeId: owner.storeId,
            round: "initial",
            ...input,
          } as Parameters<Tenant["setStoreQualification"]>[2]),
        );
      await tx.run((handle) =>
        tenant.setStoreName(handle, owner.ctx, { storeId: owner.storeId, name: "太古里店" }),
      );
      await act(owner.ctx, { action: "submit" });
      expect((await appError(() => act(owner.ctx, { action: "withdraw" }))).error).toBe(
        "STATE_NOT_ALLOWED",
      );
      expect(await act(systemCtx, { action: "withdraw" })).toMatchObject({
        store: { from: "pending", to: "unsubmitted" },
        entity: { from: "pending", to: "unsubmitted" },
      });
      await act(owner.ctx, { action: "submit" });
      await act(staffCtx, {
        action: "reject",
        rejection: { reasonCodes: ["other"], note: "证照与主体不符" },
      });
      await act(owner.ctx, { action: "submit" });
      expect(await act(systemCtx, { action: "withdraw" })).toMatchObject({
        store: { to: "rejected" },
        entity: { to: "rejected" },
      });
      expect(await historyOf(owner.storeId, "qualification_status")).toHaveLength(6);
      expect(await historyOf(owner.entityId, "verification_status")).toHaveLength(6);
    },
    SLOW,
  );
});

describe("额度与门店列表（验收 9）", () => {
  it(
    "事实端口没注册：两个默认参数、未开通、各项 0 或 null；主体上的覆盖值优先；三种 viewerRole",
    async () => {
      const owner = await newOwner();
      const list = await tenant.listStores({ merchantUserId: owner.user.id });
      if (list.viewerRole !== "owner") throw new Error("老板视图的判别字段不对");
      expect(list.entity).toEqual({
        entityId: owner.entityId,
        name: null,
        verificationStatus: "unsubmitted",
        subscription: null,
        storesUsed: 1,
        storeLimit: 1,
        seatsUsed: 0,
        memberLimit: 3,
        pendingInvitationCount: 0,
        storesOver: 0,
        seatsOver: 0,
        limitReason: "inactive",
        canAddStore: false,
      });
      expect(list.items).toEqual([
        {
          storeId: owner.storeId,
          name: null,
          isPrimary: true,
          lifecycle: "active",
          archiveReason: null,
          archivedAt: null,
          isLastSelected: true,
          city: null,
          category: null,
          qualificationStatus: "unsubmitted",
          verifiedAt: null,
          submittedAt: null,
          expectedDecisionAt: null,
          completenessPct: 0,
          liveCount: 0,
          deliveringCount: 0,
          assetCount: 0,
          clerkCount: 0,
          pendingInvitationCount: 0,
          memberPreview: [{ displayName: owner.user.displayName, role: "owner" }],
          todoCount: 0,
          actions: [],
        },
      ]);

      // 再加一家启用中的、一家自己停用的、一家草稿删除的；一位店员挂在第二家
      const second = await make.store({ entityId: owner.entityId, qualificationStatus: "pending" });
      const archived = {
        lifecycle: "archived",
        archivedAt: clock.now(),
        archiveActorType: "merchant",
        archiveActorId: owner.user.id,
        archiveClient: "weapp",
      };
      const stopped = await make.store({
        entityId: owner.entityId,
        ...archived,
        archiveReason: "by_owner",
      });
      await make.store({ entityId: owner.entityId, ...archived, archiveReason: "draft_deleted" });
      const clerkUser = await make.merchantUser();
      const clerk = await make.entityMember({
        entityId: owner.entityId,
        merchantUserId: clerkUser.id,
        displayName: null,
      });
      await make.storeMember({
        entityMemberId: clerk.id,
        storeId: second.id,
        addedByMemberId: owner.memberId,
      });

      const usage = await tx.run((handle) => tenant.getQuotaUsage(handle, owner.entityId));
      expect(usage).toEqual({
        storesUsed: 2,
        storeLimit: 1,
        seatsUsed: 1,
        memberLimit: 3,
        storesOver: 1,
        seatsOver: 0,
        limitReason: "inactive",
        pendingInvitationCount: 0,
      });
      // 主体上的覆盖值优先于默认参数
      await prisma.entity.update({
        where: { id: owner.entityId },
        data: { storeLimitOverride: 5, memberLimitOverride: 0 },
      });
      expect(await tx.run((handle) => tenant.getQuotaUsage(handle, owner.entityId))).toMatchObject({
        storeLimit: 5,
        memberLimit: 0,
        storesOver: 0,
        seatsOver: 1,
      });

      const asOwner = await tenant.listStores({ merchantUserId: owner.user.id });
      if (asOwner.viewerRole !== "owner") throw new Error("老板视图的判别字段不对");
      // 启用中的在前（首店最前），已停用的在后；草稿删除的不出现
      expect(asOwner.items.map((item) => item.storeId)).toEqual([
        owner.storeId,
        second.id,
        stopped.id,
      ]);
      expect(asOwner.items.map((item) => item.actions)).toEqual([
        ["archive", "delete"],
        ["archive"],
        ["restore"],
      ]);
      expect(asOwner.items[1]).toMatchObject({
        clerkCount: 1,
        // 店员的称呼为空：取账号称呼
        memberPreview: [
          { displayName: owner.user.displayName, role: "owner" },
          { displayName: clerkUser.displayName, role: "clerk" },
        ],
      });
      expect(asOwner.items[2]).toMatchObject({ lifecycle: "archived", archiveReason: "by_owner" });
      expect(asOwner.entity).toMatchObject({ storesUsed: 2, storeLimit: 5, canAddStore: true });

      // 店员：主体只有摘要，门店只有本人所属的，卡片是店员的形状
      const asClerk = await tenant.listStores({ merchantUserId: clerkUser.id });
      expect(asClerk.viewerRole).toBe("clerk");
      expect(asClerk.entity).toEqual({
        entityId: owner.entityId,
        name: null,
        verificationStatus: "unsubmitted",
      });
      expect(asClerk.items).toHaveLength(1);
      expect(Object.keys(asClerk.items[0] ?? {}).sort()).toEqual(
        [
          "actions",
          "assetCount",
          "category",
          "city",
          "clerkCount",
          "isLastSelected",
          "isPrimary",
          "lifecycle",
          "name",
          "qualificationStatus",
          "storeId",
          "todoCount",
        ].sort(),
      );
      expect(asClerk.items[0]).toMatchObject({ storeId: second.id, actions: [] });

      // 没有有效成员关系
      const nobody = await make.merchantUser();
      expect(await tenant.listStores({ merchantUserId: nobody.id })).toEqual({
        viewerRole: "none",
        entity: null,
        items: [],
      });
    },
    SLOW,
  );

  it(
    "测试装配里注册样例事实后，门店卡与额度卡的对应字段有值；订阅生效时额度取套餐的",
    async () => {
      const owner = await newOwner();
      const at = new Date("2026-01-04T10:20:00.000Z");
      const withFacts = build([
        implementMerchantFacts("billing", async () => ({
          subscription: {
            planName: "专业版",
            endDate: "2026-10-12",
            isActive: true,
            maxStores: 3,
            maxMembers: null,
          },
          wallet: null,
        })),
        implementMerchantFacts("profile", async (_tx, query) => ({
          stores: Object.fromEntries(
            query.storeIds.map((storeId) => [
              storeId,
              {
                city: { code: "510100", name: "成都" },
                category: { code: "C0101", name: "火锅" },
                verifiedAt: null,
                submittedAt: at,
                expectedDecisionAt: null,
                completenessPct: 60,
              },
            ]),
          ),
        })),
        implementMerchantFacts("order", async (_tx, query) => ({
          stores: Object.fromEntries(
            query.storeIds.map((storeId) => [
              storeId,
              { liveCount: 2, deliveringCount: 1, cartCount: 0, todoCount: 3 },
            ]),
          ),
        })),
        implementMerchantFacts("asset", async (_tx, query) => ({
          stores: Object.fromEntries(query.storeIds.map((id) => [id, { assetCount: 128 }])),
        })),
      ]);
      const list = await withFacts.listStores({ merchantUserId: owner.user.id });
      if (list.viewerRole !== "owner") throw new Error("老板视图的判别字段不对");
      expect(list.entity).toMatchObject({
        subscription: { planName: "专业版", endDate: "2026-10-12", isActive: true },
        storesUsed: 1,
        storeLimit: 3,
        memberLimit: null,
        seatsOver: 0,
        limitReason: "plan",
        canAddStore: true,
      });
      expect(list.items[0]).toMatchObject({
        city: { code: "510100", name: "成都" },
        category: { code: "C0101", name: "火锅" },
        submittedAt: at.toISOString(),
        completenessPct: 60,
        liveCount: 2,
        deliveringCount: 1,
        todoCount: 3,
        assetCount: 128,
      });
    },
    SLOW,
  );
});

describe("不变量 tenant.I1、I7、I27、I29", () => {
  it(
    "经用例建的主体 0 违规；缺老板、缺首店、老板挂了门店的残留被报出",
    async () => {
      const owner = await newOwner();
      // 残留：一个没有老板也没有首店的主体；一位挂了 store_member 的老板
      const orphan = await make.entity();
      const broken = await make.merchant();
      await make.storeMember({
        entityMemberId: broken.owner.id,
        storeId: broken.store.id,
        addedByMemberId: broken.owner.id,
      });

      const ids = (rows: { subject?: object }[]) =>
        rows.map((row) => (row.subject as { id?: string }).id);
      const i1 = ids(await findI1Violations(prisma));
      expect(i1).toContain(orphan.id);
      expect(i1).not.toContain(owner.entityId);
      expect(i1).not.toContain(broken.entity.id);
      const i27 = ids(await findI27Violations(prisma));
      expect(i27).toContain(orphan.id);
      expect(i27).not.toContain(owner.entityId);
      const i29 = await findI29Violations(prisma);
      expect(ids(i29)).toEqual([broken.owner.id]);
      expect(i29[0]).toMatchObject({ entityId: broken.entity.id, detail: { storeMemberRows: 1 } });
      expect(await findI7Violations(prisma)).toEqual([]);
    },
    SLOW,
  );
});
