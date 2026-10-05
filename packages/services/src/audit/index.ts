// audit：审计日志的写入与每日校验（W0-14）。用法见本目录的 README.md。
// 只有写入，没有改、删的入口；查询与导出随 G2-A。
export { record, toAuditRow } from "./record.js";
export type { AuditEntry, AuditRecorded, AuditRequestMeta, AuditStream } from "./record.js";
export { diffFields } from "./diff.js";
export type { FieldDiff } from "./diff.js";
export { AUDIT_JSON_MAX_BYTES, AUDIT_JSON_MAX_DEPTH, AUDIT_TEXT_LIMITS } from "./sanitize.js";
export { sensitiveRule } from "./sensitive.js";
export { AUDIT_INVARIANTS, auditI2, auditI3, findUnknownAuditTargetTypes } from "./invariants.js";
export type { AuditInvariantCheck, AuditReader, AuditViolation } from "./invariants.js";
// W0-24：两条每日校验登记进不变量框架
export { registration } from "./register.js";
