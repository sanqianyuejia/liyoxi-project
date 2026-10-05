import { EVENTS } from "@liyoxi/contract/registry";
import type { PrismaClient } from "@liyoxi/db";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createIdentityContext, createTxRunner, sqlStateOf, uuidv7 } from "../kernel/index.js";
import {
  connectTestDatabase,
  createSampleEvents,
  sampleSystemContext,
  useTestDatabase,
} from "../testing/index.js";
import type { SampleEvents } from "../testing/index.js";
import { barrier, openClient, prefixes, put, SLOW } from "./__fixtures__/db.js";
import { EventEmitError } from "./emit.js";
import type { EmitInput } from "./emit.js";

// 验收第 1–4 条：去重键冲突即跳过；事件与业务写同事务；信封与载荷校验；事件行只许写一次。
// 业务写用 biz_sequence 充当（内核自己的表，一行一个前缀）。连接是支架给的缺省身份（应用角色 lyx_app）。

const db = useTestDatabase("services");
let prisma: PrismaClient;
let other: PrismaClient;
let sample: SampleEvents;

beforeAll(async () => {
  prisma = await db.prisma();
  other = await openClient(db);
  sample = createSampleEvents(prisma);
}, SLOW);

afterAll(async () => {
  await other?.$disconnect();
});

const system = sampleSystemContext();
const placed = (
  dedupeKey?: string,
  dramaOrderId = uuidv7(),
): EmitInput<"lyxtest.order.placed"> => ({
  type: "lyxtest.order.placed",
  aggregate: { type: "drama_order", id: dramaOrderId },
  payload: { v: 1, dramaOrderId },
  dedupeKey,
});
const countEvents = (where: object = {}): Promise<number> => prisma.outboxEvent.count({ where });

describe("emit：去重键冲突即跳过（验收 1）", () => {
  it("同一去重键发两次：只有 1 行，第二次不抛错，所在事务的业务写照常提交", async () => {
    const key = `lyxtest:${uuidv7()}`;
    const first = await sample.tx.run(async (tx) => {
      await put(tx, "EA");
      return sample.events.emit(tx, system, placed(key));
    });
    const second = await sample.tx.run(async (tx) => {
      await put(tx, "EB");
      return sample.events.emit(tx, system, placed(key));
    });
    expect(first).toEqual({ emitted: true, id: expect.any(String) });
    expect(second).toEqual({ emitted: false, id: null });
    expect(await countEvents({ dedupeKey: key })).toBe(1);
    expect(await prefixes(prisma)).toEqual(expect.arrayContaining(["EA", "EB"]));
  });

  it("同一个事务里同一去重键发两次：也只有 1 行", async () => {
    const key = `lyxtest:${uuidv7()}`;
    const results = await sample.tx.run(async (tx) => [
      await sample.events.emit(tx, system, placed(key)),
      await sample.events.emit(tx, system, placed(key)),
    ]);
    expect(results.map((result) => result.emitted)).toEqual([true, false]);
    expect(await countEvents({ dedupeKey: key })).toBe(1);
  });

  it("不带键发两次有 2 行", async () => {
    const dramaOrderId = uuidv7();
    await sample.tx.run(async (tx) => {
      await sample.events.emit(tx, system, placed(undefined, dramaOrderId));
      await sample.events.emit(tx, system, placed(undefined, dramaOrderId));
    });
    expect(await countEvents({ aggregateId: dramaOrderId, dedupeKey: null })).toBe(2);
  });

  it(
    "两条连接同时发同一个去重键，重复 20 次：每次恰 1 行，两边的事务都提交，恰一边写入",
    async () => {
      const left = createTxRunner({ prisma, appEnv: "test" });
      const right = createTxRunner({ prisma: other, appEnv: "test" });
      for (let round = 0; round < 20; round += 1) {
        const key = `lyxtest:race:${uuidv7()}`;
        const aligned = barrier(2);
        const results = await Promise.all(
          [left, right].map((runner) =>
            runner.run(async (tx) => {
              await aligned();
              return sample.events.emit(tx, system, placed(key));
            }),
          ),
        );
        expect(results.map((result) => result.emitted).sort()).toEqual([false, true]);
        expect(await countEvents({ dedupeKey: key })).toBe(1);
      }
    },
    SLOW,
  );

  // 甲类的性质测试：任意一串去重键（带重复、带空），落库的行数 = 不带键的条数 + 不同键的个数；
  // 每个键只有第一次返回 emitted: true。轮次与种子的约定同 kernel（LYX_FC_RUNS、LYX_FC_SEED）
  it(
    "性质：行数 = 不带键的条数 + 不同键的个数",
    async () => {
      let run = 0;
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.option(fc.constantFrom("a", "b", "c", "d"), { nil: null }), {
            maxLength: 12,
          }),
          async (keys) => {
            run += 1;
            const requestId = `lyxtest-prop-${run}-${uuidv7()}`;
            const ctx = createIdentityContext({
              actor: { type: "system", job: "lyxtest.prop" },
              requestId,
            });
            const emitted = await sample.tx.run(async (tx) => {
              const flags: boolean[] = [];
              for (const key of keys) {
                const dedupeKey = key === null ? undefined : `${requestId}:${key}`;
                flags.push((await sample.events.emit(tx, ctx, placed(dedupeKey))).emitted);
              }
              return flags;
            });
            const seen = new Set<string>();
            const expected = keys.map((key) => {
              if (key === null) return true;
              const fresh = !seen.has(key);
              seen.add(key);
              return fresh;
            });
            expect(emitted).toEqual(expected);
            expect(await countEvents({ requestId })).toBe(expected.filter(Boolean).length);
          },
        ),
        {
          numRuns: Number(process.env.LYX_FC_RUNS ?? 25),
          seed: Number(process.env.LYX_FC_SEED ?? 20261005),
        },
      );
    },
    SLOW,
  );
});

