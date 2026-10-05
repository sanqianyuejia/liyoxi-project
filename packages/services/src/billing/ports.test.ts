import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { createEvents } from "../events/index.js";
import { createFlow } from "../flow/index.js";
import {
  createIdentityContext,
  KernelViolation,
  lockRows,
  merchantFactsOf,
} from "../kernel/index.js";
import type { Assembly, MerchantFactsQuery } from "../kernel/index.js";
import { billingAccountPort, createTenant } from "../tenant/index.js";
import type { Tenant } from "../tenant/index.js";
import {
  assembleForTest,
  createFulfillHarness,
  fulfillOrder,
  paidPlanOrder,
  topUp,
  useSeededDatabase,
} from "../testing/index.js";
import type { FulfillHarness } from "../testing/index.js";
import { billingAccountOpener } from "./ports.js";
import { registration as tenantRegistration } from "../tenant/index.js";

// 验收 8：billing 实现的两个端口，都经真实的装配取（没有样例实现顶替）。
//   计费账户端口：tenant 的建主体用例同事务建出 billing_account 一行；事务回滚则不留；装配里登记的是 billing 的实现，桩已删。
//   事实端口的 billing 键：开通前是未生效的形态，开通后是当前周期的版本与名额，过期后仍给最近一期。

const SLOW = 120_000;
const at = (local: string): Date => new Date(`${local}+08:00`);

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let h: FulfillHarness;
let assembly: Assembly;
let tenant: Tenant;

beforeAll(async () => {
  prisma = await db.prisma();
  h = createFulfillHarness(prisma);
  assembly = assembleForTest({ entry: "api" });
  const flow = createFlow({
    assembly,
    clock: h.clock,
    events: createEvents({ assembly, clock: h.clock, tx: h.tx }),
  });
  tenant = createTenant({ tx: h.tx, clock: h.clock, flow, assembly });
}, SLOW);

describe("计费账户端口（验收 8）", () => {
  it("装配里登记的是 billing 的实现：tenant 自己不再登记桩", () => {
    expect(assembly.port(billingAccountPort)).toBe(billingAccountOpener);
    expect(
      (tenantRegistration.portImplementations ?? []).some(
        (item) => item.port === billingAccountPort,
      ),
    ).toBe(false);
  });

  it(
    "建主体的用例：同事务出现 billing_account 一行（从未开通、余额为 0，时间取主体的创建时间）",
    async () => {
      h.clock.set(at("2026-01-05T12:00:00"));
      const user = await h.make.merchantUser();
      const ctx = createIdentityContext({
        actor: { type: "merchant", id: user.id, client: "weapp" },
      });
      const created = await tenant.createEntity(ctx);
      expect(created.isNew).toBe(true);
      const entity = await prisma.entity.findUniqueOrThrow({ where: { id: created.entityId } });
      expect(
        await prisma.billingAccount.findUniqueOrThrow({ where: { entityId: created.entityId } }),
      ).toMatchObject({
        subStatus: "none",
        currentSubscriptionTermId: null,
        planAvailableQty: 0,
        addonAvailableQty: 0,
        heldTotalQty: 0,
        nextDueAt: null,
        lastOpAt: null,
        createdAt: entity.createdAt,
        updatedAt: entity.createdAt,
      });
      // 已是老板再调：返回已有主体，账户还是那一行
      expect((await tenant.createEntity(ctx)).isNew).toBe(false);
      expect(await prisma.billingAccount.count({ where: { entityId: created.entityId } })).toBe(1);
    },
    SLOW,
  );

  it(
    "事务回滚则不留；同一事务里再调一次不多建；建完之后再锁别的表，锁序断言会报",
    async () => {
      const opener = assembly.port(billingAccountPort);
      const ctx = createIdentityContext({ actor: { type: "system", job: "lyxtest.ports" } });
      const { entity, store } = await h.make.merchant();
      await prisma.billingAccount.delete({ where: { entityId: entity.id } });

      class Rollback extends Error {}
      const failed = await h.tx
        .run(async (tx) => {
          await opener.ensureForEntity(tx, ctx, entity.id);
          await opener.ensureForEntity(tx, ctx, entity.id);
          expect(await tx.billingAccount.count({ where: { entityId: entity.id } })).toBe(1);
          throw new Rollback();
        })
        .catch((error: unknown) => error);
      expect(failed).toBeInstanceOf(Rollback);
      expect(await prisma.billingAccount.count({ where: { entityId: entity.id } })).toBe(0);

      // 计费账户排在加锁顺序的最后：端口的实现锁住了它，之后再锁门店即违规
      const violation = await h.tx
        .run(async (tx) => {
          await opener.ensureForEntity(tx, ctx, entity.id);
          await lockRows(tx, "store", [store.id]);
        })
        .catch((error: unknown) => error);
      expect(violation).toBeInstanceOf(KernelViolation);
      expect(await prisma.billingAccount.count({ where: { entityId: entity.id } })).toBe(0);
    },
    SLOW,
  );
});

