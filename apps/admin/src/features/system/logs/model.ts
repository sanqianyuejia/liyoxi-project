import { AuditLogListQuerySchema } from "@liyoxi/contract/queries/admin";
import { addDays, calendarDate } from "@liyoxi/shared/time";
import { canEnterPage, findPage } from "../../../lib/menu";
import type { AccessSnapshot } from "../../../lib/permissions";
import { readContractQuery } from "../../../lib/contract-query";
import type { AuditDetail, AuditQuery } from "./api";
export const AUDIT_KEY = ["system", "logs"] as const;
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const queryKeys = [
  "stream",
  "category",
  "actorType",
  "actorId",
  "targetType",
  "targetId",
  "targetKey",
  "entityId",
  "storeId",
  "q",
  "createdFrom",
  "createdTo",
  "cursor",
  "limit",
] as const;
export type AuditSearch = Record<string, string>;
export function auditSearch(raw: Readonly<Record<string, unknown>>): AuditSearch {
  const candidate = { ...raw };
  // 不透明游标仅校验运输边界；内容仍由真实服务端校验。
  if (
    typeof candidate.cursor !== "string" ||
    candidate.cursor.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(candidate.cursor)
  )
    delete candidate.cursor;
  if (candidate.targetId && candidate.targetKey) {
    delete candidate.targetId;
    delete candidate.targetKey;
  }
  if (
    typeof candidate.createdFrom === "string" &&
    typeof candidate.createdTo === "string" &&
    candidate.createdFrom > candidate.createdTo
  ) {
    delete candidate.createdFrom;
    delete candidate.createdTo;
  }
  const { wire } = readContractQuery(AuditLogListQuerySchema, candidate, {
    keys: queryKeys,
    defaults: { stream: "ops", limit: "20" },
    keywordLimit: 200,
  });
  if (typeof raw.id === "string" && uuid.test(raw.id)) wire.id = raw.id;
  return wire;
}
export function auditQuery(search: AuditSearch): AuditQuery {
  const { id: _id, ...wire } = auditSearch(search);
  void _id;
  return AuditLogListQuerySchema.parse(wire);
}
/** 同一查询的游标前驱按筛选范围隔离；URL顺序或详情选择不改变范围。 */
export function cursorScope(search: AuditSearch): string {
  const query = auditQuery(search);
  return JSON.stringify(
    queryKeys.filter((key) => key !== "cursor").map((key) => [key, query[key] ?? null]),
  );
}
export function changeFilter(
  search: AuditSearch,
  patch: Readonly<Record<string, string | undefined>>,
): AuditSearch {
  const next = { ...search, ...patch };
  delete next.cursor;
  delete next.id;
  return auditSearch(next);
}
export function datePreset(
  days: 7 | 30 | "all",
  now = new Date(),
): Record<string, string | undefined> {
  const today = calendarDate(now);
  return days === "all"
    ? { createdFrom: undefined, createdTo: undefined }
    : { createdFrom: addDays(today, 1 - days), createdTo: today };
}
export function approxSummary(total: number): string {
  return `共 ${total.toLocaleString("zh-CN")} 条${total >= 10000 ? "（最多显示 10,000 条）" : "（近似）"}`;
}
export function canSeeAccess(access: AccessSnapshot | null): boolean {
  return access?.staff.roleKey === "super_admin";
}
export function actorKey(access: AccessSnapshot | null): string {
  return access
    ? `${access.staff.id}:${access.staff.roleKey}:${access.moduleLevels.system ?? "n"}:${access.dataScope}`
    : "anonymous";
}
export function safeLink(
  link: AuditDetail["link"],
  access: AccessSnapshot | null,
): { href: string; label: string } | null {
  if (!link) return null;
  const page = findPage(link.route);
  if (!page?.implemented || !canEnterPage(access, page)) return null;
  // 只采用已落地且明确支持的关联入口；后端 route/params 绝不作为自由 URL。
  if (link.route === "system.staff" && uuid.test(link.params.staffId ?? ""))
    return { href: "/sys/staff", label: link.label };
  return null;
}
export const categories = [
  ["refund", "退款"],
  ["points_adjust", "积分调整"],
  ["term_adjust", "套餐有效期调整"],
  ["price_adjust", "积分价调整"],
  ["points_expire", "积分清零"],
  ["points_grant", "积分发放"],
  ["profile_edit", "档案修改"],
  ["staff_authz", "员工与权限"],
  ["param", "参数修改"],
  ["dict", "字典修改"],
  ["plan_config", "套餐与积分包调整"],
  ["export", "导出"],
  ["member", "成员"],
  ["account_security", "账号安全"],
  ["manager_assign", "交付经理分配与转移"],
  ["system_ops", "系统运维"],
  ["report", "报表"],
  ["merchant_quota", "主体额度覆盖"],
  ["merchant_lifecycle", "主体关闭"],
  ["referral_code", "渠道码登记"],
  ["ops_config", "运营配置"],
  ["agreement", "协议版本"],
  ["notify_config", "消息配置"],
  ["payment", "付款"],
  ["invoice", "发票"],
  ["recon", "对账"],
  ["finance_config", "财务配置"],
  ["docs", "授权书"],
  ["delivery", "交付"],
  ["service_ticket", "客服工单"],
  ["approval", "审批"],
  ["review", "审核"],
  ["flow", "流程纠偏"],
  ["pii_reveal", "明文访问留痕"],
  ["file_access", "敏感文件签发"],
] as const;
export function categoryLabel(code: string): string {
  return categories.find(([key]) => key === code)?.[1] ?? "其他类别";
}
export function categoryOptions(stream: string) {
  return categories
    .filter(([key]) => (stream === "access") === ["pii_reveal", "file_access"].includes(key))
    .map(([value, label]) => ({ value, label }));
}
