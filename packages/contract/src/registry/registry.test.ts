// x01 名称登记的自测（任务书 W0-09a 第 7 节第 1–5、8 条）。对账的逻辑在 scripts/registry-check.ts，
// 这里一是拿真实的登记数据跑它（pnpm test 也能看见漂移），二是拿改坏的数据试它报不报得出来。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EXPECTED_COUNTS,
  countsOf,
  loadX01Sources,
  mapFileProblems,
  parseX01Markdown,
  registryProblems,
} from "../../scripts/registry-check.js";
import {
  MAP_CATEGORIES,
  X01_MAP_PATH,
  renderX01Map,
  x01MapRows,
} from "../../scripts/registry-map.js";
import { importsReachableFrom } from "../__fixtures__/import-scan.js";

import {
  AGGREGATE_TYPES,
  EVENTS,
  EVENT_PREFIXES,
  MILESTONES,
  MODULE_REGISTRIES,
  REGISTRY,
  SUBSCRIBERS,
  TIMERS,
  TIMER_SUBJECT_TYPES,
  type AggregateType,
  type EventName,
  type JobKind,
  type Milestone,
  type RegistrySnapshot,
  type SubscriberName,
  type TimerKind,
  type TimerSubjectType,
} from "./index.js";

const registryDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(registryDir, "../../../..");
const readJson = (path: string) =>
  JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as unknown;

/** 不是模块登记的：声明形态、写法、入口 */
const NOT_MODULE_FILES = new Set(["define.ts", "formats.ts", "index.ts"]);
const moduleFiles = readdirSync(registryDir)
  .filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !NOT_MODULE_FILES.has(name),
  )
  .map((name) => name.slice(0, -3))
  .sort();

describe("一个模块一个文件，汇总自动收集", () => {
  it("目录里的模块文件与入口收的一一对应，按模块名排序", () => {
    expect(MODULE_REGISTRIES.map((registry) => registry.module)).toEqual(moduleFiles);
  });

  it("模块名是 services 的模块（infra/ci/layers.json）", () => {
    const { modules } = readJson("infra/ci/layers.json") as { modules: Record<string, string> };
    expect(moduleFiles.filter((name) => !(name in modules))).toEqual([]);
  });

  it("每个模块文件至少登记一项", () => {
    for (const registry of MODULE_REGISTRIES) {
      const { module, ...lists } = registry;
      const total = Object.values(lists).reduce((sum, list) => sum + list.length, 0);
      expect(total, module).toBeGreaterThan(0);
    }
  });

  it("名字是字面量类型：没登记的名字过不了类型检查", () => {
    const names: [EventName, SubscriberName, TimerKind, JobKind, AggregateType, TimerSubjectType] =
      [
        "order.submitted",
        "notify.onEvent",
        "sla.breach",
        "invariant.full",
        "drama_order",
        "delivery_ticket_stage",
      ];
    // @ts-expect-error 没登记的事件名
    const unknownEvent: EventName = "order.no_such_event";
    // @ts-expect-error 周期任务的 kind 不是定时器的 kind
    const jobAsTimer: TimerKind = "invariant.full";
    expect([...names, unknownEvent, jobAsTimer]).toHaveLength(8);
  });
});

