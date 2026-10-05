import { AGGREGATE_TYPES, SUBSCRIBERS } from "@liyoxi/contract/registry";
import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { AssemblyError, createTxRunner, defineRegistration } from "../kernel/index.js";
import type { ModuleRegistration, SubscriberRegistration } from "../kernel/index.js";
import {
  assembleForTest,
  createClock,
  createSampleEvents,
  SAMPLE_EVENTS,
  SAMPLE_SUBSCRIBERS,
  sampleSubscriberRegistration,
  useTestDatabase,
} from "../testing/index.js";
import { SLOW } from "./__fixtures__/db.js";
import {
  assertAggregateTables,
  emittedAggregateTypes,
  findMissingAggregateTables,
} from "./aggregates.js";
import { createEvents } from "./runtime.js";
import type { Events } from "./runtime.js";
import { SubscriberRegistryError } from "./subscribers.js";

// 验收第 7 条：订阅者的登记对照契约校验，四种不合各在装配时报错；api、worker 两个入口取到同一份订阅者表；
// 契约登记的聚合类型都是库里存在的表，加一个不存在的表名即失败。

const db = useTestDatabase("services");
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = await db.prisma();
}, SLOW);

const handle = async (): Promise<void> => {};
const subscriber = (
  name: string,
  events: readonly string[],
  critical?: boolean,
): SubscriberRegistration => ({
  name,
  events,
  handle,
  ...(critical === undefined ? {} : { critical }),
});

/** 只装给定的登记（不带真实模块的），在它上面建 events；testEvents 写 null 即照生产装配、不带样例事件 */
function build(
  registrations: readonly ModuleRegistration[],
  testEvents: typeof SAMPLE_EVENTS | null = SAMPLE_EVENTS,
): Events {
  const assembly = assembleForTest({ entry: "worker", isolated: true, extra: registrations });
  return createEvents({
    assembly,
    clock: createClock(),
    tx: createTxRunner({ prisma, appEnv: "test" }),
    ...(testEvents === null ? {} : { testEvents }),
  });
}
const issuesOf = (make: () => unknown): readonly string[] => {
  try {
    make();
  } catch (error) {
    if (error instanceof SubscriberRegistryError) return error.issues;
    throw error;
  }
  return [];
};

// 契约里的一个关键类订阅者，拿来造“登记与契约不一致”
const real = SUBSCRIBERS.find((item) => item.critical) as (typeof SUBSCRIBERS)[number];

