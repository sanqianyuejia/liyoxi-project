// 工厂的连库用例（任务书 W0-25 第 7 节第 3 条）：每个工厂不给参数能插入——库的 CHECK、外键、唯一索引都过；
// 主键 UUID v7；时间等于注入的时钟；覆盖的字段写进去了；自动造的上级行互相对得上。
// 用带种子的库（角色、套餐、协议清单是种子）；身份是应用角色 lyx_app。
import type { PrismaClient } from "@liyoxi/db";
import { describe, expect, it } from "vitest";

import { createTxRunner, isUuid } from "../../kernel/index.js";
import { phoneBidx, SecurityError, usccBidx } from "../../security/index.js";
import {
  createClock,
  createFactories,
  FACTORY_TABLES,
  openSealed,
  TEST_KEYRING,
  testSealer,
  useSeededDatabase,
  useTestDatabase,
} from "../index.js";
import type { Factories, TableFactories } from "../index.js";

const db = useSeededDatabase("services");
const bare = useTestDatabase("services", { label: "bare" });
// 机器忙时拷库、删库都会慢：时限留足
const TIMEOUT = { timeout: 120_000 };
// 故意不用缺省起点：工厂的时间列取的是这只时钟，与种子的时刻（缺省起点）分得开
const clock = createClock(new Date("2026-03-10T02:30:00.000Z"));

async function setup(): Promise<{ prisma: PrismaClient; make: Factories }> {
  const prisma = await db.prisma();
  return { prisma, make: createFactories({ db: prisma, clock }) };
}

type FactoryName = keyof TableFactories;
const NAMES = Object.keys(FACTORY_TABLES) as FactoryName[];
/** 主键不叫 id 的两张表：取哪一列当“这一行”的键 */
const KEY_COLUMN: Partial<Record<FactoryName, [column: string, field: string]>> = {
  billingAccount: ["entity_id", "entityId"],
  storeMember: ["entity_member_id", "entityMemberId"],
};