describe("与 x01 对账（验收 1–4）", () => {
  const sources = loadX01Sources();

  it("真实的登记数据：0 差异", () => {
    expect(registryProblems(REGISTRY, sources)).toEqual([]);
  });

  it("数量", () => {
    expect(countsOf(REGISTRY)).toEqual(EXPECTED_COUNTS);
    expect(EVENTS).toHaveLength(220 + 7 + 1);
    expect(EVENT_PREFIXES).toHaveLength(52);
    expect(new Set(TIMERS.map((item) => item.kind)).size).toBe(18);
    expect(TIMERS.filter((item) => item.kind === "sla.breach")).toHaveLength(7);
  });

  it("内核要的两类多态取值由登记得出：聚合 53 个、定时器主体 17 个", () => {
    expect(AGGREGATE_TYPES).toHaveLength(53);
    // 这两个不在 01 分组早先的 51 个里，x01 第 2.2 节写明照收
    expect(AGGREGATE_TYPES).toContain("export_job");
    expect(AGGREGATE_TYPES).toContain("billing_month_close");
    expect(TIMER_SUBJECT_TYPES).toHaveLength(17);
    expect([...AGGREGATE_TYPES]).toEqual([...AGGREGATE_TYPES].sort());
  });

  it("x01 正文读得出各张表", () => {
    const body = parseX01Markdown(sources.markdown);
    expect(body.events).toHaveLength(228);
    expect(body.prefixes).toHaveLength(52);
    expect(body.queues).toHaveLength(8);
    expect(body.callbacks).toHaveLength(7);
    expect(body.commands).toHaveLength(4);
    expect(body.commands).toContain("staff:bootstrap");
    expect(body.events.find((item) => item.name === "billing.month_closed")).toEqual({
      name: "billing.month_closed",
      aggregates: ["billing_month_close"],
      status: "reserved",
    });
  });

  describe("改坏的数据：对账报得出来", () => {
    const problemsOf = (change: Partial<RegistrySnapshot>) =>
      registryProblems({ ...REGISTRY, ...change }, sources);
    const replace = <T>(list: readonly T[], index: number, item: T) =>
      list.map((existing, at) => (at === index ? item : existing));

    it("删一个订阅者登记", () => {
      const problems = problemsOf({
        subscribers: SUBSCRIBERS.filter((item) => item.name !== "notify.onMerchantUserDeleted"),
      });
      expect(problems).toContain("订阅者：frag有而契约没有：notify.onMerchantUserDeleted");
      expect(problems).toContain("订阅者：x01 正文有而契约没有：notify.onMerchantUserDeleted");
      expect(problems).toContain("数量：订阅者应为 34 个，契约登记了 33 个");
      expect(problems).toContain("里程碑：M2 的订阅者应为 9 个（计划 第 8.4 节），契约登记了 8 个");
      expect(problems).toHaveLength(4);
    });

    it("多登记一个事件；事件名写法不对", () => {
      const extra = { ...EVENTS[0]!, name: "Order.created.too.long", prefix: "Order.created.too." };
      const problems = problemsOf({ events: [...EVENTS, extra] });
      expect(problems).toContain("事件：契约有而frag没有：Order.created.too.long");
      expect(problems).toContain("数量：V1.0 发出的事件应为 220 个，契约登记了 221 个");
      expect(problems.filter((problem) => problem.startsWith("写法：事件名 "))).toEqual([
        "写法：事件名 Order.created.too.long 不合 outbox_event.event_type 的 CHECK 正则 ^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$",
        "写法：事件名 Order.created.too.long 是 4 段，应为 2–3 段（x01 第 2.1 节 N1）",
      ]);
    });

    it("事件的状态、聚合、发出模块与 x01 不同", () => {
      const index = EVENTS.findIndex((item) => item.name === "order.submitted");
      const problems = problemsOf({
        events: replace(EVENTS, index, {
          ...EVENTS[index]!,
          status: "reserved",
          aggregates: ["order_item"],
          module: "delivery",
        }),
      });
      expect(problems).toContain("事件 order.submitted 的状态：契约是 reserved，frag是 v1");
      expect(problems).toContain(
        "事件 order.submitted 的聚合：契约是 order_item，x01 正文是 drama_order",
      );
      expect(problems).toContain("事件 order.submitted 的发出模块：契约是 delivery，frag是 order");
      expect(problems).toContain(
        "事件前缀 order. 的发出模块：契约是 delivery、order，x01 正文是 order",
      );
    });

    it("改里程碑：逐格对不上", () => {
      const index = TIMERS.findIndex((item) => item.kind === "order.start");
      const problems = problemsOf({
        timers: replace(TIMERS, index, { ...TIMERS[index]!, milestone: "M5" }),
      });
      expect(problems).toEqual([
        "里程碑：M1 的定时器应为 2 个（计划 第 8.4 节），契约登记了 1 个",
        "里程碑：M5 的定时器应为 4 个（计划 第 8.4 节），契约登记了 5 个",
      ]);
    });

    it("里程碑不在 M0–M7 之内", () => {
      const problems = problemsOf({
        jobs: replace(REGISTRY.jobs, 0, { ...REGISTRY.jobs[0]!, milestone: "M8" as Milestone }),
      });
      expect(problems.some((problem) => /^里程碑：周期任务 \S+ 的里程碑是“M8”/.test(problem))).toBe(
        true,
      );
    });

    it("关键类写反；定时器换了主体", () => {
      const index = TIMERS.findIndex((item) => item.kind === "po.expire");
      expect(
        problemsOf({ timers: replace(TIMERS, index, { ...TIMERS[index]!, critical: false }) }),
      ).toEqual([
        "定时器 po.expire × billing_order 的关键类：契约是 否，frag是 是",
        "定时器 po.expire × billing_order 的关键类：契约是 否，x01 正文是 是",
      ]);
      const moved = problemsOf({
        timers: replace(TIMERS, index, { ...TIMERS[index]!, subject: "payment_txn" }),
      });
      expect(moved).toContain("定时器：契约有而x01 正文没有：po.expire × payment_txn");
      expect(moved).toContain("定时器：x01 正文有而契约没有：po.expire × billing_order");
    });

    it("队列、回调、命令行只有正文可比：改了叫法也报", () => {
      const problems = problemsOf({
        queues: replace(REGISTRY.queues, 0, { ...REGISTRY.queues[0]!, label: "出站投递（新）" }),
        callbacks: REGISTRY.callbacks.slice(1),
        commands: [...REGISTRY.commands, { ...REGISTRY.commands[0]!, id: "Bad-Id" }],
      });
      expect(
        problems.some((problem) => problem.startsWith("队列通道：契约有而x01 正文没有：")),
      ).toBe(true);
      expect(
        problems.some((problem) => problem.startsWith("回调处理：x01 正文有而契约没有：")),
      ).toBe(true);
      expect(problems.some((problem) => problem.startsWith("命令行的叫法重复登记："))).toBe(true);
      expect(problems.some((problem) => problem.endsWith("的标识符 Bad-Id 不是小写蛇形"))).toBe(
        true,
      );
    });

    it("周期任务与定时器的 kind 撞名", () => {
      const problems = problemsOf({
        jobs: [...REGISTRY.jobs, { kind: "sla.breach", milestone: "M0", module: "sla" }],
      });
      expect(problems).toContain(
        "周期任务的 kind（与定时器的 kind 合在一起看）重复登记：sla.breach",
      );
    });
  });
});

