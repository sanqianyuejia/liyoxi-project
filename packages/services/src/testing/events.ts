// 出站事件的样例（W0-15）：样例事件、样例订阅者，与“测试装配 + events”的一步到位入口。只给测试用。
// 名字都带 lyxtest 前缀，不进契约的正式目录（任务书 W0-15 第 11 节第 8 项）。
import type { PrismaClient } from "@liyoxi/db";
import { z } from "zod";

import { createEvents } from "../events/index.js";
import type { Events, TestEventDefinition } from "../events/index.js";
import { createIdentityContext, createTxRunner, defineRegistration } from "../kernel/index.js";
import type {
  Assembly,
  AssemblyEntry,
  DeliveredEvent,
  IdentityContext,
  ModuleRegistration,
  Tx,
  TxRunner,
} from "../kernel/index.js";
import { assembleForTest } from "./assembly.js";
import { createClock } from "./clock.js";
import type { AdjustableClock } from "./clock.js";

/**
 * 样例事件：
 *   lyxtest.order.placed  带聚合（drama_order），三个样例订阅者都订阅它
 *   lyxtest.pinged        不带聚合，没有订阅者
 *   lyxtest.unspecified   没交载荷 schema：emit 不给发
 */
export const SAMPLE_EVENTS: readonly TestEventDefinition[] = [
  {
    name: "lyxtest.order.placed",
    aggregates: ["drama_order"],
    schema: z.strictObject({ v: z.literal(1), dramaOrderId: z.uuid(), points: z.int().optional() }),
  },
  { name: "lyxtest.pinged", schema: z.strictObject({ v: z.literal(1), n: z.int() }) },
  { name: "lyxtest.unspecified" },
];

/** 三个样例订阅者的名字，按字典序 */
export const SAMPLE_SUBSCRIBERS = [
  "lyxtest.onPlacedAudit",
  "lyxtest.onPlacedDocs",
  "lyxtest.onPlacedNotify",
] as const;

/** 样例订阅者的登记：三个订阅者都订阅 lyxtest.order.placed；被调到时往 handled 里记“订阅者名:事件 id” */
export function sampleSubscriberRegistration(handled: string[] = []): ModuleRegistration {
  return defineRegistration("lyxtest_events", {
    subscribers: SAMPLE_SUBSCRIBERS.map((name) => ({
      name,
      events: ["lyxtest.order.placed"],
      handle: async (_tx: Tx, event: DeliveredEvent): Promise<void> => {
        handled.push(`${name}:${event.id}`);
      },
    })),
  });
}

/** 系统动作的身份上下文（定时器、订阅者、回调、周期任务触发的事件用这种） */
export const sampleSystemContext = (job = "lyxtest.job"): IdentityContext =>
  createIdentityContext({ actor: { type: "system", job } });

export interface SampleEventsOptions {
  /** 模拟哪个进程，缺省 worker */
  readonly entry?: AssemblyEntry;
  /** 替换样例订阅者的登记；不给即三个样例订阅者 */
  readonly registrations?: readonly ModuleRegistration[];
  /** 替换样例事件 */
  readonly testEvents?: readonly TestEventDefinition[];
}

export interface SampleEvents {
  readonly assembly: Assembly;
  readonly events: Events;
  readonly tx: TxRunner;
  readonly clock: AdjustableClock;
  /** 样例订阅者被调到的记录 */
  readonly handled: string[];
}

/** 测试装配（真实模块的登记加样例订阅者）之上建 events：连的是传进来的测试库 */
export function createSampleEvents(
  prisma: PrismaClient,
  options: SampleEventsOptions = {},
): SampleEvents {
  const handled: string[] = [];
  const assembly = assembleForTest({
    entry: options.entry ?? "worker",
    extra: options.registrations ?? [sampleSubscriberRegistration(handled)],
  });
  const tx = createTxRunner({ prisma, appEnv: "test" });
  const clock = createClock();
  const events = createEvents({
    assembly,
    clock,
    tx,
    testEvents: options.testEvents ?? SAMPLE_EVENTS,
  });
  return { assembly, events, tx, clock, handled };
}
