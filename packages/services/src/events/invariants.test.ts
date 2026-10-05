import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { createIdentityContext, uuidv7 } from "../kernel/index.js";
import type { InvariantViolation } from "../kernel/index.js";
import {
  createSampleEvents,
  SAMPLE_SUBSCRIBERS,
  sampleSystemContext,
  useTestDatabase,
} from "../testing/index.js";
import type { SampleEvents } from "../testing/index.js";
import { SLOW } from "./__fixtures__/db.js";
import { findI8Violations, I8_DELIVERY_MAX_OVERDUE_MS, I8_EVENT_MAX_AGE_MS } from "./invariants.js";

// 验收第 8 条：events.I8。一条 6 分钟前仍未展开的事件、一条 16 分钟前已到期仍 pending 的投递行，各报 1 条；
// 正常数据 0 条；测试装配能收集到本模块登记的不变量项。
// 用例一条接一条在同一个库上跑，后面的看得到前面留下的行：每条只断言自己造的那几行。

const MINUTE = 60_000;
const db = useTestDatabase("services");
let prisma: PrismaClient;
let sample: SampleEvents;

beforeAll(async () => {
  prisma = await db.prisma();
  sample = createSampleEvents(prisma);
}, SLOW);

/** 发一条样例事件，发生时间是“真实的现在”往前 agoMs（不变量拿它与数据库时间比） */
async function emitAgo(agoMs: number, entityId: string | null = null): Promise<string> {
  sample.clock.set(new Date(Date.now() - agoMs));
  const dramaOrderId = uuidv7();
  const ctx =
    entityId === null
      ? sampleSystemContext()
      : createIdentityContext({ actor: { type: "system", job: "lyxtest.job" }, entityId });
  const result = await sample.tx.run((tx) =>
    sample.events.emit(tx, ctx, {
      type: "lyxtest.order.placed",
      aggregate: { type: "drama_order", id: dramaOrderId },
      payload: { v: 1, dramaOrderId },
    }),
  );
  return result.id as string;
}
const check = (now?: Date): Promise<InvariantViolation[]> =>
  sample.tx.run((tx) => findI8Violations(tx, now === undefined ? {} : { now }));
const about = (violations: readonly InvariantViolation[], eventId: string): InvariantViolation[] =>
  violations.filter((violation) => JSON.stringify(violation.subject).includes(eventId));
/** 把一行投递行改成给定的状态，到期时间挪到数据库时间往前 minutes 分钟（负数即往后，退避中） */
const setDelivery = (
  eventId: string,
  subscriber: string,
  status: string,
  minutesAgo: number,
): Promise<number> =>
  prisma.$executeRawUnsafe(
    `UPDATE outbox_delivery
     SET status = $3, next_attempt_at = now() - make_interval(mins => $4::int), updated_at = now(),
         lease_until = CASE WHEN $3 = 'leased' THEN now() - interval '1 hour' END,
         consumed_at = CASE WHEN $3 = 'done' THEN now() END
     WHERE outbox_event_id = $1::uuid AND subscriber = $2`,
    eventId,
    subscriber,
    status,
    minutesAgo,
  );

describe("events.I8（验收 8）", () => {
  it("阈值照 01 分组 第 2.3、2.4 节：5 分钟、15 分钟", () => {
    expect([I8_EVENT_MAX_AGE_MS, I8_DELIVERY_MAX_OVERDUE_MS]).toEqual([5 * MINUTE, 15 * MINUTE]);
  });

  it("正常数据 0 条：刚发的事件、刚展开的投递行都不报", async () => {
    expect(await check()).toEqual([]);
    const fresh = await emitAgo(0);
    const young = await emitAgo(4 * MINUTE);
    expect(await check()).toEqual([]);
    await sample.events.expand();
    expect(await check()).toEqual([]);
    expect(
      await prisma.outboxDelivery.count({ where: { outboxEventId: { in: [fresh, young] } } }),
    ).toBe(2 * SAMPLE_SUBSCRIBERS.length);
  });

  it("一条 6 分钟前仍未展开的事件：报 1 条；展开后不再报", async () => {
    const entityId = uuidv7();
    const stale = await emitAgo(6 * MINUTE, entityId);
    const violations = await check();
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      subject: { type: "outbox_event", id: stale },
      entityId,
      detail: {
        problem: "unexpanded",
        eventType: "lyxtest.order.placed",
        occurredAt: expect.any(String),
      },
    });
    await sample.events.expand();
    expect(await check()).toEqual([]);
  });

  it("不带主体的事件：违规不带 entityId", async () => {
    const stale = await emitAgo(6 * MINUTE);
    const [violation] = about(await check(), stale);
    expect(violation).toBeDefined();
    expect(violation).not.toHaveProperty("entityId");
    await sample.events.expand();
  });

  it("一条 16 分钟前已到期仍 pending 的投递行：报 1 条；退避中的、已派发的、已消费的、死信不报", async () => {
    const entityId = uuidv7();
    const eventId = await emitAgo(0, entityId);
    const other = await emitAgo(0);
    await sample.events.expand();
    const [first, second, third] = SAMPLE_SUBSCRIBERS;
    expect(await setDelivery(eventId, first, "pending", 16)).toBe(1);
    // 到期 14 分钟的还不算；退避中的 retry 到期时间在后面
    await setDelivery(eventId, second, "pending", 14);
    await setDelivery(eventId, third, "retry", -30);
    await setDelivery(other, first, "leased", 60);
    await setDelivery(other, second, "done", 60);
    await setDelivery(other, third, "dead", 60);

    const violations = await check();
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      subject: { type: "outbox_delivery", key: `${eventId}:${first}` },
      entityId,
      detail: {
        problem: "undispatched",
        eventType: "lyxtest.order.placed",
        status: "pending",
        attempts: 0,
        nextAttemptAt: expect.any(String),
      },
    });

    // 重试到期后一直没人派发的 retry 也算
    await setDelivery(eventId, third, "retry", 20);
    expect(about(await check(), eventId).map((item) => item.subject)).toEqual([
      { type: "outbox_delivery", key: `${eventId}:${third}` },
      { type: "outbox_delivery", key: `${eventId}:${first}` },
    ]);
    // 收拾：都改回刚到期，后面的用例从 0 条开始
    await setDelivery(eventId, first, "pending", 0);
    await setDelivery(eventId, third, "pending", 0);
    expect(await check()).toEqual([]);
  });

  it("“现在”可以由调用方给：拿拨定的时钟去比", async () => {
    const eventId = await emitAgo(0);
    const later = new Date(Date.now() + 6 * MINUTE);
    expect(about(await check(later), eventId)).toHaveLength(1);
    expect(about(await check(), eventId)).toHaveLength(0);
    await sample.events.expand();
  });

  it("测试装配能收集到本模块登记的不变量项：P2、只在 full 里跑、不自愈，run 就是上面的查询", async () => {
    for (const entry of ["api", "worker"] as const) {
      const item = createSampleEvents(prisma, { entry }).assembly.invariant("events.I8");
      expect(item).toMatchObject({
        module: "events",
        severity: "P2",
        modes: ["full"],
        heal: "none",
      });
      expect(item?.every).toBeUndefined();
    }
    const stale = await emitAgo(6 * MINUTE);
    const run = sample.assembly.invariant("events.I8")?.run;
    const viaRegistration = await sample.tx.run((tx) => run!(tx, {}));
    expect(about(viaRegistration, stale)).toHaveLength(1);
    expect(viaRegistration).toEqual(await check());
    await sample.events.expand();
  });
});