describe("归属表 docs/plan/x01-map.md 是生成物（验收 5）", () => {
  it("一项一行，共 113 行；每项都有里程碑与所属模块", () => {
    const rows = x01MapRows();
    expect(rows).toHaveLength(34 + 24 + 25 + 11 + 8 + 7 + 4);
    for (const row of rows) {
      expect(MAP_CATEGORIES).toContain(row.category);
      expect(MILESTONES).toContain(row.milestone);
      expect(row.module).not.toBe("");
    }
    expect(new Set(rows.map((row) => `${row.category} ${row.name}`)).size).toBe(rows.length);
  });

  it("提交的文件与登记数据现生成的逐字节相同，且已交给 git（过期就跑 pnpm registry:generate）", () => {
    expect(readFileSync(X01_MAP_PATH, "utf8")).toBe(renderX01Map());
    expect(mapFileProblems()).toEqual([]);
  });

  it("登记数据变了而没重新生成：报得出来", () => {
    const changed = { ...REGISTRY, subscribers: SUBSCRIBERS.slice(1) };
    expect(mapFileProblems(changed)).toEqual([
      "归属表：docs/plan/x01-map.md 与登记数据现生成的不一致（它是生成物：跑 pnpm registry:generate，不手改）",
    ]);
  });

  it("输出稳定：两次生成字节相同，结尾换行", () => {
    expect(renderX01Map()).toBe(renderX01Map());
    expect(renderX01Map().endsWith("|\n")).toBe(true);
  });
});

describe("纯常量子路径 ./registry 不带 Zod（验收 8）", () => {
  it("包清单把 ./registry 指到本目录的入口；入口可达的文件不引任何包", () => {
    const manifest = readJson("packages/contract/package.json") as {
      exports: Record<string, { types: string; default?: string }>;
    };
    expect(manifest.exports["./registry"]).toEqual({
      types: "./src/registry/index.ts",
      default: "./src/registry/index.ts",
    });
    const scan = importsReachableFrom(join(registryDir, "index.ts"));
    expect(scan.files.map((file) => file.slice(registryDir.length + 1)).sort()).toEqual(
      ["define.ts", "formats.ts", "index.ts", ...moduleFiles.map((name) => `${name}.ts`)].sort(),
    );
    expect(scan.packages).toEqual([]);
    expect(scan.unresolved).toEqual([]);
  });
});
