import { createPrismaClient } from "@liyoxi/db";
import type { PrismaClient } from "@liyoxi/db";
import { describe, expect, it } from "vitest";
import { dispatchDue } from "../events/index.js";
import { AppError, lockRows } from "../kernel/index.js";
import type { Tx, TxRunner } from "../kernel/index.js";
import { connectTestDatabase, createLedgerHarness, useSeededDatabase } from "../testing/index.js";
import {
  entitlementHarness,
  transferOwner,
  SLOW,
  SUBSCRIBER,
} from "./__fixtures__/tenant-entitlement.js";
import type {
  EntitlementHarness,
  EntitlementRuntime,
  EntitlementWorld,
} from "./__fixtures__/tenant-entitlement.js";

const db = useSeededDatabase("services", { label: "entitlerace" });
interface Scenario {
  clients: PrismaClient[];
  harnesses: EntitlementHarness[];
  sides: EntitlementRuntime[];
  runners: TxRunner[];
  pids: number[];
}
async function scenario(run: (s: Scenario) => Promise<void>) {
  const url = await db.url();
  const clients = [0, 1].map(() => createPrismaClient({ connectionString: url, max: 1 }));
  const harnesses: EntitlementHarness[] = [];
  try {
    const first = entitlementHarness(clients[0]!);
    harnesses.push(
      first,
      entitlementHarness(clients[1]!, createLedgerHarness(clients[1]!, { clock: first.clock })),
    );
    const sides = harnesses.map((h) => h.runtime());
    const runners = harnesses.map((h) => h.tx);
    const pids = await Promise.all(
      clients.map(async (client) => {
        const [row] = await client.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        if (!row) throw new Error("权益竞争缺少真实业务PID");
        return row.pid;
      }),
    );
    expect(new Set(pids).size).toBe(2);
    await run({ clients, harnesses, sides, runners, pids });
  } finally {
    try {
      await Promise.all(harnesses.map((h) => h.close()));
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
  }
}
function pause(s: Scenario, afterGate?: (tx: Tx) => Promise<void>, failure?: Error) {
  let enter!: () => void,
    release!: () => void,
    releaseFailure!: () => void,
    armed = true;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const failureGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  const runner: TxRunner = {
    run: async (fn, options) => {
      // 回滚只释放锁，不承诺另一连接先提交；显式让失败记账等待竞争消费完成。
      if (!armed && failure) await failureGate;
      return s.runners[0]!.run(async (tx) => {
        const result = await fn(tx);
        if (armed) {
          armed = false;
          enter();
          await gate;
          await afterGate?.(tx);
          if (failure) throw failure;
        }
        return result;
      }, options);
    },
  };
  return { runner, entered, release, releaseFailure };
}
async function blocked(observer: Awaited<ReturnType<typeof connectTestDatabase>>, s: Scenario) {
  const until = Date.now() + 2_000;
  do {
    const result = await observer.query<{ blocked: boolean }>(
      "SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked",
      [s.pids[1], s.pids[0]],
    );
    if (result.rows[0]?.blocked) {
      const all = await observer.query<{ pid: number }>(
        "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid() ORDER BY pid",
      );
      expect(all.rows.map((row) => row.pid)).toEqual([...s.pids].sort((a, b) => a - b));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  } while (Date.now() < until);
  throw new Error("2秒内未观察到权益竞争唯一两业务连接的真实锁阻塞");
}
async function race(
  s: Scenario,
  hold: ReturnType<typeof pause>,
  w: EntitlementWorld,
  firstAction: () => Promise<unknown>,
  secondAction: () => Promise<unknown>,
) {
  const observer = await connectTestDatabase(db.name, { role: null });
  let first: Promise<PromiseSettledResult<unknown>[]> | undefined;
  let second: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await observer.query("SET default_transaction_read_only=on");
    first = Promise.allSettled([firstAction()]);
    await Promise.race([
      hold.entered,
      first.then(() => {
        throw new Error("权益holder未到达真实事务尾栅栏");
      }),
    ]);
    second = Promise.allSettled([secondAction()]);
    void second.then(hold.releaseFailure);
    await blocked(observer, s);
    const visible = await observer.query<{
      notifications: number;
      messages: number;
      deliveries: number;
    }>(
      `SELECT (SELECT count(*)::int FROM notification WHERE source_outbox_event_id=$1::uuid AND notify_scene_key='m.quota_exceeded') AS notifications,
        (SELECT count(*)::int FROM merchant_message m JOIN notification n ON n.id=m.notification_id WHERE n.source_outbox_event_id=$1::uuid AND n.notify_scene_key='m.quota_exceeded') AS messages,
        (SELECT count(*)::int FROM notification_delivery d JOIN notification n ON n.id=d.notification_id WHERE n.source_outbox_event_id=$1::uuid AND n.notify_scene_key='m.quota_exceeded') AS deliveries`,
      [w.event.id],
    );
    expect(visible.rows).toEqual([{ notifications: 0, messages: 0, deliveries: 0 }]);
    hold.release();
    return [(await first)[0]!, (await second)[0]!] as const;
  } finally {
    hold.release();
    hold.releaseFailure();
    await first;
    await second;
    await observer.end();
  }
}
function fulfilled(result: PromiseSettledResult<unknown>) {
  expect(result.status).toBe("fulfilled");
  if (result.status !== "fulfilled") throw result.reason;
  return result.value;
}
async function exactlyOne(s: Scenario, w: EntitlementWorld, ownerId: string) {
  const evidence = await s.harnesses[0]!.evidence(w.event.id);
  expect(evidence.notifications).toHaveLength(1);
  expect(evidence.notifications[0]).toMatchObject({
    merchantUserId: ownerId,
    sourceOutboxEventId: w.event.id,
  });
  expect(evidence.messages).toHaveLength(1);
  expect(evidence.messages[0]).toMatchObject({
    merchantUserId: ownerId,
    notificationId: evidence.notifications[0]!.id,
  });
  expect(evidence.deliveries).toHaveLength(1);
  expect(evidence.deliveries[0]).toMatchObject({
    notificationId: evidence.notifications[0]!.id,
    channel: "inbox",
    status: "sent",
  });
  expect(
    await s.clients[0]!.outboxDelivery.findUniqueOrThrow({
      where: {
        outboxEventId_subscriber: { outboxEventId: w.event.id, subscriber: SUBSCRIBER },
      },
    }),
  ).toMatchObject({ status: "done" });
}

describe("权益提醒：两个max1真实业务连接与readonly observer", { timeout: SLOW }, () => {
  it.each(["commit", "rollback"] as const)(
    "同delivery竞争%s：二十轮仅一份通知/消息/inbox且消费原子",
    async (mode) => {
      await scenario(async (s) => {
        const h = s.harnesses[0]!;
        for (let round = 0; round < 20; round++) {
          const w = await h.world();
          const ref = await s.sides[0]!.queue(w.event.id);
          const hold = pause(
            s,
            undefined,
            mode === "rollback" ? new Error("entitlement-race-rollback") : undefined,
          );
          const first = h.runtime(hold.runner);
          const results = await race(
            s,
            hold,
            w,
            () => first.consume(ref),
            () => s.sides[1]!.consume(ref),
          );
          if (mode === "commit") {
            expect(fulfilled(results[0])).toBe("done");
            expect(fulfilled(results[1])).toBe("stale");
          } else {
            // 已观察真实锁等待；另由 failureGate 保证 side 1 提交先于 side 0 的失败记账。
            expect(fulfilled(results[0])).toBe("stale");
            expect(fulfilled(results[1])).toBe("done");
          }
          await exactlyOne(s, w, w.user.id);
          const before = await h.snapshot();
          expect(await s.sides[0]!.consume(ref)).toBe("stale");
          expect(await s.sides[1]!.consume(ref)).toBe("stale");
          expect(await h.snapshot()).toEqual(before);
        }
      });
    },
    SLOW,
  );

  it.each(["quota", "closed", "owner", "deleted"] as const)(
    "当前%s变化先持80/100锁：二十轮等待后重新读取，不向旧老板/旧额度投递",
    async (mode) => {
      await scenario(async (s) => {
        const h = s.harnesses[0]!;
        for (let round = 0; round < 20; round++) {
          const w = await h.world();
          const replacement = w.clerks[0]!;
          const ref = await s.sides[0]!.queue(w.event.id);
          const hold = pause(s, async (tx) => {
            if (mode === "quota")
              await tx.entity.update({
                where: { id: w.entity.id },
                data: { storeLimitOverride: 99, memberLimitOverride: 99 },
              });
            else if (mode === "closed")
              await tx.entity.update({
                where: { id: w.entity.id },
                data: { lifecycle: "closed", closedAt: h.clock.now() },
              });
            else if (mode === "owner") {
              await lockRows(tx, "entity_member", [w.owner.id, replacement.id]);
              await transferOwner(tx, w, replacement.id, h.clock.now());
            } else
              await tx.merchantUser.update({
                where: { id: w.user.id },
                data: {
                  status: "deleted",
                  deletedAt: h.clock.now(),
                  phoneEnc: null,
                  phoneBidx: null,
                  phoneMask: null,
                  phoneLast4: null,
                  displayName: null,
                },
              });
          });
          const results = await race(
            s,
            hold,
            w,
            () =>
              hold.runner.run(async (tx) => {
                await lockRows(tx, "merchant_user", [w.user.id]);
                await lockRows(tx, "entity", [w.entity.id]);
              }),
            () => s.sides[1]!.consume(ref),
          );
          expect(fulfilled(results[0])).toBeUndefined();
          expect(fulfilled(results[1])).toBe(mode === "owner" ? "retry" : "done");
          expect(await h.evidence(w.event.id)).toEqual({
            notifications: [],
            messages: [],
            deliveries: [],
          });
          if (mode === "owner") {
            const row = await s.clients[0]!.outboxDelivery.findUniqueOrThrow({
              where: {
                outboxEventId_subscriber: { outboxEventId: w.event.id, subscriber: SUBSCRIBER },
              },
            });
            expect(row).toMatchObject({ status: "retry", attempts: 1, consumedAt: null });
            expect(row.lastError).toBe(`AppError: ${new AppError("PRECONDITION_CHANGED").message}`);
            await s.clients[0]!.$executeRawUnsafe(
              "UPDATE outbox_delivery SET next_attempt_at=now()-interval '1 second' WHERE outbox_event_id=$1::uuid AND subscriber=$2",
              w.event.id,
              SUBSCRIBER,
            );
            const side = s.sides[1]!;
            side.refs.length = 0;
            await dispatchDue(side.dispatch);
            const retry = side.refs.find((entry) => entry.eventId === w.event.id)!;
            expect(retry.dispatchNo).toBe(ref.dispatchNo + 1);
            expect(await side.consume(retry)).toBe("done");
            await exactlyOne(s, w, replacement.merchantUserId);
            expect((await h.evidence(w.event.id)).notifications[0]!.vars).toMatchObject({
              merchantUserId: replacement.merchantUserId,
              seatsOver: 0,
            });
          } else {
            expect(
              await s.clients[0]!.outboxDelivery.findUniqueOrThrow({
                where: {
                  outboxEventId_subscriber: { outboxEventId: w.event.id, subscriber: SUBSCRIBER },
                },
              }),
            ).toMatchObject({ status: "done", attempts: 0 });
          }
        }
      });
    },
    SLOW,
  );
});
