// 已登录的员工 → 判权用的上下文与 StaffMe（W1-01a 的第三个 PR；a01 第 2.2、2.3 节；D4 第 6.5、7.1 节）。
//   staffContextOf(principal)   会话校验的结果交给 authz 规整：模块等级、此刻生效的权限点、数据范围、再验证时刻。
//                               会话中间件每请求调一次；角色行在 5 秒缓存里是同一个对象，规整的结果按它记着。
//   buildStaffMe(deps, …)       admin.auth.me.get 与两个建会话接口的响应：上面三项加展示列、开关求值、服务器时刻。
//   staffBriefOf(staff)         员工摘要 StaffBrief，后台各域引用员工时都用它。
import type { StaffBrief, StaffMe } from "@liyoxi/contract";

import { buildStaffContext, isStaffRoleKey, normalizeRoleConfig } from "../authz/index.js";
import type { RoleConfig, StaffContext } from "../authz/index.js";
import type { Config } from "../config/index.js";
import { AppError } from "../kernel/index.js";
import type { Clock } from "../kernel/index.js";
import type { RoleRow } from "./roles.js";
import type { StaffPrincipal } from "./types.js";

const DAY_MS = 24 * 60 * 60_000;

const normalized = new WeakMap<RoleRow, RoleConfig>();

/** 规整角色行：同一个角色行对象只算一次（角色缓存 5 秒内给的是同一个对象） */
function roleConfigOf(role: RoleRow): RoleConfig {
  let config = normalized.get(role);
  if (config === undefined) {
    if (!isStaffRoleKey(role.key)) {
      throw new AppError("INTERNAL", { message: `角色 ${role.key} 不在契约的登记里` });
    }
    config = normalizeRoleConfig(role.key, role);
    normalized.set(role, config);
  }
  return config;
}

/** 这次请求的员工上下文：交给 authz 的判定函数与带数据范围的仓储 */
export function staffContextOf(principal: StaffPrincipal): StaffContext {
  const role = roleConfigOf(principal.role);
  const { staff } = principal;
  return buildStaffContext({
    staff: {
      id: staff.id,
      roleKey: role.roleKey,
      isLead: staff.isLead,
      staffGroupId: staff.staffGroupId,
    },
    role,
    groupStaffIds: principal.groupMemberIds,
    stepUpAt: principal.session.stepupAt,
  });
}

type BriefSource = Pick<
  StaffPrincipal["staff"],
  "id" | "staffNo" | "name" | "staffRoleKey" | "isLead" | "status"
>;

/** 员工摘要（a01 第 2.2 节） */
export function staffBriefOf(staff: BriefSource): StaffBrief {
  return {
    staffId: staff.id,
    staffNo: staff.staffNo,
    name: staff.name,
    roleKey: staff.staffRoleKey as StaffBrief["roleKey"],
    isLead: staff.isLead,
    status: staff.status as StaffBrief["status"],
  };
}

export interface StaffMeDeps {
  /** 开关求值与参数：进程运行时的 config */
  readonly config: Pick<Config, "flags" | "params">;
  readonly clock: Clock;
}

/** 当前员工（a01 第 2.3 节）。ctx 不给就现算；会话中间件已经算过的传进来 */
export async function buildStaffMe(
  deps: StaffMeDeps,
  principal: StaffPrincipal,
  ctx: StaffContext = staffContextOf(principal),
): Promise<StaffMe> {
  const { staff, session, group } = principal;
  const now = deps.clock.now();
  const [flags, maxAgeDays] = await Promise.all([
    deps.config.flags.forClient({ platform: "admin" }),
    deps.config.params.get("admin.password_max_age_days"),
  ]);
  const passwordAgeMs =
    staff.passwordChangedAt === null ? 0 : now.getTime() - staff.passwordChangedAt.getTime();
  return {
    staff: staffBriefOf(staff),
    displayName: staff.displayName,
    phoneMask: staff.phoneMask,
    roleName: principal.role.name,
    staffGroup: group === null ? null : { staffGroupId: group.id, name: group.name },
    moduleLevels: { ...ctx.moduleLevels },
    permissions: [...ctx.permissions].sort(),
    dataScope: ctx.dataScope,
    wecomBindStatus: staff.wecomBindStatus as StaffMe["wecomBindStatus"],
    mustChangePassword: maxAgeDays > 0 && passwordAgeMs > maxAgeDays * DAY_MS,
    recoveryCodesLeft: staff.recoveryCodesLeft,
    session: {
      staffSessionId: session.id,
      authMethod: session.authMethod as StaffMe["session"]["authMethod"],
      idleExpiresAt: session.idleExpiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      stepUpValidUntil: session.stepUpValidUntil.toISOString(),
    },
    flags: { ...flags },
    serverTime: now.toISOString(),
  };
}
