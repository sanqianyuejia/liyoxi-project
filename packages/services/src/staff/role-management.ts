// W2-04：角色配置用例，复用既有矩阵；写配置与审计同事务，提交后清掉本进程缓存。
import { defaultRoleActions, PERMISSIONS, staffRoleDefault } from "@liyoxi/contract/authz";
import type { RoleConfigView, RoleDetail, RoleReplaceBody } from "@liyoxi/contract";
import { RoleReplaceBodySchema } from "@liyoxi/contract";
import type { Prisma } from "@liyoxi/db";
import { record } from "../audit/index.js";
import type { AuditRequestMeta } from "../audit/index.js";
import {
  assertAccess,
  assertPermission,
  isStaffRoleKey,
  normalizeRoleConfig,
  scopeCovers,
} from "../authz/index.js";
import type { StaffContext } from "../authz/index.js";
import { AppError } from "../kernel/index.js";
import type { Actor, Clock, TxRunner, TxRunOptions } from "../kernel/index.js";
import { staffBriefOf } from "./me.js";
import type { RoleCache, StaffDb } from "./roles.js";

export interface RoleManagementDeps {
  db: StaffDb;
  tx: TxRunner;
  clock: Clock;
  roles: Pick<RoleCache, "invalidate">;
}

export function roleDefaults(key: string): RoleConfigView {
  if (!isStaffRoleKey(key)) throw new AppError("NOT_FOUND");
  const base = staffRoleDefault(key)!;
  return {
    roleKey: key,
    moduleLevels: base.moduleLevels,
    actions: defaultRoleActions(key),
    dataScope: base.dataScope,
  };
}

function checkedConfig(key: string, input: RoleReplaceBody): RoleConfigView {
  const base = roleDefaults(key);
  if (!RoleReplaceBodySchema.safeParse(input).success) throw new AppError("VALIDATION_FAILED");
  const normalized = normalizeRoleConfig(base.roleKey, input);
  const invalidLead = Object.entries(input.actions).some(([key, value]) => {
    const permission = PERMISSIONS.find((entry) => entry.key === key);
    return (
      value.leadOnly &&
      !(
        permission?.grant.kind === "roles" && permission.grant.roles.some((grant) => grant.leadOnly)
      )
    );
  });
  if (normalized.issues.length > 0 || invalidLead) throw new AppError("VALIDATION_FAILED");
  return {
    roleKey: base.roleKey,
    moduleLevels: normalized.moduleLevels,
    actions: normalized.actions,
    dataScope: normalized.dataScope,
  };
}

async function detail(db: StaffDb, ctx: StaffContext, key: string): Promise<RoleDetail> {
  const defaults = roleDefaults(key);
  const row = await db.staffRole.findUnique({ where: { key } });
  if (row === null) throw new AppError("NOT_FOUND");
  const members = await db.staff.findMany({
    where: {
      staffRoleKey: key,
      status: "active",
      ...(ctx.scope.kind === "all" ? {} : { id: { in: [...ctx.scope.staffIds] } }),
    },
    orderBy: [{ staffNo: "asc" }, { id: "asc" }],
  });
  const updatedBy =
    row.updatedByStaffId === null
      ? null
      : await db.staff.findUnique({ where: { id: row.updatedByStaffId } });
  const current = normalizeRoleConfig(defaults.roleKey, row);
  const same =
    current.dataScope === defaults.dataScope &&
    Object.entries(defaults.moduleLevels).every(
      ([key, value]) => current.moduleLevels[key as keyof typeof current.moduleLevels] === value,
    ) &&
    Object.keys(current.actions).length === Object.keys(defaults.actions).length &&
    Object.entries(defaults.actions).every(([key, value]) => {
      const actual = current.actions[key as keyof typeof current.actions];
      return actual?.on === value.on && actual.leadOnly === value.leadOnly;
    });
  return {
    ...defaults,
    moduleLevels: current.moduleLevels,
    actions: current.actions,
    dataScope: current.dataScope,
    name: row.name,
    description: row.description,
    isLocked: row.isLocked,
    availableFrom: row.availableFrom as RoleDetail["availableFrom"],
    members: members.map(staffBriefOf),
    memberCount: members.length,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy:
      updatedBy === null || !scopeCovers(ctx.scope, updatedBy.id) ? null : staffBriefOf(updatedBy),
    lockVersion: row.lockVersion,
    isDefault: same,
  };
}

export function createRoleManagement(deps: RoleManagementDeps) {
  return {
    get(ctx: StaffContext, key: string) {
      assertAccess(ctx, { module: { module: "system", need: "view" }, permission: null });
      return detail(deps.db, ctx, key);
    },
    defaults(ctx: StaffContext, key: string) {
      assertAccess(ctx, { module: { module: "system", need: "view" }, permission: null });
      return roleDefaults(key);
    },
    async replace(
      ctx: StaffContext,
      actor: Actor,
      meta: AuditRequestMeta,
      key: string,
      input: RoleReplaceBody,
      options: TxRunOptions = {},
    ): Promise<RoleDetail> {
      assertPermission(ctx, "sys.role.edit", deps.clock.now());
      const config = checkedConfig(key, input);
      const result = await deps.tx.run(async (tx) => {
        const before = await tx.staffRole.findUnique({ where: { key } });
        if (before === null) throw new AppError("NOT_FOUND");
        if (before.isLocked || key === "super_admin") throw new AppError("ROLE_LOCKED");
        const now = deps.clock.now();
        const written = await tx.staffRole.updateMany({
          where: { key, lockVersion: input.lockVersion, isLocked: false },
          data: {
            moduleLevels: config.moduleLevels as Prisma.InputJsonObject,
            actions: config.actions as Prisma.InputJsonObject,
            dataScope: config.dataScope,
            lockVersion: { increment: 1 },
            updatedByStaffId: ctx.staff.id,
            updatedAt: now,
          },
        });
        if (written.count !== 1) {
          const latest = await tx.staffRole.findUniqueOrThrow({
            where: { key },
            select: { lockVersion: true },
          });
          throw new AppError("VERSION_CONFLICT", { details: { lockVersion: latest.lockVersion } });
        }
        await record(tx, actor, meta, {
          stream: "ops",
          category: "staff_authz",
          action: "sys.role.edit",
          summary: `保存${before.name}角色权限`,
          target: { type: "staff_role", id: key, label: before.name },
          before,
          after: config,
          fields: ["moduleLevels", "actions", "dataScope"],
        });
        return detail(tx, ctx, key);
      }, options);
      deps.roles.invalidate();
      return result;
    },
  };
}
