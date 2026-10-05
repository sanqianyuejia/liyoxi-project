// 不变量上报端口 invariants.report（W0-17）。kernel 定义，ops 注册实现（W0-24）；没人实现时是空实现。
// 依据：01 分组 第 5.2 节；15 分组 第 5.2 节。写入方式同告警：独立短事务，失败不抛给调用方。
// 由框架按 modes 运行的检查项不走这里（它们登记 run，由 W0-24 调度）；这里给巡检循环之类自己发现违规的地方用。
import { definePort } from "../assembly/index.js";
import type { Assembly, InvariantSeverity, InvariantSubject } from "../assembly/index.js";
import { portLog, quiet } from "./log.js";

export interface InvariantReport {
  /** 检查项编号，如 flow.STUCK_TICKET */
  readonly code: string;
  readonly module: string;
  readonly severity: InvariantSeverity;
  /** { type, id } 或 { type, key }；全局性的不传，要区分多条时传 { key } */
  readonly subject?: InvariantSubject;
  readonly entityId?: string;
  readonly detail: Readonly<Record<string, unknown>>;
  /** 已自愈的写上做了什么、何时 */
  readonly healed?: { readonly action: string; readonly at: Date };
}

export interface Invariants {
  report(input: InvariantReport): Promise<void>;
}

export const noopInvariants: Invariants = {
  async report(input) {
    portLog.debug({ port: "invariants.report", ...input }, "不变量上报端口没有实现：只记日志");
  },
};

export const invariantsPort = definePort<Invariants>("invariants.report", {
  fallback: noopInvariants,
});

/** 取不变量上报端口。外壳保证实现抛错也不抛给调用方 */
export function invariantsOf(assembly: Assembly): Invariants {
  const impl = assembly.port(invariantsPort);
  return { report: (input) => quiet(invariantsPort.name, () => impl.report(input)) };
}
