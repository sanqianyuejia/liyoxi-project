// 状态迁移的样例（W0-16）：样例守卫、活动流默认描述、固定日历的工作分钟实现，与“测试装配 + events + flow”的入口。
// 只给测试用。真实的守卫、描述由各域登记；真实的工作分钟由 sla 登记（W0-30a），测试装配缺省带着它。
// 名字带 lyxtest 前缀，不进契约的正式目录。
import type { PrismaClient } from "@liyoxi/db";
import { chainOf } from "@liyoxi/shared/machines";
import type { Chain } from "@liyoxi/shared/machines";
import { dayOfWeek } from "@liyoxi/shared/time";
import { workingMinutesBetween } from "@liyoxi/shared/workcal";
import { z } from "zod";

import { createEvents } from "../events/index.js";
import type { Events, TestEventDefinition } from "../events/index.js";
import { chainKey, createFlow, machinePort, rowKey, workMinutesPort } from "../flow/index.js";
import type {
  ActivityDescription,
  Flow,
  Guard,
  MachineBinding,
  WorkMinutes,
} from "../flow/index.js";
import { createTxRunner, defineRegistration, implement, implementKeyed } from "../kernel/index.js";
import type { Assembly, ModuleRegistration, TxRunner } from "../kernel/index.js";
import { assembleForTest } from "./assembly.js";
import { createClock } from "./clock.js";
import type { AdjustableClock } from "./clock.js";

/** 样例事件：迁移事件，带三个迁移键；聚合是用例迁移的那几张表 */
export const SAMPLE_FLOW_EVENT = "lyxtest.flow.changed";
export const SAMPLE_FLOW_EVENTS: readonly TestEventDefinition[] = [
  {
    name: SAMPLE_FLOW_EVENT,
    aggregates: ["staff", "entity", "approval_request"],
    schema: z.strictObject({
      v: z.literal(1),
      fromState: z.string().nullable(),
      toState: z.string(),
      transition: z.string(),
    }),
  },
];

/** 样例守卫：迁移时传 args: { deny: true } 即不放行，其余放行 */
export const sampleGuard: Guard = (_tx, facts) =>
  Promise.resolve((facts.args as { deny?: boolean } | undefined)?.deny !== true);

/** 给一条链上写了守卫的行都登记样例守卫 */
export function sampleGuards(chain: Chain): Record<string, Guard> {
  return Object.fromEntries(
    chain.rows.filter((row) => row.guard).map((row) => [rowKey(row.ref, row.event), sampleGuard]),
  );
}

/** 样例的活动流默认描述 */
export const sampleActivity = (facts: {
  machine: string;
  event: string;
  to: string;
}): ActivityDescription => ({
  category: "flow",
  action: `lyxtest.${facts.machine}.transition`,
  summary: `${facts.machine} 经 ${facts.event} 进入 ${facts.to}`,
});

/** 固定日历的工作分钟：周一至周五 09:00–18:00（北京时间），不看节假日 */
export const fixedWorkMinutes: WorkMinutes = {
  between: (_tx, span) =>
    Promise.resolve(
      workingMinutesBetween(
        {
          isWorkday: (date) => dayOfWeek(date) >= 1 && dayOfWeek(date) <= 5,
          workStartMinute: 540,
          workEndMinute: 1080,
        },
        span.from,
        span.to,
      ).minutes,
    ),
};

/** 样例登记用到的四条链：员工、主体的两个状态列、审批单 */
export const SAMPLE_FLOW_BINDINGS: Readonly<Record<string, MachineBinding>> = {
  // 员工：没有主体与门店，不给默认描述（给了也不会用）
  [chainKey("staff", "status")]: {
    companions: ["disabled_at", "disabled_reason"],
    guards: sampleGuards(chainOf("staff", "status")),
  },
  [chainKey("entity", "lifecycle")]: {
    companions: ["closed_at"],
    activity: sampleActivity,
    guards: sampleGuards(chainOf("entity", "lifecycle")),
  },
  [chainKey("entity", "verification_status")]: {
    companions: ["verified_at"],
    activity: sampleActivity,
    guards: sampleGuards(chainOf("entity", "verification_status")),
  },
  [chainKey("approval_request", "status")]: {
    companions: ["decided_at", "decided_by_staff_id", "decision_note"],
    guards: sampleGuards(chainOf("approval_request", "status")),
  },
};

export interface SampleFlowOptions {
  /** 替换状态机的登记（键用 chainKey）；不给即 SAMPLE_FLOW_BINDINGS */
  readonly bindings?: Readonly<Record<string, MachineBinding>>;
  /**
   * 工作分钟端口的实现。不给即真实的那一个（sla 登记的：读库里的工作日历与工作时段，日历没铺的日期
   * 按周一至周五算）；给了就顶掉真实的；null 即没有实现（三张表迁移时抛错）
   */
  readonly workMinutes?: WorkMinutes | null;
}

/** 样例登记：把状态机的登记与工作分钟的实现按端口登记进去 */
export function sampleFlowRegistration(options: SampleFlowOptions = {}): ModuleRegistration {
  const bindings = options.bindings ?? SAMPLE_FLOW_BINDINGS;
  return defineRegistration("lyxtest_flow", {
    portImplementations: [
      ...Object.entries(bindings).map(([key, binding]) =>
        implementKeyed(machinePort, key, binding),
      ),
      ...(options.workMinutes ? [implement(workMinutesPort, options.workMinutes)] : []),
    ],
  });
}

export interface SampleFlow {
  readonly assembly: Assembly;
  readonly events: Events;
  readonly flow: Flow;
  readonly tx: TxRunner;
  readonly clock: AdjustableClock;
}

/** 测试装配（真实模块的登记加样例登记）之上建 events 与 flow：连的是传进来的测试库 */
export function createSampleFlow(
  prisma: PrismaClient,
  options: SampleFlowOptions = {},
): SampleFlow {
  const assembly = assembleForTest({
    entry: "api",
    extra: [sampleFlowRegistration(options)],
    ...(options.workMinutes === undefined ? {} : { withoutRealPorts: [workMinutesPort] }),
  });
  const tx = createTxRunner({ prisma, appEnv: "test" });
  const clock = createClock();
  const events = createEvents({ assembly, clock, tx, testEvents: SAMPLE_FLOW_EVENTS });
  const flow = createFlow({ assembly, clock, events });
  return { assembly, events, flow, tx, clock };
}
