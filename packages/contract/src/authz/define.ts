// 权限点与能力点的声明形态（约定 C55、C56、C66；登记文档 docs/api/registry-permissions.md）。
// 这里只登记“有哪些键、默认给谁”。哪条接口用哪个键、处理器内判定、驳回豁免再验证都在路由一侧（W0-10）。
// 纯常量：本文件只引类型，不引任何包。
import type { EnumValue } from "../enums/define.js";
import type { STAFF_ROLE_KEY } from "../enums/staff.js";

/** 后台角色键（staff_role.key） */
export type StaffRoleKey = EnumValue<typeof STAFF_ROLE_KEY>;

/** 默认授予里的一个角色。leadOnly：仅主管（登记文档里角色名后的 *） */
export interface RoleGrant {
  readonly role: Exclude<StaffRoleKey, "super_admin">;
  readonly leadOnly: boolean;
}

/**
 * 权限点的默认授予。超级管理员拥有全部，不在任何一种里逐个写。
 *   roles             默认给这几个角色（staff_role.actions 的播种值：{ on: true, leadOnly }）
 *   super_admin_only  其他角色默认都不开
 *   module_viewers    有该模块查看权的角色默认开（各模块的导出）
 *   all_staff         全体员工，是标记，不进角色配置（本人自助的操作）
 *   undecided         还没定（V1.1 的键，登记文档写“见原型”）
 */
export type PermissionGrant =
  | { readonly kind: "roles"; readonly roles: readonly RoleGrant[] }
  | { readonly kind: "super_admin_only" }
  | { readonly kind: "module_viewers" }
  | { readonly kind: "all_staff" }
  | { readonly kind: "undecided" };

/** 登记文档 第 1 节的小节：11 个模块，另有“各模块导出”与“V1.1 的键” */
export const PERMISSION_SECTIONS = [
  { key: "merchant", title: "商家管理" },
  { key: "order", title: "订单管理" },
  { key: "delivery", title: "交付管理" },
  { key: "publish", title: "发布管理" },
  { key: "service", title: "客服工单" },
  { key: "drama", title: "短剧库管理" },
  { key: "billing", title: "套餐与积分" },
  { key: "finance", title: "财务管理" },
  { key: "report", title: "数据报表" },
  { key: "ops", title: "运营管理" },
  { key: "system", title: "系统设置" },
  { key: "export", title: "各模块导出" },
  { key: "v1_1", title: "V1.1 的键" },
] as const;
export type PermissionSection = (typeof PERMISSION_SECTIONS)[number]["key"];

/** 待分配池：持有该键且是主管的员工，能看到负责人为空的对应资源 */
export const UNASSIGNED_POOLS = [
  "store_manager",
  "ticket_editor",
  "ticket_publisher",
  "ad_editor",
  "service_ticket",
] as const;
export type UnassignedPool = (typeof UNASSIGNED_POOLS)[number];

/** 起始版本。v1.1 的键 V1.0 不挂载 */
export const PERMISSION_SINCE = ["v1.0", "v1.1"] as const;
export type PermissionSince = (typeof PERMISSION_SINCE)[number];

/** 一个后台权限点 */
export interface PermissionDef<K extends string = string> {
  /** 键，即路由的 x-permission 与 staff_role.actions 的键 */
  readonly key: K;
  /** 名称，照登记文档 */
  readonly name: string;
  /** 登记在哪个小节 */
  readonly section: PermissionSection;
  readonly grant: PermissionGrant;
  /** 再验证：true 要（10 分钟窗口，超出返回 STEP_UP_REQUIRED）；false 不要；null 还没定（V1.1） */
  readonly stepUp: boolean | null;
  readonly pool: UnassignedPool | null;
  readonly since: PermissionSince;
}

/** 权限点键的写法：小写点分 2–4 段；V1.1 的占位键 partner.* 以 .* 结尾 */
export const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$|^[a-z]+\.\*$/;

/** 一个小节的权限点 */
export interface PermissionGroup<K extends string = string> {
  readonly section: PermissionSection;
  readonly permissions: readonly PermissionDef<K>[];
}

type Draft<K extends string> = Omit<PermissionDef<K>, "section">;

/** 一个小节一个文件，各调一次 */
export function definePermissions<const K extends string>(
  section: PermissionSection,
  permissions: readonly Draft<K>[],
): PermissionGroup<K> {
  return { section, permissions: permissions.map((item) => ({ ...item, section })) };
}

/** 一个权限点：键、名称、默认授予；再验证、待分配池、起始版本不写即 false、null、v1.0 */
export function permission<const K extends string>(
  key: K,
  name: string,
  grant: PermissionGrant,
  options: { stepUp?: boolean | null; pool?: UnassignedPool; since?: PermissionSince } = {},
): Draft<K> {
  return {
    key,
    name,
    grant,
    stepUp: options.stepUp === undefined ? false : options.stepUp,
    pool: options.pool ?? null,
    since: options.since ?? "v1.0",
  };
}

/** 默认给这几个角色；仅主管的写 lead("角色键") */
export function roles(...granted: (RoleGrant["role"] | RoleGrant)[]): PermissionGrant {
  return {
    kind: "roles",
    roles: granted.map((item) =>
      typeof item === "string" ? { role: item, leadOnly: false } : item,
    ),
  };
}
/** 仅主管 */
export const lead = (role: RoleGrant["role"]): RoleGrant => ({ role, leadOnly: true });
export const SUPER_ADMIN_ONLY: PermissionGrant = { kind: "super_admin_only" };
export const MODULE_VIEWERS: PermissionGrant = { kind: "module_viewers" };
export const ALL_STAFF: PermissionGrant = { kind: "all_staff" };
export const UNDECIDED: PermissionGrant = { kind: "undecided" };

/** 能不能：allowed 为假即不能；limit 是“能，但有限定”的限定（登记文档括号里的原文） */
export interface CapabilityAccess {
  readonly allowed: boolean;
  readonly limit: string | null;
}

/** 一个商家端能力点：只回答“这个角色在这种门店状态下能不能做这类事” */
export interface CapabilityDef<K extends string = string> {
  /** 键，即路由的 x-capability。以 .* 结尾的是单个组键，不是通配符（裁决 A128） */
  readonly key: K;
  /** 含义，照登记文档 */
  readonly name: string;
  /** 老板 */
  readonly owner: CapabilityAccess;
  /** 店员。不能的，路由的店员视图是 none，直接 403 ROLE_FORBIDDEN */
  readonly clerk: CapabilityAccess;
  /** 已停用门店的老板 */
  readonly archivedOwner: CapabilityAccess;
}

export const YES: CapabilityAccess = { allowed: true, limit: null };
export const NO: CapabilityAccess = { allowed: false, limit: null };
/** 能，但有限定 */
export const limited = (limit: string): CapabilityAccess => ({ allowed: true, limit });

/** 一个能力点：键、含义、店员、已停用门店的老板；老板不写即能 */
export function capability<const K extends string>(
  key: K,
  name: string,
  clerk: CapabilityAccess,
  archivedOwner: CapabilityAccess,
  owner: CapabilityAccess = YES,
): CapabilityDef<K> {
  return { key, name, owner, clerk, archivedOwner };
}

/** 能力点键的写法：小写点分 2–3 段，或“组.*” */
export const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$|^[a-z]+\.\*$/;
