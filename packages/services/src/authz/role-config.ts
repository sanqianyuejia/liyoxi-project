// 角色配置的规整（W1-01a）：把 staff_role 一行里的 module_levels、actions、data_scope 变成判定用的形状。
// 依据：03 分组 第 2.1、4 节；D4 第 7.1 节；a01 第 2.3、2.9、3.35 节。纯函数，不碰库，任何输入都不抛错。
//   缺的键取代码默认值（契约的 STAFF_ROLE_DEFAULTS、defaultRoleActions）；写坏的值当作缺；
//   注册表外的键丢弃；对这个角色不适用的权限点（注册表没给它登记默认值的键）同样丢弃，不产生授权。
// 丢掉、改回默认值的地方记在 issues 里，由加载方打日志（D4 第 7.1 节“在启动日志里列出”）。
import {
  ADMIN_MODULE_KEYS,
  MODULE_LEVELS,
  OWN_TASK_MODULES,
  PERMISSIONS,
  defaultRoleActions,
  isAdminModuleKey,
  isPermissionKey,
  staffRoleDefault,
} from "@liyoxi/contract/authz";
import type {
  AdminModuleKey,
  ModuleLevel,
  PermissionKey,
  RoleActionSwitch,
  RoleDataScope,
  RoleModuleLevels,
  StaffRoleKey,
} from "@liyoxi/contract/authz";
import { STAFF_ROLE_DATA_SCOPE, STAFF_ROLE_KEY } from "@liyoxi/contract/enums";

/** staff_role 一行里可编辑的三列，库里读出来是什么就传什么（jsonb 不先过校验） */
export interface RawRoleConfig {
  moduleLevels: unknown;
  actions: unknown;
  dataScope: unknown;
}

export interface RoleConfigIssue {
  field: "moduleLevels" | "actions" | "dataScope";
  /** 哪个键；整列不是对象、数据范围取值不对时为 null */
  key: string | null;
  /** unknown_key 注册表外的键；not_applicable 对这个角色不适用的权限点；invalid_value 值写坏了，按缺键处理 */
  problem: "unknown_key" | "not_applicable" | "invalid_value";
}

/** 规整后的角色配置。只含对这个角色适用的权限点 */
export interface RoleConfig {
  readonly roleKey: StaffRoleKey;
  readonly moduleLevels: RoleModuleLevels;
  readonly actions: Readonly<Partial<Record<PermissionKey, RoleActionSwitch>>>;
  readonly dataScope: RoleDataScope;
  readonly issues: readonly RoleConfigIssue[];
}

export function isStaffRoleKey(value: unknown): value is StaffRoleKey {
  return typeof value === "string" && (STAFF_ROLE_KEY.values as readonly string[]).includes(value);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isLevel = (value: unknown): value is ModuleLevel =>
  typeof value === "string" && (MODULE_LEVELS as readonly string[]).includes(value);
const allowsOwnTask = (key: AdminModuleKey): boolean =>
  (OWN_TASK_MODULES as readonly string[]).includes(key);

const defaultActionsCache = new Map<StaffRoleKey, Readonly<Record<string, RoleActionSwitch>>>();
/** 这个角色适用的权限点与默认开关（契约按权限点登记的默认授予算出）；一个角色只算一次 */
function applicableActions(roleKey: StaffRoleKey): Readonly<Record<string, RoleActionSwitch>> {
  let found = defaultActionsCache.get(roleKey);
  if (found === undefined) {
    found = Object.freeze({ ...defaultRoleActions(roleKey) });
    defaultActionsCache.set(roleKey, found);
  }
  return found;
}

function normalizeModuleLevels(
  base: RoleModuleLevels,
  raw: unknown,
  issues: RoleConfigIssue[],
): RoleModuleLevels {
  const source = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) issues.push({ field: "moduleLevels", key: null, problem: "invalid_value" });
  const levels = {} as Record<AdminModuleKey, ModuleLevel>;
  for (const key of ADMIN_MODULE_KEYS) {
    const value = Object.hasOwn(source, key) ? source[key] : undefined;
    // “本人任务”只许出现在交付、发布（staff.I7）：写在别的模块上按写坏处理
    const valid = isLevel(value) && (value !== "o" || allowsOwnTask(key));
    if (value !== undefined && !valid) {
      issues.push({ field: "moduleLevels", key, problem: "invalid_value" });
    }
    levels[key] = valid ? value : base[key];
  }
  for (const key of Object.keys(source)) {
    if (!isAdminModuleKey(key)) issues.push({ field: "moduleLevels", key, problem: "unknown_key" });
  }
  return Object.freeze(levels);
}

