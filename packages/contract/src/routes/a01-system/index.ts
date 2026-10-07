// 后台：登录、员工、权限与系统（docs/api/a01-system.md）：一个顶层资源一个文件，整个文件交给 defineRouteDoc 分拣。
// 加资源文件时在这里加一行 import，并放进下面的数组。
import { defineRouteDoc } from "../doc.js";

import * as alerts from "./alerts.js";
import * as approvals from "./approvals.js";
import * as assignmentPoolMembers from "./assignment-pool-members.js";
import * as auditLogs from "./audit-logs.js";
import * as auth from "./auth.js";
import * as calendarDays from "./calendar-days.js";
import * as checklistTemplates from "./checklist-templates.js";
import * as clientErrors from "./client-errors.js";
import * as debug from "./debug.js";
import * as dictItems from "./dict-items.js";
import * as dictTypes from "./dict-types.js";
import * as featureFlags from "./feature-flags.js";
import * as files from "./files.js";
import * as invariantRuns from "./invariant-runs.js";
import * as invariantViolations from "./invariant-violations.js";
import * as mediaJobs from "./media-jobs.js";
import * as outboxDeliveries from "./outbox-deliveries.js";
import * as outboxEvents from "./outbox-events.js";
import * as paramValues from "./param-values.js";
import * as piiReveals from "./pii-reveals.js";
import * as purgeRuns from "./purge-runs.js";
import * as roles from "./roles.js";
import * as sessions from "./sessions.js";
import * as staff from "./staff.js";
import * as staffGroups from "./staff-groups.js";
import * as staffSessions from "./staff-sessions.js";
import * as timers from "./timers.js";
import * as webhookEvents from "./webhook-events.js";

export const A01_SYSTEM = defineRouteDoc("a01-system", [
  alerts,
  approvals,
  assignmentPoolMembers,
  auditLogs,
  auth,
  calendarDays,
  checklistTemplates,
  clientErrors,
  debug,
  dictItems,
  dictTypes,
  featureFlags,
  files,
  invariantRuns,
  invariantViolations,
  mediaJobs,
  outboxDeliveries,
  outboxEvents,
  paramValues,
  piiReveals,
  purgeRuns,
  roles,
  sessions,
  staff,
  staffGroups,
  staffSessions,
  timers,
  webhookEvents,
]);

// 已带结构的路由与本文档的结构：api 的处理器与别的域从契约入口取（各包只加自己的资源文件）
export * from "./approvals.schemas.js";
export * from "./auth.js";
export * from "./auth.schemas.js";
export * from "./error-details.js";
export * from "./sessions.js";
export * from "./structures.js";
export * from "./approvals.js";
export * from "./dict-items.js";
export * from "./staff.js";
export * from "./roles.js";

export * from "./files.js";
export * from "./files.schemas.js";

export * from "./checklist.schemas.js";
export * from "./checklist-templates.js";

export * from "./dict-types.js";
export * from "./param-values.js";
export * from "./feature-flags.js";
export * from "./calendar-days.js";
export * from "./system-config.schemas.js";
export * from "./audit-logs.js";
export * from "./pii-reveals.js";
