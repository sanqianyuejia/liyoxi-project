import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createEvents, findI8Violations } from "../events/index.js";
import type { Events } from "../events/index.js";
import { createIdentityContext, defineRegistration, uuidv7 } from "../kernel/index.js";
import type { ModuleRegistration } from "../kernel/index.js";
import { createTenant } from "../tenant/index.js";
import { assembleForTest } from "./assembly.js";
import { createFactories } from "./data/index.js";
import { SAMPLE_EVENTS, sampleSystemContext } from "./events.js";
import { createM1Support } from "./m1-support.js";
import { createClock } from "./clock.js";
import { m1Transport } from "./m1-transport.js";
import type { M1Support } from "./m1-types.js";

let support: M1Support;
beforeAll(async () => {
  const clock = createClock(),
    originalNow = clock.now();
  support = await createM1Support({
    clock,
    runId: process.env.LYX_TEST_SESSION ?? randomBytes(6).toString("hex"),
  });
  expect(support.clock).toBe(clock);
  expect(clock.now()).toEqual(originalNow);
  process.stdout.write(`M1 drain owned: ${support.databaseName};${support.redisPrefix}\n`);
}, 90_000);
afterAll(async () => {
  await support?.close();
});

const pending = () =>
  support.runtime.tx.run((tx) => tx.outboxEvent.count({ where: { publishedAt: null } }));

async function createMerchants(count: number) {
  const tenant = createTenant(support.runtime);
  for (let index = 0; index < count; index++) {
    const user = await support.runtime.tx.run((tx) =>
      createFactories({ db: tx, clock: support.clock }).merchantUser(),
    );
    await tenant.createEntity(
      createIdentityContext({ actor: { type: "merchant", id: user.id, client: "weapp" } }),
    );
  }
}

function sampleTransport(
  registrations: readonly ModuleRegistration[],
  startedAt = support.clock.now(),
  owner = support,
) {
  const assembly = assembleForTest({ entry: "api", extra: registrations });
  const events = createEvents({
    assembly,
    clock: owner.clock,
    tx: owner.runtime.tx,
    testEvents: SAMPLE_EVENTS,
  });
  const runtime = { ...owner.runtime, assembly, events };
  const transport = m1Transport(
    runtime,
    () => {
      expect(runtime.env.APP_ENV).toBe("test");
      expect(new URL(runtime.env.DATABASE_URL).pathname).toBe(`/${owner.databaseName}`);
    },
    startedAt,
  );
  return { events, transport };
}

async function ping(events: Events, count: number) {
  await support.runtime.tx.run(async (tx) => {
    for (let n = 0; n < count; n++)
      await events.emit(tx, sampleSystemContext(), {
        type: "lyxtest.pinged",
        payload: { v: 1, n },
      });
  });
}

async function placed(events: Events, owner = support) {
  const dramaOrderId = uuidv7();
  const result = await owner.runtime.tx.run((tx) =>
    events.emit(tx, sampleSystemContext(), {
      type: "lyxtest.order.placed",
      aggregate: { type: "drama_order", id: dramaOrderId },
      payload: { v: 1, dramaOrderId },
    }),
  );
  if (result.id === null) throw new Error("fictional event was not emitted");
  return result.id;
}

it("empty queue is drained without changing ownership or clock", async () => {
  expect(await support.drainEvents()).toEqual({ expanded: 0, consumed: 0 });
  expect(await pending()).toBe(0);
});

it("202 real tenant events without subscribers are all expanded", async () => {
  await createMerchants(101);
  expect(await pending()).toBe(202);
  expect(await support.runtime.tx.run((tx) => findI8Violations(tx))).toHaveLength(202);
  expect(await support.drainEvents()).toEqual({ expanded: 202, consumed: 0 });
  expect(await pending()).toBe(0);
  expect(await support.runtime.tx.run((tx) => findI8Violations(tx))).toEqual([]);
  expect(await support.runtime.tx.run((tx) => tx.outboxDelivery.count())).toBe(0);
}, 90_000);

it("exactly 200 real tenant events remain a single complete batch", async () => {
  await createMerchants(100);
  expect(await pending()).toBe(200);
  expect(await support.drainEvents()).toEqual({ expanded: 200, consumed: 0 });
  expect(await pending()).toBe(0);
}, 90_000);

it("a real subscriber can emit more than a batch of new unsubscribed events", async () => {
  const sample = sampleTransport([
    defineRegistration("lyxtest_m1drain", {
      subscribers: [
        {
          name: "lyxtest.onPlacedDrain",
          events: ["lyxtest.order.placed"],
          handle: async (tx) => {
            for (let n = 0; n < 401; n++)
              await sample.events.emit(tx, sampleSystemContext(), {
                type: "lyxtest.pinged",
                payload: { v: 1, n },
              });
          },
        },
      ],
    }),
  ]);
  await placed(sample.events);
  expect(await sample.transport.drainEvents()).toEqual({ expanded: 402, consumed: 1 });
  expect(await pending()).toBe(0);
  expect(
    await support.runtime.tx.run((tx) => tx.outboxDelivery.count({ where: { status: "done" } })),
  ).toBe(1);
});

