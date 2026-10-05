import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import {
  assertSnapshotsEqual,
  captureHold,
  createLedgerHarness,
  dumpLedger,
  holdDrama,
  openTerm,
  ownerContext,
  refundHold,
  releaseHold,
  snapshotTables,
  useSeededDatabase,
} from "../../testing/index.js";
import { uuidv7 } from "../../kernel/index.js";
import type { LedgerHarness } from "../../testing/index.js";
import { LEDGER_STEPS } from "./index.js";
import type { LedgerStep } from "./index.js";

// 验收 9：故障注入。在账本的每个写步骤之后抛错：事务回滚后八张表（连同订阅事件与出站事件）无残留，
// 按原来的键重试成功，结果与没出过故障的对照主体逐项相同。
// 三个场景合起来走到登记的全部步骤：加购入账（新批次、操作行、流水、账户、事件）；
// 一次推进里的清零、接续、发首月（已有批次的桶、周期、订阅事件、发放计划）；
// 冻结单一族（新冻结单、分摊行、冻结单的状态、原周期已结束时转为加购的新批次）。

const SLOW = 180_000;
const TABLES = [
  "billing_account",
  "subscription_term",
  "subscription_event",
  "grant_schedule",
  "point_lot",
  "point_hold",
  "point_hold_alloc",
  "ledger_operation",
  "point_ledger_entry",
  "outbox_event",
];
const at = (local: string): Date => new Date(`${local}+08:00`);

class Injected extends Error {}

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let h: LedgerHarness;
/** 第几步之后抛错；null 即只记不抛 */
let failAt: number | null = null;
let seen: LedgerStep[] = [];
/** 各场景合起来走到过的步骤 */
const covered = new Set<LedgerStep>();

beforeAll(async () => {
  prisma = await db.prisma();
  h = createLedgerHarness(prisma, {
    onStep: (step) => {
      seen.push(step);
      if (failAt !== null && seen.length === failAt) throw new Injected(`第 ${failAt} 步 ${step}`);
    },
  });
}, SLOW);

/** 逐步注入：每一步各失败一次，每次都核对无残留；最后不注入，成功。返回走过的步骤 */
async function failEveryStep(run: () => Promise<unknown>): Promise<LedgerStep[]> {
  const before = await snapshotTables(prisma, TABLES);
  for (let step = 1; ; step += 1) {
    failAt = step;
    seen = [];
    const outcome = await run().then(
      () => "done",
      (error: unknown) => error,
    );
    if (outcome === "done") {
      failAt = null;
      return seen;
    }
    expect(outcome, `第 ${step} 步`).toBeInstanceOf(Injected);
    assertSnapshotsEqual(before, await snapshotTables(prisma, TABLES));
  }
}

describe("故障注入（验收 9）", () => {
  it(
    "加购入账：每个写步骤之后抛错都无残留，按原键重试成功且只入账一次",
    async () => {
      h.clock.set(at("2026-01-05T12:00:00"));
      const { entity, user } = await h.make.merchant({ verified: true });
      await openTerm(h, { entityId: entity.id });
      const order = await h.make.billingOrder({
        entityId: entity.id,
        type: "topup",
        amountFen: 100_000,
      });
      const purchase = () =>
        h.tx.run((tx) =>
          h.ledger.purchase(tx, {
            entityId: entity.id,
            billingOrderId: order.id,
            points: 1000,
            payFen: 100_000,
            ctx: ownerContext(entity.id, user.id),
          }),
        );
      const steps = await failEveryStep(purchase);
      expect(steps).toEqual([
        "lot.insert",
        "operation.insert",
        "entry.insert",
        "account.update",
        "event.emit",
      ]);
      expect(await prisma.pointLot.count({ where: { entityId: entity.id, kind: "addon" } })).toBe(
        1,
      );
      expect((await purchase()).replayed).toBe(true);
    },
    SLOW,
  );

  it(
    "推进（发放、清零、接续、发首月、再到期停用）：每个写步骤之后抛错都无残留，重试的结果与对照主体相同",
    async () => {
      const prepare = async (): Promise<string> => {
        h.clock.set(at("2026-01-05T12:00:00"));
        const { entity } = await h.make.merchant({ verified: true });
        const first = await openTerm(h, { entityId: entity.id, months: 3 });
        await openTerm(h, { entityId: entity.id, after: first.term });
        return entity.id;
      };
      const control = await prepare();
      const victim = await prepare();
      // 一次追赶：第 2、3 个月的发放 → 清零 → 接续 → 首月 → 再清零 → 停用
      h.clock.set(at("2026-05-10T10:00:00"));
      await h.tx.run((tx) => h.ledger.advance(tx, control));

      const steps = await failEveryStep(() => h.tx.run((tx) => h.ledger.advance(tx, victim)));
      for (const step of steps) covered.add(step);
      expect(steps.length).toBeGreaterThan(30);
      expect(await dumpLedger(prisma, victim)).toEqual(await dumpLedger(prisma, control));
    },
    SLOW,
  );
  it(
    "冻结、扣减、释放、退回（含原周期已结束转为加购）：每个写步骤之后抛错都无残留，按原键重试成功",
    async () => {
      h.clock.set(at("2026-07-01T12:00:00"));
      const drama = await h.make.drama({ heatTier: "A" });
      const prepare = async () => {
        const { entity, store } = await h.make.merchant({ verified: true });
        await openTerm(h, { entityId: entity.id });
        return { entityId: entity.id, storeId: store.id, dramaId: drama.id };
      };
      const [control, victim] = [await prepare(), await prepare()];
      // 每一步都用固定的业务引用：重试是同一个操作键
      const script = async (who: typeof control, wrap: typeof failEveryStep) => {
        const steps: LedgerStep[] = [];
        const refs = { first: uuidv7(), second: uuidv7(), line: uuidv7() };
        h.clock.set(at("2026-07-02T12:00:00"));
        steps.push(...(await wrap(() => holdDrama(h, { ...who, refId: refs.first }))));
        steps.push(...(await wrap(() => holdDrama(h, { ...who, refId: refs.second }))));
        const [first, second] = [
          await holdDrama(h, { ...who, refId: refs.first }),
          await holdDrama(h, { ...who, refId: refs.second }),
        ];
        expect([first.replayed, second.replayed]).toEqual([true, true]);
        steps.push(...(await wrap(() => releaseHold(h, first.pointHoldId))));
        steps.push(...(await wrap(() => captureHold(h, second.pointHoldId))));
        // 周期结束（没有续费）之后退回：原批次已不可用，转为加购积分
        h.clock.set(at("2026-08-02T12:00:00"));
        await h.tx.run((tx) => h.ledger.advance(tx, who.entityId));
        steps.push(
          ...(await wrap(() =>
            refundHold(h, {
              pointHoldId: second.pointHoldId,
              qty: 1000,
              cancelRequestLineId: refs.line,
            }),
          )),
        );
        return steps;
      };
      await script(control, async (run) => {
        await run();
        return [];
      });
      const steps = await script(victim, failEveryStep);
      for (const step of steps) covered.add(step);
      expect(steps).toEqual(
        expect.arrayContaining(["hold.insert", "alloc.write", "hold.update", "lot.convert"]),
      );
      expect(await dumpLedger(prisma, victim.entityId)).toEqual(
        await dumpLedger(prisma, control.entityId),
      );
    },
    SLOW,
  );

  it("三个场景合起来，注入点覆盖了登记的全部步骤", () => {
    expect(covered).toEqual(new Set(LEDGER_STEPS));
  });
});
