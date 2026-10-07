// authz 模块（L0）的出口。W1-01a 的第一个 PR 交付：员工上下文、判定、再验证与二次确认、数据范围与范围谓词。
// 用法见本目录的 README.md。authz 不读库：员工、角色、本组成员由 staff 模块加载后传进来。
export {
  effectivePermissions,
  isStaffRoleKey,
  normalizeRoleConfig,
  V1_PERMISSION_KEYS,
} from "./role-config.js";
export type { RawRoleConfig, RoleConfig, RoleConfigIssue } from "./role-config.js";
export { buildStaffContext } from "./context.js";
export type { StaffContext, StaffContextInput, StaffSubject } from "./context.js";
export {
  assertAccess,
  assertPermission,
  authorize,
  decideAccess,
  hasPermission,
  satisfiesLevel,
} from "./decide.js";
export type {
  AccessDecision,
  AccessRequirement,
  AuthorizeOptions,
  ModuleNeed,
  ModuleRequirement,
  RoutePermission,
} from "./decide.js";
export {
  assertStepUp,
  isStepUpFresh,
  requiresStepUp,
  STEP_UP_TTL_MS,
  stepUpValidUntil,
} from "./step-up.js";
export { assertConfirm } from "./confirm.js";
export type { ConfirmValue } from "./confirm.js";
export {
  assertIssuedScope,
  effectiveDataScope,
  ownTaskScope,
  poolsGrantedBy,
  scopeCovers,
  scopeOf,
  scopeSnapshot,
  SYSTEM_SCOPE,
} from "./data-scope.js";
export type { AllScope, DataScope, DataScopeSnapshot, StaffScope } from "./data-scope.js";
export { byEntity, byStore, entityScope, managedStore, storeScope, taskScope } from "./scope.js";
export type { StaffCol, TaskScopeSpec } from "./scope.js";
// W1-04 商家侧授权：能力点判定、门店与主体的数据范围（./merchant）
export * from "./merchant/index.js";