it("locked unpublished rows cannot report drained and still stop after 32 real rounds", async () => {
  const sample = sampleTransport([]);
  await ping(sample.events, 1);
  let unlock!: () => void;
  let ready!: () => void;
  const released = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const locked = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const holder = support.runtime.tx.run(async (tx) => {
    await tx.$queryRawUnsafe("SELECT id FROM outbox_event WHERE published_at IS NULL FOR UPDATE");
    ready();
    await released;
  });
  const expand = vi.spyOn(sample.events, "expand");
  try {
    await Promise.race([locked, holder]);
    await expect(sample.transport.drainEvents()).rejects.toThrow("超过 32 轮");
    expect(expand).toHaveBeenCalledTimes(32);
    expect(await pending()).toBe(1);
  } finally {
    unlock();
    await holder;
    expand.mockRestore();
  }
  expect(await sample.transport.drainEvents()).toEqual({ expanded: 1, consumed: 0 });
});

it("real retry backoff and exhausted leases remain refusals rather than drained", async () => {
  const sample = sampleTransport([
    defineRegistration("lyxtest_m1drainfail", {
      subscribers: [
        {
          name: "lyxtest.onPlacedDrainFail",
          events: ["lyxtest.order.placed"],
          handle: async () => {
            throw new Error("fictional controlled subscriber failure");
          },
        },
      ],
    }),
  ]);
  const eventId = await placed(sample.events);
  await expect(sample.transport.drainEvents()).rejects.toThrow("retry");
  await expect(sample.transport.drainEvents()).rejects.toThrow("尚未虚拟到期");
  const before = await support.runtime.tx.run((tx) =>
    tx.outboxDelivery.findUniqueOrThrow({
      where: {
        outboxEventId_subscriber: {
          outboxEventId: eventId,
          subscriber: "lyxtest.onPlacedDrainFail",
        },
      },
    }),
  );
  expect(before).toMatchObject({ status: "retry", attempts: 1 });
  // Fault injection changes only transport lease/attempt fields in this owned database.
  await support.runtime.tx.run((tx) =>
    tx.$executeRawUnsafe(
      "UPDATE outbox_delivery SET status = 'leased', attempts = 9, is_enqueued = true, lease_until = now() - interval '1 second' WHERE outbox_event_id = $1::uuid AND subscriber = $2::text",
      eventId,
      "lyxtest.onPlacedDrainFail",
    ),
  );
  await expect(sample.transport.drainEvents()).rejects.toThrow("尚未虚拟到期");
  const dead = await support.runtime.tx.run((tx) =>
    tx.outboxDelivery.findUniqueOrThrow({
      where: {
        outboxEventId_subscriber: {
          outboxEventId: eventId,
          subscriber: "lyxtest.onPlacedDrainFail",
        },
      },
    }),
  );
  expect(dead).toMatchObject({ status: "dead", attempts: 10 });
  await expect(sample.transport.drainEvents()).rejects.toThrow("尚未虚拟到期");
});

describe("历史边界的独立资源准备", () => {
  let history: M1Support;
  beforeAll(async () => {
    // 建库、迁移与播种属于准备；不能把前一组故意留下的 dead 投递混入或过滤掉。
    history = await createM1Support({ clock: createClock() });
  }, 90_000);
  afterAll(async () => {
    await history?.close();
  });

  it("本轮财务种子 25h 历史边界正常消费，边界前 1ms 仍拒绝", async () => {
    const businessNow = history.clock.now();
    const startedAt = new Date(businessNow.getTime() - 25 * 3_600_000);
    const handled: string[] = [];
    const sample = sampleTransport(
      [
        defineRegistration("lyxtest_m1history", {
          subscribers: [
            {
              name: "lyxtest.onPlacedHistory",
              events: ["lyxtest.order.placed"],
              handle: async (_tx, event) => {
                handled.push(event.id);
              },
            },
          ],
        }),
      ],
      startedAt,
      history,
    );
    try {
      history.clock.set(startedAt);
      const boundaryId = await placed(sample.events, history);
      history.clock.set(businessNow);
      expect(await sample.transport.drainEvents()).toEqual({ expanded: 1, consumed: 1 });
      expect(handled).toEqual([boundaryId]);
      history.clock.set(new Date(startedAt.getTime() - 1));
      const outsideId = await placed(sample.events, history);
      history.clock.set(businessNow);
      await expect(sample.transport.drainEvents()).rejects.toThrow("不属于本轮业务范围");
      expect(handled).toEqual([boundaryId]);
      expect(
        await history.runtime.tx.run((tx) =>
          tx.outboxDelivery.findUniqueOrThrow({
            where: {
              outboxEventId_subscriber: {
                outboxEventId: outsideId,
                subscriber: "lyxtest.onPlacedHistory",
              },
            },
          }),
        ),
      ).toMatchObject({ status: "leased", attempts: 0 });
    } finally {
      history.clock.set(businessNow);
    }
  });
});
