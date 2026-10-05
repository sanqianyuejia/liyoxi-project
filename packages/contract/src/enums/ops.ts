// ops 模块的枚举。取值的中文含义见 docs/data-model/ 下 15 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const WORKER_LEASE_NAME = defineEnum(
  "worker_lease_name",
  ["worker_lease.name"],
  ["primary"],
);

export const ALERT_EVENT_SEVERITY = defineEnum(
  "alert_event_severity",
  ["alert_event.severity"],
  ["P1", "P2", "P3"],
);

export const ALERT_EVENT_KIND = defineEnum(
  "alert_event_kind",
  ["alert_event.kind"],
  ["probe", "event"],
);

export const ALERT_EVENT_STATUS = defineEnum(
  "alert_event_status",
  ["alert_event.status"],
  ["open", "acked", "resolved"],
);

export const INVARIANT_RUN_MODE = defineEnum(
  "invariant_run_mode",
  ["invariant_run.mode"],
  ["quick", "full"],
);

export const INVARIANT_RUN_TRIGGER = defineEnum(
  "invariant_run_trigger",
  ["invariant_run.trigger"],
  ["schedule", "deploy", "drill", "manual"],
);

export const INVARIANT_RUN_STATUS = defineEnum(
  "invariant_run_status",
  ["invariant_run.status"],
  ["running", "succeeded", "failed"],
);

export const INVARIANT_VIOLATION_MODULE = defineEnum(
  "invariant_violation_module",
  ["invariant_violation.module"],
  [
    "kernel",
    "events",
    "timers",
    "flow",
    "sla",
    "audit",
    "config",
    "security",
    "authz",
    "providers",
    "identity",
    "tenant",
    "staff",
    "approval",
    "portal",
    "profile",
    "content",
    "media",
    "notify",
    "docs",
    "billing",
    "order",
    "ad",
    "delivery",
    "publish",
    "support",
    "workbench",
    "analytics",
    "reports",
    "exports",
    "ops",
  ],
);

export const INVARIANT_VIOLATION_SEVERITY = defineEnum(
  "invariant_violation_severity",
  ["invariant_violation.severity"],
  ["P1", "P2"],
);
