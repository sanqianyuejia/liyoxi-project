// @liyoxi/contract/authz：后台模块键、权限点与商家端能力点，纯常量子路径。
// 本入口可达的文件不得 import zod、@hono/zod-openapi、hono。
// 权限点一个小节一个文件（permissions/），汇总是自动收集的，不手抄。
// 对账：pnpm api-registries:check（与 docs/api/registry-permissions.md 第 1、2 节 0 差异）。
import type { PermissionDef, PermissionGroup } from "./define.js";
import { PERMISSION_GROUPS } from "./permissions/index.js";

// 声明用的构造函数（permission、capability 之类）只给登记文件用，不从入口给出
export {
  CAPABILITY_KEY_PATTERN,
  PERMISSION_KEY_PATTERN,
  PERMISSION_SECTIONS,
  PERMISSION_SINCE,
  UNASSIGNED_POOLS,
} from "./define.js";
export type {
  CapabilityAccess,
  CapabilityDef,
  PermissionDef,
  PermissionGrant,
  PermissionGroup,
  PermissionSection,
  PermissionSince,
  RoleGrant,
  StaffRoleKey,
  UnassignedPool,
} from "./define.js";
export * from "./modules.js";
export * from "./capabilities.js";
export { PERMISSION_GROUPS } from "./permissions/index.js";

/** 逐个文件取键再并起来 */
type KeyOf<G> = G extends PermissionGroup<infer K> ? K : never;

/** 后台权限点的键，含 V1.1 的 */
export type PermissionKey = KeyOf<(typeof PERMISSION_GROUPS)[number]>;

/** 全部后台权限点，顺序同登记文档 */
export const PERMISSIONS = PERMISSION_GROUPS.flatMap(
  (group: PermissionGroup) => group.permissions,
) as readonly PermissionDef<PermissionKey>[];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((item) => item.key);

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** 按键找登记项 */
export function permissionByKey(key: string): PermissionDef<PermissionKey> | undefined {
  return PERMISSIONS.find((item) => item.key === key);
}

/** 标了再验证的权限点 */
export const STEP_UP_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.filter(
  (item) => item.stepUp === true,
).map((item) => item.key);
