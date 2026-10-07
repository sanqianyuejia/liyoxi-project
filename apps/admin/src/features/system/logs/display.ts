import {
  maskBankAccount,
  maskEmail,
  maskLicenseNo,
  maskLandline,
  maskName,
  maskPhone,
  maskUscc,
} from "@liyoxi/shared/mask";
// 只展示具名安全字段。未知复杂值不递归、不输出 JSON；私有页口不取代后端脱敏。
const labels: Record<string, string> = {
  status: "状态",
  staffRoleKey: "角色",
  roleKey: "角色",
  name: "名称",
  isLead: "是否主管",
  isEnabled: "是否启用",
  versionNo: "版本",
  amountFen: "金额（分）",
  points: "积分",
  lockVersion: "版本",
  phone: "手机号",
  phoneMask: "手机号（已脱敏）",
  contactPhone: "联系电话",
  uscc: "统一社会信用代码",
  certNo: "证照号码",
  legalRepName: "法定代表人",
  principalName: "负责人",
  purpose: "访问用途",
  note: "备注",
  field: "字段",
  action: "动作",
  keys: "变化字段",
  length: "内容长度",
  sha256: "内容摘要",
  count: "数量",
  source: "来源",
  rules: "规则",
  calendarVersion: "日历版本",
  dueAt: "到期时间",
};
const purposes: Record<string, string> = {
  contact_merchant: "联系商家",
  verify_identity: "核验身份",
  finance_ops: "财务处理",
  other: "其他",
};
const accessFields: Readonly<Record<string, string>> = {
  phone: "手机号",
  contact_phone: "联系电话",
  new_phone: "新手机号",
  uscc: "统一社会信用代码",
  legal_rep_name: "法定代表人",
  cert_no: "证照号码",
  principal_name: "负责人",
  submitted_fields: "提交材料",
  reviewed_fields: "审核材料",
  tax_no: "纳税人识别号",
  addr_tel: "地址与电话",
  bank_account: "银行账号",
  recv_email: "收件邮箱",
  mail_to: "邮寄信息",
  payee_account: "收款账号",
  account_no: "银行账号",
};
export function accessFieldLabel(action: string): string | undefined {
  const match = /^pii\.([a-z][a-z0-9_]*)\.reveal$/.exec(action);
  return match
    ? Object.hasOwn(accessFields, match[1]!)
      ? accessFields[match[1]!]
      : "其他字段"
    : undefined;
}
export function safeText(value: string): string {
  return value
    .replace(/\b1\d{10}\b/g, maskPhone)
    .replace(/\b0\d{2,3}-?\d{7,8}\b/g, maskLandline)
    .replace(/\bJY\d{8,}\b/g, maskLicenseNo)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, maskEmail)
    .replace(/\b\d{12,}\b/g, maskBankAccount)
    .replace(/\b(?=[0-9A-Z]{0,17}[A-Z])[0-9A-Z]{18}\b/g, maskUscc)
    .slice(0, 500);
}
export function displayField(key: string, value: unknown): { label: string; value: string } | null {
  if (
    /password|token|secret|recovery|activation|credential|signature|cookie|enc$|bidx|^value$/i.test(
      key,
    )
  )
    return null;
  const known = Object.hasOwn(labels, key);
  const label = known ? labels[key]! : "其他字段";
  if (value === null || value === undefined) return { label, value: "—" };
  if (typeof value === "object") return { label, value: "复杂内容已裁剪" };
  if (!known) return { label, value: "已裁剪" };
  const text = String(value);
  const mask = /phone/i.test(key)
    ? maskPhone
    : /uscc/i.test(key)
      ? maskUscc
      : /certNo/i.test(key)
        ? maskLicenseNo
        : /legalRepName|principalName/i.test(key)
          ? maskName
          : /email/i.test(key)
            ? maskEmail
            : /bankAccount|accountNo/i.test(key)
              ? maskBankAccount
              : undefined;
  if (mask) return { label, value: safeText(text.includes("*") ? text : mask(text)) };
  if (key === "purpose")
    return { label, value: Object.hasOwn(purposes, text) ? purposes[text]! : "其他" };
  return { label, value: typeof value === "boolean" ? (value ? "是" : "否") : safeText(text) };
}
export function displayFields(
  value: Record<string, unknown> | null,
): { key: string; label: string; value: string }[] {
  return Object.entries(value ?? {})
    .slice(0, 30)
    .flatMap(([key, value]) => {
      const result = displayField(key, value);
      return result ? [{ key, ...result }] : [];
    });
}
export function authLabel(value: string | null): string {
  return value === "password+totp"
    ? "账号密码 ＋ 动态口令"
    : value === "password+recovery"
      ? "账号密码 ＋ 恢复码"
      : value === "system"
        ? "系统任务"
        : value === null
          ? "—"
          : "其他登录方式";
}
