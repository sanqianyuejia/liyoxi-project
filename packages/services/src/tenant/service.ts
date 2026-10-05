// tenant 的装配入口（W1-03）：把时钟、开事务的入口、状态迁移与两个端口绑上，给出主体与门店的全部函数。
// api、worker 启动时各建一次（createFlow 之后）。
//
//   const tenant = createTenant({ tx, clock, flow, assembly });
//   await tenant.createEntity(ctx, { idem });                           // 用例：自己开事务
//   await tx.run((handle) => tenant.resolveMembership(handle, { merchantUserId, storeId }));   // 在调用方的事务里
import type { MembershipResult, StoreList } from "@liyoxi/contract";

import type { Flow } from "../flow/index.js";
import { isUniqueViolation, merchantFactsOf } from "../kernel/index.js";
import type {
  Assembly,
  Clock,
  IdempotencyContext,
  IdentityContext,
  Tx,
  TxRunner,
} from "../kernel/index.js";
import {
  createEntityIn,
  existingMembershipResult,
  ONE_ENTITY_CONSTRAINT,
} from "./create-entity.js";
import { resolveMembership } from "./membership.js";
import type { StoreMembership } from "./membership.js";
import { billingAccountPort } from "./ports.js";
import { setDeliveryManager, setStoreName, setStoreQualification } from "./qualification.js";
import type { StoreQualificationInput, StoreQualificationResult } from "./qualification.js";
import { getQuotaUsage } from "./quota.js";
import type { QuotaUsage } from "./quota.js";
import { selectActiveMembership } from "./repo.js";
import type { ActiveMembership, TenantReader } from "./repo.js";
import { listStores, rememberCurrentStore } from "./stores.js";

export interface TenantDeps {
  /** 开事务的入口：用例函数用它 */
  readonly tx: TxRunner;
  /** 业务时钟 */
  readonly clock: Clock;
  /** 状态迁移（createFlow 给的）：主体、门店、成员关系的状态只经它改 */
  readonly flow: Flow;
  /** 装配结果：计费账户端口与事实端口的实现从这里取 */
  readonly assembly: Pick<Assembly, "port" | "portEntries">;
}

export interface UseCaseOptions {
  /** 幂等上下文：路由层按路由元数据建好交进来 */
  readonly idem?: IdempotencyContext;
}

export interface Tenant {
  // ---------- 用例函数：自己开事务 ----------
  /** m.entity.create：懒创建主体、首店、老板成员关系，经端口建计费账户。操作人须是商家用户 */
  createEntity(ctx: IdentityContext, options?: UseCaseOptions): Promise<MembershipResult>;
  /** m.store.list：按账号的有效成员关系现算；老板、店员、没有成员关系三种形状 */
  listStores(viewer: { merchantUserId: string }): Promise<StoreList>;
  /** m.me.currentStore.replace：门店进不去即 NOT_FOUND */
  rememberCurrentStore(
    input: { merchantUserId: string; storeId: string },
    options?: UseCaseOptions,
  ): Promise<{ storeId: string }>;

  // ---------- 在调用方的事务里 ----------
  /** 账号此刻的有效成员关系（V1.0 至多一条）；没有即 null */
  activeMembership(db: TenantReader, merchantUserId: string): Promise<ActiveMembership | null>;
  /** 成员关系解析：进不去即 null；老板进自己停用的门店是收尾上下文 */
  resolveMembership(
    db: TenantReader,
    input: { merchantUserId: string; storeId: string },
  ): Promise<StoreMembership | null>;
  /** 额度与名额的唯一口径：读时现算 */
  getQuotaUsage(tx: Tx, entityId: string): Promise<QuotaUsage>;
  /** 资质 initial 轮次的提交、通过、驳回、撤回：门店与主体两条链同事务 */
  setStoreQualification(
    tx: Tx,
    ctx: IdentityContext,
    input: StoreQualificationInput,
  ): Promise<StoreQualificationResult>;
  /** 首店起名 */
  setStoreName(
    tx: Tx,
    ctx: IdentityContext,
    input: { storeId: string; name: string },
  ): Promise<{ storeId: string; name: string }>;
  /** 改门店的交付经理并写审计 */
  setDeliveryManager(
    tx: Tx,
    ctx: IdentityContext,
    input: { storeId: string; staffId: string | null },
  ): Promise<{ storeId: string; previousStaffId: string | null; staffId: string | null }>;
}

export function createTenant(deps: TenantDeps): Tenant {
  const { flow } = deps;
  const now = (): Date => deps.clock.now();
  const facts = merchantFactsOf(deps.assembly);
  const billingAccount = deps.assembly.port(billingAccountPort);
  return {
    async createEntity(ctx, options = {}) {
      try {
        return await deps.tx.run(
          (tx) => createEntityIn(tx, { flow, billingAccount }, now(), ctx),
          options,
        );
      } catch (error) {
        // 并发兜底：同一账号的请求本该在账号行锁上排队；万一还是撞了“一个账号只属于一个主体”，
        // 事务已回滚，按“已有成员关系”再看一遍（老板返回已有主体，店员是 ALREADY_IN_ENTITY）
        if (!isUniqueViolation(error, [ONE_ENTITY_CONSTRAINT]) || ctx.actor.id === null) {
          throw error;
        }
        const merchantUserId = ctx.actor.id;
        const existing = await deps.tx.run((tx) => existingMembershipResult(tx, merchantUserId));
        if (existing === null) throw error;
        return existing;
      }
    },
    listStores: (viewer) => deps.tx.run((tx) => listStores(tx, { facts }, now(), viewer)),
    rememberCurrentStore: (input, options = {}) =>
      deps.tx.run((tx) => rememberCurrentStore(tx, now(), input), options),
    activeMembership: (db, merchantUserId) => selectActiveMembership(db, merchantUserId),
    resolveMembership: (db, input) => resolveMembership(db, input),
    getQuotaUsage: (tx, entityId) => getQuotaUsage(tx, { facts }, now(), entityId),
    setStoreQualification: (tx, ctx, input) =>
      setStoreQualification(tx, { flow }, now(), ctx, input),
    setStoreName: (tx, ctx, input) => setStoreName(tx, now(), ctx, input),
    setDeliveryManager: (tx, ctx, input) => setDeliveryManager(tx, now(), ctx, input),
  };
}
