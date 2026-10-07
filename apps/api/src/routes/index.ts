import { adminDictTypeHandlers } from "./admin/dict-types.js";
import { adminDictItemHandlers } from "./admin/dict-items.js";
import { adminParamValueHandlers } from "./admin/param-values.js";
import { adminFeatureFlagHandlers } from "./admin/feature-flags.js";
import { adminChecklistTemplateHandlers } from "./admin/checklist-templates.js";
import { adminCalendarDayHandlers } from "./admin/calendar-days.js";
import { orderHandlers } from "./order.js";
import { publishHandlers } from "./publish.js";
import { deliveryHandlers } from "./delivery.js";
import { deliveryDownloadHandlers } from "./delivery-download.js";
// 全部处理器的清单（W0-22）。各域的接口包：在本目录下建自己的文件（一条契约路由配一个 defineHandler），
// 在这里加一行展开。探活不在这里，在 ../probes.ts。
import { adminProfileHandlers } from "./admin/profile.js";
import { profileHandlers } from "./profile.js";
import { mallHandlers } from "./mall.js";
import { merchantFileHandlers } from "./files.js";
import { adminFileHandlers } from "./admin/files.js";
import type { HandlerEntry } from "../routing/define.js";

import { adminApprovalHandlers } from "./admin/approvals.js";
import { adminAuthHandlers } from "./admin/auth.js";
import { adminStaffHandlers } from "./admin/staff.js";
import { adminPiiRevealHandlers } from "./admin/pii-reveals.js";
import { adminAuditLogHandlers } from "./admin/audit-logs.js";
import { adminRoleHandlers } from "./admin/roles.js";
import { agreementHandlers } from "./agreements.js";
import { merchantViewHandlers } from "./merchant-views.js";
import { sessionHandlers } from "./sessions.js";
import { agreementConsentHandlers } from "./agreement-consents.js";
import { entityHandlers } from "./entities.js";
import { storeHandlers } from "./stores.js";
import { meHandlers } from "./me.js";
import { dictItemHandlers } from "./dict-items.js";
import { billingHandlers } from "./billing.js";
import { adminBillingHandlers } from "./admin/billing.js";

export const HANDLERS: readonly HandlerEntry[] = [
  ...orderHandlers,
  // W1-03：协议清单与版本正文（两条公开路由）
  ...agreementHandlers,
  ...mallHandlers,
  ...merchantFileHandlers,
  ...adminFileHandlers,
  // W1-04：静默登录、手机号登录、退出、当前账号
  ...sessionHandlers,
  // W1-01a：后台登录、激活、再验证、当前员工、退出（九条）
  ...adminAuthHandlers,
  ...merchantViewHandlers,
  ...adminApprovalHandlers,
  ...adminDictTypeHandlers,
  ...adminDictItemHandlers,
  ...adminParamValueHandlers,
  ...adminFeatureFlagHandlers,
  ...adminChecklistTemplateHandlers,
  ...adminCalendarDayHandlers,
  ...adminStaffHandlers,
  ...adminRoleHandlers,
  ...adminAuditLogHandlers,
  ...adminPiiRevealHandlers,
  ...agreementConsentHandlers,
  ...entityHandlers,
  ...storeHandlers,
  ...meHandlers,
  ...dictItemHandlers,
  ...billingHandlers,
  ...adminBillingHandlers,
  ...profileHandlers,
  ...publishHandlers,
  ...deliveryHandlers,
  ...deliveryDownloadHandlers,
  ...adminProfileHandlers,
];