describe("emit：事件与业务写同事务（验收 2）", () => {
  it("emit 之后抛错：事件行 0 行，业务写也没有", async () => {
    const dramaOrderId = uuidv7();
    await expect(
      sample.tx.run(async (tx) => {
        await put(tx, "EC");
        await sample.events.emit(tx, system, placed(undefined, dramaOrderId));
        throw new Error("业务失败");
      }),
    ).rejects.toThrow("业务失败");
    expect(await countEvents({ aggregateId: dramaOrderId })).toBe(0);
    expect(await prefixes(prisma)).not.toContain("EC");
  });
});

describe("emit：信封与载荷校验（验收 3）", () => {
  const notEmitted = EVENTS.find((event) => event.status === "not_emitted")?.name as string;
  const reserved = EVENTS.find((event) => event.status === "reserved")?.name as string;
  const id = uuidv7();
  const refused: Array<[string, string, EmitInput]> = [
    ["未登记的事件名", "unknown_event", { type: "lyxtest.nope", payload: { v: 1 } }],
    ["状态为“不发”的事件名", "not_emitted", { type: notEmitted, payload: { v: 1 } }],
    ["状态为“预留”的事件名", "not_emitted", { type: reserved, payload: { v: 1 } }],
    ["未登记的聚合类型", "aggregate", { ...placed(), aggregate: { type: "no_such_table", id } }],
    ["不是这个事件的聚合类型", "aggregate", { ...placed(), aggregate: { type: "order_item", id } }],
    ["该带聚合的没带", "aggregate", { ...placed(), aggregate: null }],
    [
      "不带聚合的事件带了聚合",
      "aggregate",
      { type: "lyxtest.pinged", aggregate: { type: "drama_order", id }, payload: { v: 1, n: 1 } },
    ],
    [
      "聚合 id 不是 UUID",
      "aggregate",
      { ...placed(), aggregate: { type: "drama_order", id: "1" } },
    ],
    ["载荷缺 v", "payload", { ...placed(), payload: { dramaOrderId: id } }],
    ["载荷的 v 不是数字", "payload", { ...placed(), payload: { v: "1", dramaOrderId: id } }],
    ["载荷不合 schema", "payload", { ...placed(), payload: { v: 1, dramaOrderId: "x" } }],
    [
      "载荷带了 schema 之外的键",
      "payload",
      { ...placed(), payload: { v: 1, dramaOrderId: id, note: "备注" } },
    ],
    ["没有 schema 的样例事件", "no_schema", { type: "lyxtest.unspecified", payload: { v: 1 } }],
    [
      "没有 schema 的正式事件",
      "no_schema",
      { type: "order.submitted", aggregate: { type: "drama_order", id }, payload: { v: 1 } },
    ],
    ["去重键是空串", "dedupe_key", { ...placed(), dedupeKey: " " }],
    ["有门店没有主体", "tenant", { ...placed(), storeId: id }],
  ];

  it.each(refused)("%s：抛错（%s），不落库", async (_name, reason, input) => {
    const before = await countEvents();
    const error = await sample.tx
      .run((tx) => sample.events.emit(tx, system, input))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EventEmitError);
    expect((error as EventEmitError).reason).toBe(reason);
    expect(await countEvents()).toBe(before);
  });

  it("不发、预留的事件名在目录里确实各有一个（上面两条用例不是空跑）", () => {
    expect([notEmitted, reserved].every((name) => typeof name === "string")).toBe(true);
  });

  it("system 操作人：actor_id、client 为空；occurred_at 等于拨定的时钟；主键是 UUID v7", async () => {
    sample.clock.set(new Date("2026-03-01T08:30:00.123Z"));
    const { id: eventId } = await sample.tx.run((tx) =>
      sample.events.emit(
        tx,
        { ...system, clientPlatform: "ios", clientVersion: "9.9.9" },
        placed(),
      ),
    );
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId as string } });
    expect(row).toMatchObject({
      actorType: "system",
      actorId: null,
      client: null,
      actorRole: null,
      clientPlatform: null,
      clientVersion: null,
      entityId: null,
      storeId: null,
      dedupeKey: null,
      publishedAt: null,
    });
    expect(row.occurredAt.toISOString()).toBe("2026-03-01T08:30:00.123Z");
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    // created_at 用库默认值（数据库时间），不是拨定的时钟
    expect(row.createdAt.getTime()).toBeGreaterThan(new Date("2026-10-01").getTime());
  });

  it("商家操作人：信封各列照身份上下文填，载荷里不重复；载荷按 schema 校验后原样落库", async () => {
    const [actorId, entityId, storeId, requestId, dramaOrderId] = [1, 2, 3, 4, 5].map(() =>
      uuidv7(),
    );
    const ctx = {
      ...createIdentityContext({
        actor: { type: "merchant", id: actorId, client: "weapp", role: "owner" },
        entityId,
        storeId,
        requestId,
      }),
      clientPlatform: "ios",
      clientVersion: "1.2.3",
    };
    const input = {
      ...placed("lyxtest:envelope", dramaOrderId),
      payload: { v: 1, dramaOrderId, points: 30 },
    };
    const { id: eventId } = await sample.tx.run((tx) => sample.events.emit(tx, ctx, input));
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId as string } });
    expect(row).toMatchObject({
      eventType: "lyxtest.order.placed",
      aggregateType: "drama_order",
      aggregateId: dramaOrderId,
      entityId,
      storeId,
      actorType: "merchant",
      actorId,
      client: "weapp",
      actorRole: "owner",
      clientPlatform: "ios",
      clientVersion: "1.2.3",
      requestId,
      dedupeKey: "lyxtest:envelope",
      payload: { v: 1, dramaOrderId, points: 30 },
    });
  });

  it("归属可以由调用方另给（员工替商家操作）；cli 来源的 client 写空", async () => {
    const [actorId, entityId, storeId] = [1, 2, 3].map(() => uuidv7());
    const ctx = createIdentityContext({ actor: { type: "staff", id: actorId, client: "cli" } });
    const { id: eventId } = await sample.tx.run((tx) =>
      sample.events.emit(tx, ctx, { ...placed(), entityId, storeId }),
    );
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId as string } });
    expect(row).toMatchObject({ actorType: "staff", actorId, client: null, entityId, storeId });
  });

  it("正式目录里交了 schema 的 calendar.imported：不带聚合，照 x01 的去重键发得出去", async () => {
    const payload = { v: 1 as const, calendarVersion: 7, year: 2027, changedDays: ["2027-02-10"] };
    const emit = (): Promise<{ emitted: boolean }> =>
      sample.tx.run((tx) =>
        sample.events.emit(tx, system, {
          type: "calendar.imported",
          payload,
          dedupeKey: `calendar.imported:${payload.calendarVersion}`,
        }),
      );
    expect((await emit()).emitted).toBe(true);
    expect((await emit()).emitted).toBe(false);
    const saved = await prisma.outboxEvent.findMany({ where: { eventType: "calendar.imported" } });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ aggregateType: null, aggregateId: null, payload });
  });
});