describe("订阅者登记对照契约（验收 7）", () => {
  it("名字不在契约里：装配时报错", () => {
    const issues = issuesOf(() =>
      build([
        defineRegistration("order", {
          subscribers: [subscriber("order.onSomethingNew", ["order.submitted"])],
        }),
      ]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("order.onSomethingNew");
    expect(issues[0]).toContain("名字不在契约的订阅者登记里");
  });

  it("lyxtest. 前缀的订阅者只在带样例事件的测试装配里认：照生产装配建就报错", () => {
    const issues = issuesOf(() => build([sampleSubscriberRegistration()], null));
    // 三个样例订阅者各两条：名字不在契约里；订阅的样例事件不在目录里
    expect(issues).toHaveLength(SAMPLE_SUBSCRIBERS.length * 2);
  });

  it("同名重复：装配时报错", () => {
    const twice = (module: string): ModuleRegistration =>
      defineRegistration(module, {
        subscribers: [subscriber("lyxtest.onTwice", ["lyxtest.order.placed"])],
      });
    expect(() => build([twice("lyxtest_a"), twice("lyxtest_b")])).toThrow(AssemblyError);
  });

  it("订阅了目录里没有的事件：装配时报错", () => {
    const issues = issuesOf(() =>
      build([
        defineRegistration("lyxtest_ghost", {
          subscribers: [subscriber("lyxtest.onGhost", ["lyxtest.pinged", "lyxtest.ghost.seen"])],
        }),
      ]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("订阅了事件目录里没有的事件 lyxtest.ghost.seen");
  });

  it("critical 与契约不一致：装配时报错；所属模块与契约不一致也报", () => {
    const wrongCritical = issuesOf(() =>
      build([
        defineRegistration(real.module, {
          subscribers: [subscriber(real.name, ["lyxtest.pinged"], !real.critical)],
        }),
      ]),
    );
    expect(wrongCritical).toHaveLength(1);
    expect(wrongCritical[0]).toContain("critical 与契约不一致");

    const wrongModule = issuesOf(() =>
      build([
        defineRegistration("lyxtest_thief", {
          subscribers: [subscriber(real.name, ["lyxtest.pinged"])],
        }),
      ]),
    );
    expect(wrongModule).toHaveLength(1);
    expect(wrongModule[0]).toContain(`契约里它属于模块 ${real.module}`);
  });

  it("问题一次报全", () => {
    const issues = issuesOf(() =>
      build([
        defineRegistration("lyxtest_many", {
          subscribers: [
            subscriber("order.onSomethingNew", ["lyxtest.ghost.seen"]),
            subscriber(real.name, ["lyxtest.pinged"], !real.critical),
          ],
        }),
      ]),
    );
    expect(issues).toHaveLength(4);
  });

  it("与契约一致的登记通过：关键类以契约为准，可以不写", () => {
    const events = build([
      defineRegistration(real.module, {
        subscribers: [
          subscriber(real.name, ["lyxtest.pinged", "calendar.imported"]),
          ...SUBSCRIBERS.filter((item) => item.module === real.module && !item.critical)
            .slice(0, 1)
            .map((item) => subscriber(item.name, ["lyxtest.pinged"], false)),
        ],
      }),
    ]);
    expect(events.subscribers.get(real.name)).toMatchObject({
      module: real.module,
      critical: true,
      events: ["lyxtest.pinged", "calendar.imported"],
    });
    expect(events.subscribers.forEvent("calendar.imported").map((item) => item.name)).toEqual([
      real.name,
    ]);
    expect(events.subscribers.all.filter((item) => !item.critical)).toHaveLength(1);
    expect(events.subscribers.forEvent("lyxtest.order.placed")).toEqual([]);
  });

  it("测试装配的 api、worker 两个入口取到同一份订阅者表", () => {
    const [api, worker] = (["api", "worker"] as const).map((entry) => {
      const sample = createSampleEvents(prisma, { entry });
      expect(sample.assembly.entry).toBe(entry);
      return sample.events.subscribers;
    });
    const describeTable = (table: Events["subscribers"]): unknown =>
      table.all.map(({ name, module, critical, events }) => ({ name, module, critical, events }));
    expect(describeTable(api!)).toEqual(describeTable(worker!));
    for (const table of [api!, worker!]) {
      expect(table.forEvent("lyxtest.order.placed").map((item) => item.name)).toEqual([
        ...SAMPLE_SUBSCRIBERS,
      ]);
      expect(table.forEvent("lyxtest.pinged")).toEqual([]);
      expect(table.get(SAMPLE_SUBSCRIBERS[0])).toMatchObject({
        module: "lyxtest_events",
        critical: false,
      });
    }
  });

  it("样例事件的名字、聚合不合规：建目录时就报错", () => {
    const bad = [
      { name: "order.sneaked_in" },
      { name: "lyxtest.Bad" },
      { name: "lyxtest.a.b.c" },
      { name: `lyxtest.${"x".repeat(64)}` },
      { name: "lyxtest.pinged" },
      { name: "lyxtest.fine", aggregates: ["no_such_table"] },
    ];
    for (const event of bad) {
      expect(() => build([], [...SAMPLE_EVENTS, event]), event.name).toThrow(TypeError);
    }
  });
});

describe("聚合类型自检（验收 7）", () => {
  it("契约登记的、会写进库的聚合类型，全部是库里存在的表", async () => {
    const types = emittedAggregateTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((type) => (AGGREGATE_TYPES as readonly string[]).includes(type))).toBe(true);
    expect(await findMissingAggregateTables(prisma)).toEqual([]);
    await expect(assertAggregateTables(prisma)).resolves.toBeUndefined();
  });

  it("加一个不存在的表名即失败；视图、索引的名字不算表", async () => {
    const types = [...emittedAggregateTypes(), "no_such_table", "pk_outbox_event"];
    expect(await findMissingAggregateTables(prisma, types)).toEqual([
      "no_such_table",
      "pk_outbox_event",
    ]);
    await expect(assertAggregateTables(prisma, types)).rejects.toThrow("no_such_table");
  });
});
