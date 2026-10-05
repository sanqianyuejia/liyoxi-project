// 告警端口 alerts.raise（W0-17）。kernel 定义，ops 注册实现（G2-D）；没人实现时是空实现，只记一条调试日志。
// 依据：01 分组 第 2 节通用说明、第 5.2 节；15 分组 第 5.2 节。
// 实现方用自己的连接、在独立的短事务里写 alert_event，不加入调用方的事务；写失败不抛给调用方。
import { definePort } from "../assembly/index.js";
import type { Assembly } from "../assembly/index.js";
import { portLog, quiet } from "./log.js";

export const ALERT_SEVERITIES = ["P1", "P2", "P3"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export interface AlertInput {
  /** 规则键，小写点分、至少两段，如 outbox.exhausted */
  readonly rule: string;
  /** 同一规则下区分对象。指纹由实现方拼成 rule 或 rule:dimension，调用方不自拼 */
  readonly dimension?: string;
  readonly severity: AlertSeverity;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface Alerts {
  raise(input: AlertInput): Promise<void>;
}

export const noopAlerts: Alerts = {
  async raise(input) {
    portLog.debug({ port: "alerts.raise", ...input }, "告警端口没有实现：只记日志");
  },
};

export const alertsPort = definePort<Alerts>("alerts.raise", { fallback: noopAlerts });

/** 取告警端口。外壳保证实现抛错也不抛给调用方 */
export function alertsOf(assembly: Assembly): Alerts {
  const impl = assembly.port(alertsPort);
  return { raise: (input) => quiet(alertsPort.name, () => impl.raise(input)) };
}