describe("事实端口的 billing 键（验收 8）", () => {
  it(
    "开通前未生效；开通后给当前周期的版本、名额与积分；过期后仍给最近一期；tenant 的额度跟着变",
    async () => {
      const facts = merchantFactsOf(assembly);
      expect(facts.has("billing")).toBe(true);
      h.clock.set(at("2026-01-05T12:00:00"));
      const { entity, store, user } = await h.make.merchant({ verified: true });
      const query = (): MerchantFactsQuery => ({
        entityId: entity.id,
        storeIds: [store.id],
        viewerRole: "owner",
        merchantUserId: user.id,
        now: h.clock.now(),
      });
      const read = () => h.tx.run((tx) => facts.source(tx, "billing", query()));
      const quota = () => h.tx.run((tx) => tenant.getQuotaUsage(tx, entity.id));

      expect(await read()).toEqual({
        subscription: null,
        wallet: {
          status: "none",
          isRefundPending: false,
          planName: null,
          endDate: null,
          remainingDays: null,
          spendablePoints: 0,
          planAvailablePoints: 0,
          addonAvailablePoints: 0,
          planPointsExpireAt: null,
          isAddonSuspended: false,
        },
      });
      expect(await quota()).toMatchObject({ limitReason: "inactive" });

      await fulfillOrder(h, await paidPlanOrder(h, { entityId: entity.id }));
      await topUp(h, { entityId: entity.id, points: 500 });
      h.clock.set(at("2026-01-10T09:00:00"));
      expect(await read()).toEqual({
        subscription: {
          planName: "专业版",
          endDate: "2026-02-04",
          isActive: true,
          maxStores: 3,
          maxMembers: 10,
        },
        wallet: {
          status: "active",
          isRefundPending: false,
          planName: "专业版",
          endDate: "2026-02-04",
          remainingDays: 25,
          spendablePoints: 7100,
          planAvailablePoints: 6600,
          addonAvailablePoints: 500,
          planPointsExpireAt: at("2026-02-05T00:00:00"),
          isAddonSuspended: false,
        },
      });
      expect(await quota()).toMatchObject({ storeLimit: 3, memberLimit: 10, limitReason: "plan" });

      // 到期了还没人推进：按周期起止现算，已是过期；最近一期的版本还在，积分花不了
      h.clock.set(at("2026-02-06T09:00:00"));
      expect(await read()).toMatchObject({
        subscription: { planName: "专业版", endDate: "2026-02-04", isActive: false },
        wallet: {
          status: "expired",
          spendablePoints: 0,
          planAvailablePoints: 0,
          addonAvailablePoints: 500,
          isAddonSuspended: true,
        },
      });
      expect(await quota()).toMatchObject({ limitReason: "inactive" });
    },
    SLOW,
  );
});
