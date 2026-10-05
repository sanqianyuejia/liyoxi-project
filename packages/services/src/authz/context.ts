// 员工上下文（W1-01a）：一次请求里“这名员工能做什么、能看到谁的数据”的全部答案。
// 由加载方（staff 模块：会话校验、角色与本组成员的读取与缓存）每请求建一次，往下传给判定函数与仓储。
// authz 自己不读库：员工行、角色行、本组成员都由调用方给（authz 在 L0，员工表在 L1）。
import type {
  PermissionKey,
  RoleDataScope,
  RoleModuleLevels,
  StaffRoleKey,
} from "@liyoxi/contract/authz";

import { effectiveDataScope, scopeOf } from "./data-scope.js";
import type { DataScope } from "./data-scope.js";
import { effectivePermissions } from "./role-config.js";
import type { RoleConfig } from "./role-config.js";

/** 判定要用到的员工行的几列 */
export interface StaffSubject {
  readonly id: string;
  readonly roleKey: StaffRoleKey;
  readonly isLead: boolean;
  readonly staffGroupId: string | null;
}

export interface StaffContextInput {
  staff: StaffSubject;
  /** normalizeRoleConfig 的结果，角色须与员工的一致 */
  role: RoleConfig;
  /** 本组成员的 id；没有分组给空数组 */
  groupStaffIds: readonly string[];
  /** 会话的 stepup_at（最近一次第二因子验证）；不经会话的场合（代员工执行的任务）给 null */
  stepUpAt: Date | null;
}

export interface StaffContext {
  readonly staff: StaffSubject;
  /** 13 个模块的等级 */
  readonly moduleLevels: RoleModuleLevels;
  /** 此刻生效的权限点（a01 第 2.3 节 permissions） */
  readonly permissions: ReadonlySet<PermissionKey>;
  /** 生效的数据范围的名字：own、group、all（a01 第 2.3 节 dataScope） */
  readonly dataScope: RoleDataScope;
  /** 交给仓储的数据范围 */
  readonly scope: DataScope;
  readonly stepUpAt: Date | null;
}

/** 建员工上下文。纯函数：同样的输入同样的结果 */
export function buildStaffContext(input: StaffContextInput): StaffContext {
  const { staff, role, groupStaffIds, stepUpAt } = input;
  if (role.roleKey !== staff.roleKey) {
    throw new TypeError(`角色配置是 ${role.roleKey} 的，员工的角色是 ${staff.roleKey}`);
  }
  const permissions = effectivePermissions(role, staff.isLead);
  return Object.freeze({
    staff: Object.freeze({ ...staff }),
    moduleLevels: role.moduleLevels,
    permissions,
    dataScope: effectiveDataScope(role.dataScope, staff.isLead),
    scope: scopeOf(staff, role, groupStaffIds, permissions),
    stepUpAt,
  });
}