describe("outbox_event：只许插入与写一次 published_at（验收 4）", () => {
  it(
    "改 payload、删行、第二次改 published_at，各被触发器拒绝；应用角色连权限都没有",
    async () => {
      const { id: eventId } = await sample.tx.run((tx) => sample.events.emit(tx, system, placed()));
      // 触发器那一道要表的属主才走得到：应用角色先被权限拦住（见下）
      const owner = await connectTestDatabase(db.name, { role: null });
      const attempt = (sql: string): Promise<string> =>
        owner.query(sql, [eventId]).then(
          () => "ok",
          (error: { code?: string }) => String(error.code),
        );
      try {
        // 23001 restrict_violation：lyx_write_once() 抛的
        expect(
          await attempt(`UPDATE outbox_event SET payload = '{"v":2}'::jsonb WHERE id = $1`),
        ).toBe("23001");
        expect(await attempt("DELETE FROM outbox_event WHERE id = $1")).toBe("23001");
        expect(await attempt("UPDATE outbox_event SET published_at = now() WHERE id = $1")).toBe(
          "ok",
        );
        expect(
          await attempt(
            "UPDATE outbox_event SET published_at = now() + interval '1 second' WHERE id = $1",
          ),
        ).toBe("23001");
        expect(await attempt("UPDATE outbox_event SET published_at = NULL WHERE id = $1")).toBe(
          "23001",
        );
      } finally {
        await owner.end();
      }
      const denied = await prisma
        .$executeRawUnsafe(`DELETE FROM outbox_event WHERE id = $1::uuid`, eventId)
        .catch((error: unknown) => sqlStateOf(error));
      expect(denied).toBe("42501");
      expect(await countEvents({ id: eventId as string })).toBe(1);
    },
    SLOW,
  );
});
