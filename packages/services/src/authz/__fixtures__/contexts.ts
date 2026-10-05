// authz 用例共用的造上下文的办法：角色行照种子的样子给（契约的代码默认配置），再过规整与建上下文。
import { defaultRoleActions, staffRoleDefault } from "@liyoxi/contract/authz";
import type { StaffRoleKey } from "@liyoxi/contract/authz";
import { STAFF_ROLE_KEY } from "@liyoxi/contract/enums";

import { buildStaffContext } from "../context.js";
import type { StaffContext } from "../context.js";
import { normalizeRoleConfig } from "../role-config.js";
import type { RawRoleConfig } from "../role-config.js";

export const ROLE_KEYS: readonly StaffRoleKey[] = STAFF_ROLE_KEY.values;
export const STAFF_ID = "01900000-0000-7000-8000-000000000001";

/** 种子播进 staff_role 的那一行的三列 */
export function seededRole(roleKey: StaffRoleKey): RawRoleConfig {
  const base = staffRoleDefault(roleKey);
  if (base === undefined) throw new Error(`没有这个角色：${roleKey}`);
  return {
    moduleLevels: { ...base.moduleLevels },
    actions: { ...defaultRoleActions(roleKey) },
    dataScope: base.dataScope,
  };
}

export interface ContextOptions {
  isLead?: boolean;
  /** 库里的角色行；不给即种子的样子 */
  raw?: RawRoleConfig;
  staffId?: string;
  groupStaffIds?: readonly string[];
  stepUpAt?: Date | null;
}

export function contextOf(roleKey: StaffRoleKey, options: ContextOptions = {}): StaffContext {
  const id = options.staffId ?? STAFF_ID;
  return buildStaffContext({
    staff: { id, roleKey, isLead: options.isLead ?? false, staffGroupId: null },
    role: normalizeRoleConfig(roleKey, options.raw ?? seededRole(roleKey)),
    groupStaffIds: options.groupStaffIds ?? [],
    stepUpAt: options.stepUpAt ?? null,
  });
}
