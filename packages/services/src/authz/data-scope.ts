// 数据范围（W1-01a）：DataScope 的类型与唯一的产生处 scopeOf。
// 依据：D4 第 7.3 节“有效范围”；03 第 4.2 节；a01 第 2.3 节 dataScope 一行。
// “本人”“本组”都折算成一个负责人 id 集合，外加主管才有的待分配池；每种资源只需回答“它的负责人是谁”。
// DataScope 带品牌：本文件之外写不出一个对象字面量当它用；谓词另在运行时核对它确是这里给出的（防 as 与反序列化）。
import { permissionByKey } from "@liyoxi/contract/authz";
import type { PermissionKey, RoleDataScope, UnassignedPool } from "@liyoxi/contract/authz";

declare const DATA_SCOPE: unique symbol;
interface Branded {
  readonly [DATA_SCOPE]: true;
}

/** 全部：不按负责人过滤 */
export type AllScope = Branded & { readonly kind: "all" };
/** 负责人在集合内；unassigned 是能看到的待分配池（负责人为空的那一类资源） */
export type StaffScope = Branded & {
  readonly kind: "staff";
  readonly staffIds: readonly string[];
  readonly unassigned: ReadonlySet<UnassignedPool>;
};
export type DataScope = AllScope | StaffScope;

const issued = new WeakSet<object>();
function issue<T extends object>(value: T): T & Branded {
  issued.add(value);
  return Object.freeze(value) as T & Branded;
}

/** 核对范围确由本文件给出；不是即抛 TypeError。范围谓词入口都先过它 */
export function assertIssuedScope(scope: unknown): DataScope {
  if (typeof scope !== "object" || scope === null || !issued.has(scope)) {
    throw new TypeError(
      "数据范围只能由 authz 的 scopeOf（或 SYSTEM_SCOPE、ownTaskScope）给出，不能自己拼",
    );
  }
  return scope as DataScope;
}

const ALL_SCOPE: AllScope = issue({ kind: "all" as const });
const NO_POOLS: ReadonlySet<UnassignedPool> = new Set();

function staffScope(staffIds: readonly string[], pools: ReadonlySet<UnassignedPool>): StaffScope {
  return issue({
    kind: "staff" as const,
    staffIds: Object.freeze([...new Set(staffIds)]),
    unassigned: new Set(pools) as ReadonlySet<UnassignedPool>,
  });
}

/**
 * 系统任务（定时器、订阅者、周期任务）显式用它。代某个员工执行的任务（导出）不用它，
 * 按那名员工此刻的状态重建上下文（D4 第 7.3 节“统一注入方式”第 2 点）。
 */
export const SYSTEM_SCOPE: DataScope = ALL_SCOPE;

/** 生效的数据范围：角色范围与主管标记取较大者，主管只放大不缩小（a01 第 2.3 节） */
export function effectiveDataScope(roleScope: RoleDataScope, isLead: boolean): RoleDataScope {
  if (roleScope === "all") return "all";
  return roleScope === "group" || isLead ? "group" : "own";
}

/** 这些权限点带来哪几个待分配池（注册表里声明了 pool 的键） */
export function poolsGrantedBy(
  permissions: ReadonlySet<PermissionKey>,
): ReadonlySet<UnassignedPool> {
  const pools = new Set<UnassignedPool>();
  for (const key of permissions) {
    const pool = permissionByKey(key)?.pool;
    if (pool != null) pools.add(pool);
  }
  return pools;
}

/**
 * 数据范围的唯一产生处。
 *   groupStaffIds  本组成员的 id（含不含本人都行；没有分组给空数组）
 *   permissions    这名员工此刻生效的权限点（effectivePermissions 的结果）
 * 待分配池只给主管，按他持有的分配类权限点定；非主管一个池都没有。
 */
export function scopeOf(
  staff: { readonly id: string; readonly isLead: boolean },
  role: { readonly dataScope: RoleDataScope },
  groupStaffIds: readonly string[],
  permissions: ReadonlySet<PermissionKey>,
): DataScope {
  const effective = effectiveDataScope(role.dataScope, staff.isLead);
  if (effective === "all") return ALL_SCOPE;
  const pools = staff.isLead ? poolsGrantedBy(permissions) : NO_POOLS;
  return staffScope(effective === "group" ? [staff.id, ...groupStaffIds] : [staff.id], pools);
}

/**
 * 只含本人、不带待分配池的范围。模块等级是“本人任务”（o）时，写操作用它取资源：
 * 负责人列必须是本人（D4 第 7.3 节“统一注入方式”第 4 点）。
 */
export function ownTaskScope(staff: { readonly id: string }): DataScope {
  return staffScope([staff.id], NO_POOLS);
}

/**
 * 内存里的同一个判断：负责人是 ownerId 的资源在不在范围内。负责人为空时看有没有对应的池。
 * 指派时核对“被指派的人在操作人的范围内”也用它。
 */
export function scopeCovers(
  scope: DataScope,
  ownerId: string | null,
  pool?: UnassignedPool,
): boolean {
  assertIssuedScope(scope);
  if (scope.kind === "all") return true;
  if (ownerId === null) return pool !== undefined && scope.unassigned.has(pool);
  return scope.staffIds.includes(ownerId);
}

/** 可以进 JSON 的样子：审计、导出任务的范围快照用（14 分组 第 4.10 节）。只作记录，不能再变回 DataScope */
export type DataScopeSnapshot =
  { kind: "all" } | { kind: "staff"; staffIds: string[]; unassigned: UnassignedPool[] };

export function scopeSnapshot(scope: DataScope): DataScopeSnapshot {
  assertIssuedScope(scope);
  return scope.kind === "all"
    ? { kind: "all" }
    : { kind: "staff", staffIds: [...scope.staffIds], unassigned: [...scope.unassigned].sort() };
}