async function countOf(prisma: PrismaClient, table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM ${table}`,
  );
  return rows[0]?.n ?? -1;
}

describe("工厂清单", () => {
  it("createFactories 给出的方法 = 一张表一个的那些 + 两个组合", TIMEOUT, async () => {
    const { make } = await setup();
    expect(Object.keys(make).sort()).toEqual([...NAMES, "merchant", "subscribedMerchant"].sort());
    expect(new Set(Object.values(FACTORY_TABLES)).size).toBe(NAMES.length);
  });

  // 按外键顺序逐个来：前面的工厂留下的行（如生效的协议版本），后面的工厂会接着用
  it.each(NAMES)("%s：不给参数能插入，主键 UUID v7，时间取注入的时钟", TIMEOUT, async (name) => {
    const { prisma, make } = await setup();
    const table = FACTORY_TABLES[name];
    const before = await countOf(prisma, table);

    const row = (await make[name]()) as unknown as Record<string, unknown>;

    expect(await countOf(prisma, table)).toBeGreaterThan(before);
    const [column, field] = KEY_COLUMN[name] ?? ["id", "id"];
    const key = String(row[field]);
    expect(isUuid(key)).toBe(true);
    expect(key[14]).toBe("7");
    const stored = await prisma.$queryRawUnsafe<{ created_at: Date }[]>(
      `SELECT created_at FROM ${table} WHERE ${column} = $1::uuid`,
      key,
    );
    expect(stored.map((item) => item.created_at.toISOString())).toContain(
      clock.now().toISOString(),
    );
  });
});

describe("覆盖与敏感字段", () => {
  it("给了的字段照写，没给的取缺省；写 undefined 等于没写", TIMEOUT, async () => {
    const { make } = await setup();
    const entity = await make.entity();
    const store = await make.store({ entityId: entity.id, name: "解放路店", isPrimary: true });
    expect(store).toMatchObject({
      entityId: entity.id,
      name: "解放路店",
      isPrimary: true,
      lifecycle: "active",
      qualificationStatus: "unsubmitted",
    });
    const other = await make.store({ entityId: entity.id, name: undefined });
    expect(other.name).toMatch(/^测试门店\d+$/);
    expect(other.isPrimary).toBe(false);
  });

  it("手机号给明文：工厂做成三件套加后四位；同一个号再插被唯一索引拒掉", TIMEOUT, async () => {
    const { make } = await setup();
    const user = await make.merchantUser({ phone: "+86 138 0013 5678" });
    // 缺省是 security 的真三件套加测试密钥环：真密文（v1:<kid>:…），按列解得回来；盲索引就是 security 按手机号查找用的那个
    expect(user.phoneEnc).toMatch(/^v1:test:/);
    expect(openSealed("merchant_user.phone_enc", user.phoneEnc ?? "")).toBe("13800135678");
    expect(() => openSealed("staff.phone_enc", user.phoneEnc ?? "")).toThrow(SecurityError);
    expect(user.phoneBidx).toHaveLength(32);
    expect(
      Buffer.from(user.phoneBidx ?? []).equals(phoneBidx(TEST_KEYRING, "+86 138 0013 5678")),
    ).toBe(true);
    expect([user.phoneMask, user.phoneLast4]).toEqual(["138****5678", "5678"]);
    await expect(make.merchantUser({ phone: "13800135678" })).rejects.toThrow(
      /uq_merchant_user_phone_bidx|Unique constraint/,
    );
    // 不给手机号：每次一个新的假号
    const [a, b] = [await make.merchantUser(), await make.merchantUser()];
    expect(a.phoneLast4).not.toBe(b.phoneLast4);
  });

  it("三件套可以换：注入的 seal 被用上，列名写的是密文所在的列", TIMEOUT, async () => {
    const prisma = await db.prisma();
    const seen: string[] = [];
    const make = createFactories({
      db: prisma,
      clock,
      seal: {
        ...testSealer,
        phone(column, phone) {
          seen.push(column);
          return { ...testSealer.phone(column, phone), enc: `v1:injected:${phone}` };
        },
      },
    });
    expect((await make.staff({ phone: "13900009999" })).phoneEnc).toBe("v1:injected:13900009999");
    expect((await make.merchantUser()).phoneEnc).toMatch(/^v1:injected:139\d{8}$/);
    expect(seen).toEqual(["staff.phone_enc", "merchant_user.phone_enc"]);
  });

  it("认证通过的主体：名称、类型、信用代码三件套、认证时间跟着补上", TIMEOUT, async () => {
    const { make } = await setup();
    const entity = await make.entity({ verificationStatus: "verified", legalRepName: "王小明" });
    expect(entity.name).toMatch(/^测试主体/);
    expect(entity.entityType).toBe("enterprise");
    expect(entity.verifiedAt?.toISOString()).toBe(clock.now().toISOString());
    const uscc = openSealed("entity.uscc_enc", entity.usccEnc ?? "");
    expect(uscc).toMatch(/^91310000MA1K\d{6}$/);
    expect(Buffer.from(entity.usccBidx ?? []).equals(usccBidx(TEST_KEYRING, uscc))).toBe(true);
    expect(entity.legalRepNameMask).toBe("王**");
    expect(openSealed("entity.legal_rep_name_enc", entity.legalRepNameEnc ?? "")).toBe("王小明");
  });
});

describe("跟着状态走的缺省", () => {
  it("短剧：缺省已上架；草稿没有上架时间；下架带时间与原因", TIMEOUT, async () => {
    const { make } = await setup();
    const listed = await make.drama();
    expect([listed.status, listed.listedAt !== null]).toEqual(["listed", true]);
    const draft = await make.drama({ status: "draft", createdByStaffId: listed.createdByStaffId });
    expect([draft.firstListedAt, draft.listedAt]).toEqual([null, null]);
    const delisted = await make.drama({ status: "delisted" });
    expect(delisted.delistReasonCode).toBe("ops_strategy");
    // 剧集的集号接着往下排
    const first = await make.dramaEpisode({ dramaId: listed.id });
    const second = await make.dramaEpisode({ dramaId: listed.id });
    expect([first.episodeNo, second.episodeNo]).toEqual([1, 2]);
  });

  it("付款单：缺省已支付并带一条指回来的成功流水；待支付、已取消各自合法", TIMEOUT, async () => {
    const { prisma, make } = await setup();
    const paid = await make.billingOrder({ amountFen: 300_000 });
    expect(paid).toMatchObject({
      status: "paid",
      paidAmountFen: 300_000,
      fulfillmentStatus: "done",
    });
    const txn = await prisma.paymentTxn.findUniqueOrThrow({
      where: { id: paid.paidPaymentTxnId ?? "" },
    });
    expect(txn).toMatchObject({
      billingOrderId: paid.id,
      entityId: paid.entityId,
      status: "succeeded",
      amountFen: 300_000,
    });
    expect(txn.appliedAt?.toISOString()).toBe(clock.now().toISOString());

    const pending = await make.billingOrder({ status: "pending_payment" });
    expect([pending.paidAt, pending.paidPaymentTxnId, pending.fulfillmentStatus]).toEqual([
      null,
      null,
      "none",
    ]);
    const cancelled = await make.billingOrder({ status: "cancelled", type: "topup" });
    expect(cancelled.cancelReason).toBe("timeout");
    expect(cancelled.contentSnapshot).toEqual({ kind: "topup" });
  });

  it("订阅周期：权益抄自种子的套餐；日期按北京时间；待生效的没有生效时间", TIMEOUT, async () => {
    const { prisma, make } = await setup();
    const term = await make.subscriptionTerm();
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: term.planId } });
    expect(plan.code).toBe("basic");
    expect(term).toMatchObject({ status: "active", months: 1, anchorDay: 10, termNo: 1 });
    expect(term.startDate.toISOString()).toBe("2026-03-10T00:00:00.000Z");
    expect(term.endDate.toISOString()).toBe("2026-04-09T00:00:00.000Z");
    // 止日 24:00（北京时间）
    expect(term.endsAt.toISOString()).toBe("2026-04-09T16:00:00.000Z");
    const source = await prisma.billingOrder.findUniqueOrThrow({
      where: { id: term.sourceBillingOrderId },
    });
    expect([source.status, source.amountFen, source.entityId]).toEqual([
      "paid",
      term.priceTotalFen,
      term.entityId,
    ]);

    const pro = await prisma.plan.findUniqueOrThrow({ where: { code: "pro" } });
    const scheduled = await make.subscriptionTerm({ planId: pro.id, status: "scheduled" });
    expect([scheduled.activatedAt, scheduled.discountBp]).toEqual([null, 9000]);
    // 同一个主体已有生效的一期：再造一期生效的被库拒掉
    await expect(make.subscriptionTerm({ entityId: term.entityId })).rejects.toThrow();
  });

  it("订购单、订单项、冻结单、工单：换状态时相关的列跟着补", TIMEOUT, async () => {
    const { prisma, make } = await setup();
    const live = await make.orderItem({ phase: "live" });
    expect(live.capturedAt).not.toBeNull();
    expect(live.usageStartDate?.toISOString()).toBe("2026-03-10T00:00:00.000Z");
    const liveOrder = await prisma.dramaOrder.findUniqueOrThrow({
      where: { id: live.dramaOrderId },
    });
    expect([liveOrder.status, liveOrder.subStatus]).toEqual(["live", "in_service"]);
    expect(liveOrder.startedAt).not.toBeNull();

    const cancelled = await make.orderItem({ phase: "cancelled" });
    expect([cancelled.capturedAt, cancelled.cancelReasonCode]).toEqual([null, "merchant_request"]);
    const released = await prisma.pointHold.findUniqueOrThrow({
      where: { id: cancelled.pointHoldId },
    });
    expect([released.status, released.returnedQty, released.qty]).toEqual(["released", 100, 100]);

    const ended = await make.dramaOrder({ status: "ended" });
    expect([ended.subStatus, ended.closedAt !== null]).toEqual([null, true]);

    const confirming = await make.deliveryTicket({ step: "plan_confirm", waitingOn: "merchant" });
    expect(confirming.deliveryManagerId).not.toBeNull();
    expect(confirming.assignedAt).not.toBeNull();
    const archived = await make.deliveryTicket({ step: "archived" });
    expect(archived.archivedAt).not.toBeNull();
  });
});

describe("自动造的上级行互相对得上", () => {
  it(
    "一张工单带出的整串：同一个主体与门店，单号、状态、同意记录、冻结单都接得上",
    TIMEOUT,
    async () => {
      const { prisma, make } = await setup();
      const ticket = await make.deliveryTicket();
      const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: ticket.orderItemId } });
      const order = await prisma.dramaOrder.findUniqueOrThrow({ where: { id: item.dramaOrderId } });
      const hold = await prisma.pointHold.findUniqueOrThrow({ where: { id: item.pointHoldId } });
      const consent = await prisma.agreementConsent.findUniqueOrThrow({
        where: { id: order.agreementConsentId },
      });
      const account = await prisma.billingAccount.findUniqueOrThrow({
        where: { entityId: order.entityId },
      });
      const entity = await prisma.entity.findUniqueOrThrow({ where: { id: order.entityId } });
      const store = await prisma.store.findUniqueOrThrow({ where: { id: order.storeId } });

      expect(ticket).toMatchObject({
        step: "assigning",
        deliveryManagerId: null,
        dramaOrderId: order.id,
        dramaId: item.dramaId,
        entityId: order.entityId,
        storeId: order.storeId,
      });
      expect(order.orderNo).toMatch(/^LYX202603109\d{4}$/);
      expect(ticket.ticketNo).toBe(`JF${order.orderNo.slice(3)}-1`);
      expect([order.status, order.subStatus, item.phase, hold.status]).toEqual([
        "producing",
        "assigning",
        "producing",
        "captured",
      ]);
      expect([order.itemCount, order.totalChargePoints, item.itemNo, item.chargePoints]).toEqual([
        1, 100, 1, 100,
      ]);
      expect(hold).toMatchObject({
        refType: "order_item",
        refId: item.id,
        qty: item.chargePoints,
        entityId: order.entityId,
        storeId: order.storeId,
        subscriptionTermId: order.subscriptionTermId,
      });
      expect(consent).toMatchObject({
        scene: "order_submit",
        agreementKey: "custom_license",
        bizType: "drama_order",
        bizId: order.id,
        bizNo: order.orderNo,
        merchantUserId: order.placedByUserId,
        entityId: order.entityId,
        storeId: order.storeId,
      });
      // 商家是“已认证、已开通套餐”的：计费账户指着订购单用的那一期
      expect([entity.verificationStatus, store.qualificationStatus, store.isPrimary]).toEqual([
        "verified",
        "verified",
        true,
      ]);
      expect(account).toMatchObject({
        subStatus: "active",
        currentSubscriptionTermId: order.subscriptionTermId,
      });
      expect(entity.createdByUserId).toBe(order.placedByUserId);
    },
  );

  it("给了上级行：在它上面补齐，不另起一串", TIMEOUT, async () => {
    const { prisma, make } = await setup();
    const merchant = await make.subscribedMerchant();
    const order = await make.dramaOrder({
      entityId: merchant.entity.id,
      storeId: merchant.store.id,
      itemCount: 2,
      totalChargePoints: 250,
    });
    expect([order.placedByUserId, order.subscriptionTermId]).toEqual([
      merchant.user.id,
      merchant.term.id,
    ]);
    const first = await make.orderItem({ dramaOrderId: order.id });
    const second = await make.orderItem({ dramaOrderId: order.id, chargePoints: 150 });
    expect([first.itemNo, second.itemNo]).toEqual([1, 2]);
    expect([second.entityId, second.storeId]).toEqual([merchant.entity.id, merchant.store.id]);
    expect(await prisma.subscriptionTerm.count({ where: { entityId: merchant.entity.id } })).toBe(
      1,
    );
    const ticket = await make.deliveryTicket({ orderItemId: second.id });
    expect(ticket.ticketNo).toBe(`JF${order.orderNo.slice(3)}-2`);
    expect(ticket.dramaId).toBe(second.dramaId);
  });

  it(
    "成员：没给主体是老板；给了主体缺省是店员；店员进门店时四个外键同属一个主体",
    TIMEOUT,
    async () => {
      const { prisma, make } = await setup();
      const merchant = await make.merchant();
      expect(merchant.owner).toMatchObject({
        role: "owner",
        merchantUserId: merchant.user.id,
        lastStoreId: merchant.store.id,
      });
      expect(merchant.billingAccount).toMatchObject({ subStatus: "none", planAvailableQty: 0 });
      const clerk = await make.entityMember({ entityId: merchant.entity.id });
      expect(clerk.role).toBe("clerk");
      const link = await make.storeMember({ entityMemberId: clerk.id });
      expect(link).toMatchObject({
        entityId: merchant.entity.id,
        addedByMemberId: merchant.owner.id,
      });
      const store = await prisma.store.findUniqueOrThrow({ where: { id: link.storeId } });
      expect(store.entityId).toBe(merchant.entity.id);

      const alone = await make.entityMember();
      const entity = await prisma.entity.findUniqueOrThrow({ where: { id: alone.entityId } });
      expect([alone.role, alone.merchantUserId]).toEqual(["owner", entity.createdByUserId]);
    },
  );
});

describe("往哪插", () => {
  it("传事务句柄：行写在这个事务里，回滚就都没了", TIMEOUT, async () => {
    const prisma = await db.prisma();
    const tx = createTxRunner({ prisma, appEnv: "test" });
    const before = await countOf(prisma, "store");
    let storeId = "";
    await expect(
      tx.run(async (handle) => {
        const store = await createFactories({ db: handle, clock }).store();
        storeId = store.id;
        expect(await handle.store.count({ where: { id: store.id } })).toBe(1);
        throw new Error("用例要它回滚");
      }),
    ).rejects.toThrow("用例要它回滚");
    expect(await prisma.store.count({ where: { id: storeId } })).toBe(0);
    expect(await countOf(prisma, "store")).toBe(before);
  });

  it("库里没有种子：要种子的工厂给一句看得懂的话", TIMEOUT, async () => {
    const make = createFactories({ db: await bare.prisma(), clock });
    await expect(make.subscriptionTerm()).rejects.toThrow(/useSeededDatabase/);
    // 不要种子的工厂照常能用
    expect((await make.merchant()).store.isPrimary).toBe(true);
  });
});
