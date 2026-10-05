// 状态机的登记与两个端口（W0-16）。迁移表本身在 @liyoxi/shared/machines；这里是表里没有的那一半：
// 守卫与副作用的实现、随状态一起写的列、活动流默认描述，由拥有状态机的模块在自己的 register.ts 里登记：
//
//   portImplementations: [implementKeyed(machinePort, chainKey("staff", "status"), { guards: { … }, … })]
//
// L0 不引上层模块，所以是端口。装配之后 createFlow 对照迁移表把登记校验一遍，写错的一次报全。
import type { AuditAction, AuditCategory } from "@liyoxi/contract";
import { STATE_MACHINES } from "@liyoxi/contract/registry";
import type { StateFieldOf, StateMachineName } from "@liyoxi/contract/registry";
import { ADMIN_FORCE_EVENT, findChain } from "@liyoxi/shared/machines";

import type { EmitContext } from "../events/index.js";
import { defineKeyedPort, definePort } from "../kernel/index.js";
import type { Assembly, Tx } from "../kernel/index.js";
import { FlowError } from "./errors.js";

/** 一条链：状态机（表名）与它的一个状态列。写错的组合过不了类型检查 */
export type ChainRef = {
  [M in StateMachineName]: { readonly machine: M; readonly stateField: StateFieldOf<M> };
}[StateMachineName];

/** 一次迁移的事实：守卫、副作用、活动流默认描述拿到的都是它 */
export interface TransitionFacts {
  readonly machine: StateMachineName;
  readonly stateField: string;
  readonly subjectId: string;
  /** 迁移前的状态；新建为空 */
  readonly from: string | null;
  readonly to: string;
  /** 迁移事件码 */
  readonly event: string;
  /** 放行它的那一行文档（分组:行号） */
  readonly ref: string;
  /** 业务时间：这次迁移的 occurred_at */
  readonly now: Date;
  readonly ctx: EmitContext;
  readonly entityId: string | null;
  readonly storeId: string | null;
  readonly reasonCode: string | null;
  readonly note: string | null;
  readonly payload: Readonly<Record<string, unknown>> | null;
  /** 用例随迁移传给守卫与副作用的东西，flow 不看 */
  readonly args: unknown;
}

/** 守卫：true 放行；false 即 409 STATE_NOT_ALLOWED；要给更具体的领域码就抛 AppError（约定 C53） */
export type Guard = (tx: Tx, facts: TransitionFacts) => Promise<boolean>;
/** 副作用：状态已改、状态历史已写之后，在同一事务里做（子表、定时器、父级推导） */
export type Effect = (tx: Tx, facts: TransitionFacts) => Promise<void>;

/** 用例没传审计内容时，补的那条 activity 行写什么 */
export interface ActivityDescription {
  readonly category: AuditCategory;
  /** <领域>.<对象>.<动作> */
  readonly action: AuditAction;
  /** 渲染好的中文标题 */
  readonly summary: string;
  readonly targetLabel?: string | null;
}

/** 一条链的登记 */
export interface MachineBinding {
  /** 随迁列：库的 CHECK 把它们与状态绑在一起，要与状态在同一条 UPDATE 里写（如 staff 的 disabled_at） */
  readonly companions?: readonly string[];
  /** 活动流默认描述；返回 null 即这次迁移没有默认描述，用例必须自己传审计内容 */
  readonly activity?: (facts: TransitionFacts) => ActivityDescription | null;
  /** 守卫，键用 rowKey(文档行, 事件码)。迁移行标了守卫而这里没有的，迁移时抛内部错误，不放行 */
  readonly guards?: Readonly<Record<string, Guard>>;
  /** 副作用，键同上 */
  readonly effects?: Readonly<Record<string, Effect>>;
}

/** 守卫与副作用的键：按文档行登记，不按事件码（同一组“当前状态、事件码、新状态”可以来自几行文档，守卫各不相同） */
export const rowKey = (ref: string, event: string): string => `${ref} ${event}`;
/** 状态机登记的键 */
export const chainKey = <M extends StateMachineName>(
  machine: M,
  stateField: StateFieldOf<M>,
): string => `${machine}.${stateField}`;

/** 状态机的登记：按链多实现。没有登记的链照样能迁移，只是没有守卫、随迁列与默认描述 */
export const machinePort = defineKeyedPort<MachineBinding>("flow.machine");

/** “工作分钟”端口：两个时刻之间的工作分钟数。真实实现要读工作日历与工作时段，不在本模块：由 sla 登记（W0-30a） */
export interface WorkMinutes {
  between(tx: Tx, span: { machine: StateMachineName; from: Date; to: Date }): Promise<number>;
}

/** 没有模块注册时拿到的就是它。它不是空实现：要算工作分钟的表迁移时见到它即抛错，不写空值（只增表事后改不了） */
export const UNREGISTERED_WORK_MINUTES: WorkMinutes = {
  between: () =>
    Promise.reject(new FlowError("work_minutes", "工作分钟端口（flow.workMinutes）还没有模块注册")),
};
export const workMinutesPort = definePort<WorkMinutes>("flow.workMinutes", {
  fallback: UNREGISTERED_WORK_MINUTES,
});

/** 写 elapsed_work_min 的状态机：交付工单、审批单、客服工单（01 分组 第 2.6 节） */
export const WORK_MINUTE_MACHINES: readonly StateMachineName[] = [
  "delivery_ticket",
  "approval_request",
  "service_ticket",
];
/** 没有主体与门店的状态机：不补 activity 行，审计由用例传入（03 分组 第 2.10 节第 4 条） */
export const NO_ACTIVITY_MACHINES: readonly StateMachineName[] = ["staff"];

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
/** 这几列由 flow 自己写，不能当随迁列 */
const RESERVED_COLUMNS = ["id", "lock_version", "updated_at"];

/** 取出装配结果里的状态机登记，对照迁移表校验。写错的一次列全，抛 FlowError（进程启动失败） */
export function bindingsOf(
  assembly: Pick<Assembly, "portEntries">,
): ReadonlyMap<string, MachineBinding> {
  const bindings = assembly.portEntries(machinePort);
  const problems: string[] = [];
  for (const [key, binding] of bindings) {
    const [machine = "", stateField = ""] = key.split(".");
    const chain = findChain(machine, stateField);
    if (chain === undefined) {
      problems.push(`${key}：迁移表里没有这条链（键用 chainKey(状态机, 状态列)）`);
      continue;
    }
    const rows = new Set(
      chain.rows
        .filter((row) => row.event !== ADMIN_FORCE_EVENT)
        .map((row) => rowKey(row.ref, row.event)),
    );
    for (const kind of ["guards", "effects"] as const) {
      for (const row of Object.keys(binding[kind] ?? {})) {
        if (!rows.has(row))
          problems.push(`${key}：${kind} 的键 ${JSON.stringify(row)} 不是这条链上的行`);
      }
    }
    const stateColumns: readonly string[] = STATE_MACHINES[chain.machine];
    for (const column of binding.companions ?? []) {
      if (
        !IDENTIFIER.test(column) ||
        RESERVED_COLUMNS.includes(column) ||
        stateColumns.includes(column)
      ) {
        problems.push(`${key}：随迁列 ${JSON.stringify(column)} 的写法不对，或是只许 flow 写的列`);
      }
    }
  }
  if (problems.length > 0)
    throw new FlowError(
      "binding",
      `状态机的登记有 ${problems.length} 处不对：${problems.join("；")}`,
    );
  return bindings;
}
