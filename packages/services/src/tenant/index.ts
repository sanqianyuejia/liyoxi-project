// tenant：主体、门店与成员关系（W1-03 交最小集：建主体、成员关系解析、门店列表与额度、记住当前门店、给 profile 的三个写函数）。
// 用法见本目录的 README.md。新增门店、停用与恢复、成员、邀请、主体关闭随 M2。
export { createTenant } from "./service.js";
export type { Tenant, TenantDeps, UseCaseOptions } from "./service.js";
export { billingAccountPort } from "./ports.js";
export type { BillingAccountOpener } from "./ports.js";
export { ONE_ENTITY_CONSTRAINT } from "./create-entity.js";
export type { StoreMembership } from "./membership.js";
export type { QuotaUsage } from "./quota.js";
export type { ActiveMembership, TenantReader } from "./repo.js";
export { QUALIFICATION_ACTIONS, STORE_NAME_MAX, STORE_NAME_MIN } from "./qualification.js";
export type {
  QualificationAction,
  StoreQualificationInput,
  StoreQualificationResult,
} from "./qualification.js";
export { TENANT_MACHINE_BINDINGS } from "./machines.js";
export type {
  CreateEntityArgs,
  QualificationArgs,
  QualificationRejection,
  VerifiedEntityFields,
} from "./machines.js";
export { MEMBER_PREVIEW_MAX } from "./stores.js";
export {
  findI1Violations,
  findI27Violations,
  findI29Violations,
  findI7Violations,
  TENANT_INVARIANT_LIMIT,
  USCC_UNIQUE_INDEX,
} from "./invariants.js";
export { registration } from "./register.js";
// W1-04：给 identity 的两个只读函数的类型
export type { ReferralHit } from "./briefs.js";