function normalizeActions(
  roleKey: StaffRoleKey,
  raw: unknown,
  issues: RoleConfigIssue[],
): RoleConfig["actions"] {
  const applicable = applicableActions(roleKey);
  const source = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) issues.push({ field: "actions", key: null, problem: "invalid_value" });
  const actions: Record<string, RoleActionSwitch> = { ...applicable };
  for (const [key, value] of Object.entries(source)) {
    if (!isPermissionKey(key)) {
      issues.push({ field: "actions", key, problem: "unknown_key" });
    } else if (!Object.hasOwn(applicable, key)) {
      issues.push({ field: "actions", key, problem: "not_applicable" });
    } else if (
      isRecord(value) &&
      typeof value.on === "boolean" &&
      (value.leadOnly === undefined || typeof value.leadOnly === "boolean")
    ) {
      actions[key] = Object.freeze({ on: value.on, leadOnly: value.leadOnly === true });
    } else {
      issues.push({ field: "actions", key, problem: "invalid_value" });
    }
  }
  return Object.freeze(actions) as RoleConfig["actions"];
}

/**
 * 规整一个角色的配置。roleKey 取 staff.staff_role_key（库里有 CHECK 与外键，先用 isStaffRoleKey 收窄）；
 * raw 是 staff_role 那一行的三列。结果可以按角色缓存（D4 第 6.5 节：进程内 5 秒）。
 */
export function normalizeRoleConfig(roleKey: StaffRoleKey, raw: RawRoleConfig): RoleConfig {
  const base = staffRoleDefault(roleKey);
  if (base === undefined) throw new TypeError(`没有这个角色：${String(roleKey)}`);
  const issues: RoleConfigIssue[] = [];
  const moduleLevels = normalizeModuleLevels(base.moduleLevels, raw.moduleLevels, issues);
  const actions = normalizeActions(roleKey, raw.actions, issues);
  const scopeValid =
    typeof raw.dataScope === "string" &&
    (STAFF_ROLE_DATA_SCOPE.values as readonly string[]).includes(raw.dataScope);
  if (!scopeValid) issues.push({ field: "dataScope", key: null, problem: "invalid_value" });
  const dataScope = scopeValid ? (raw.dataScope as RoleDataScope) : base.dataScope;
  return Object.freeze({
    roleKey,
    moduleLevels,
    actions,
    dataScope,
    issues: Object.freeze(issues),
  });
}

/** V1.0 的全部权限点：超级管理员拥有它们（D4 第 7.1 节）。V1.1 的键 V1.0 不挂载，谁都不持有 */
export const V1_PERMISSION_KEYS: readonly PermissionKey[] = Object.freeze(
  PERMISSIONS.filter((item) => item.since === "v1.0").map((item) => item.key),
);
/** 对全体员工生效的标记（本人自助的操作，如 self.mfa.reset）：不进角色配置，人人持有 */
const ALL_STAFF_KEYS: readonly PermissionKey[] = PERMISSIONS.filter(
  (item) => item.since === "v1.0" && item.grant.kind === "all_staff",
).map((item) => item.key);
const SUPER_ADMIN_PERMISSIONS: ReadonlySet<PermissionKey> = new Set(V1_PERMISSION_KEYS);

/**
 * 这名员工此刻生效的权限点：角色里开着的键，带“仅主管”的只在他是主管时计入；
 * 超级管理员是 V1.0 的全部键，不看库里的 actions（a01 第 2.3 节 permissions 一行）。
 */
export function effectivePermissions(
  config: RoleConfig,
  isLead: boolean,
): ReadonlySet<PermissionKey> {
  if (config.roleKey === "super_admin") return SUPER_ADMIN_PERMISSIONS;
  const held = new Set<PermissionKey>(ALL_STAFF_KEYS);
  for (const [key, value] of Object.entries(config.actions) as [
    PermissionKey,
    RoleActionSwitch,
  ][]) {
    if (value.on && (!value.leadOnly || isLead)) held.add(key);
  }
  return held;
}
