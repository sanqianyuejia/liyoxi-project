import {
  ChecklistTemplateViewSchema,
  FeatureFlagViewSchema,
  FeatureFlagListSchema,
  flagByKey,
  FlagRulesSchema,
  isFlagValueOfType,
  MaintenanceNoticeSchema,
} from "@liyoxi/contract";
import type {
  ChecklistTemplateCreateBodySchema,
  FeatureFlagUpdateBodySchema,
  z,
} from "@liyoxi/contract";
import type { Prisma } from "@liyoxi/db";
import { AppError, uuidv7 } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { hasPermission } from "../authz/index.js";
import { parseVersion } from "./version.js";
import { auditConfig, invalid, requireConfigActor } from "./admin-context.js";
import type { ConfigActor, ConfigAdminDeps } from "./admin-context.js";

export function createAdminVersions(deps: ConfigAdminDeps) {
  async function flagView(tx: Tx, row: Prisma.FeatureFlagGetPayload<object>) {
    const staff = row.updatedByStaffId ? await deps.staffBriefs(tx, [row.updatedByStaffId]) : [];
    return FeatureFlagViewSchema.parse({
      flagKey: row.key,
      valueType: row.valueType,
      defaultValue: row.defaultValue,
      rules: row.rules,
      exposedTo: row.exposedTo,
      description: row.description,
      options: null,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: staff[0] ?? null,
      lockVersion: row.lockVersion,
    });
  }
  async function checklistView(
    tx: Tx,
    ctx: ConfigActor,
    row: Prisma.ChecklistTemplateGetPayload<object>,
  ) {
    const staff = row.createdByStaffId ? await deps.staffBriefs(tx, [row.createdByStaffId]) : [];
    return ChecklistTemplateViewSchema.parse({
      checklistTemplateId: row.id,
      code: row.code,
      versionNo: row.versionNo,
      status: row.status,
      items: row.items,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      retiredAt: row.retiredAt?.toISOString() ?? null,
      createdBy: staff[0] ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lockVersion: row.lockVersion,
      actions:
        row.status === "draft" && hasPermission(ctx.staff, "flow.checklist.manage")
          ? ["activate", "discard"]
          : [],
    });
  }
  const lockCode = async (tx: Tx, code: string) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`config.checklist:${code}`},0))`;
  };
  return {
    checklistView,
    async flags(tx: Tx) {
      return FeatureFlagListSchema.parse({
        items: await Promise.all(
          (await tx.featureFlag.findMany({ orderBy: { key: "asc" } }))
            .filter((row) => flagByKey(row.key))
            .map((row) => flagView(tx, row)),
        ),
      });
    },
    async updateFlag(
      tx: Tx,
      ctx: ConfigActor,
      key: string,
      input: z.infer<typeof FeatureFlagUpdateBodySchema>,
    ) {
      const staffId = requireConfigActor(ctx, "sys.super_admin");
      const def = flagByKey(key);
      if (!def) throw new AppError("NOT_FOUND");
      await tx.$queryRaw`SELECT key FROM feature_flag WHERE key=${key} FOR UPDATE`;
      const before = await tx.featureFlag.findUnique({ where: { key } });
      if (!before) throw new AppError("NOT_FOUND");
      if (before.lockVersion !== input.lockVersion) throw new AppError("VERSION_CONFLICT");
      const value = input.defaultValue === undefined ? before.defaultValue : input.defaultValue;
      const rules = FlagRulesSchema.parse(input.rules ?? before.rules);
      for (const [path, val] of [
        ["defaultValue", value],
        ...rules.map((rule, index) => [`rules.${index}.value`, rule.value]),
      ] as const) {
        if (!isFlagValueOfType(def.valueType, val)) invalid(path as string, "值类型不符");
        if (key === "client.min_version" && !(typeof val === "string" && parseVersion(val)))
          invalid(path as string, "须为三段版本号");
        if (
          key === "ops.maintenance_notice" &&
          val !== null &&
          !MaintenanceNoticeSchema.safeParse(val).success
        )
          invalid(path as string, "停机提示不合结构");
      }
      const now = deps.clock.now();
      await tx.$executeRaw`UPDATE feature_flag SET default_value=${JSON.stringify(value)}::jsonb,rules=${JSON.stringify(rules)}::jsonb,description=${input.description ?? before.description},lock_version=lock_version+1,updated_by_staff_id=${staffId}::uuid,updated_at=${now} WHERE key=${key}`;
      const after = await tx.featureFlag.findUniqueOrThrow({ where: { key } });
      await auditConfig(
        tx,
        ctx,
        "param",
        "sys.flag.update",
        { type: "feature_flag", id: key },
        before,
        after,
      );
      return flagView(tx, after);
    },
    async createChecklist(
      tx: Tx,
      ctx: ConfigActor,
      input: z.infer<typeof ChecklistTemplateCreateBodySchema>,
    ) {
      const staffId = requireConfigActor(ctx, "flow.checklist.manage");
      await lockCode(tx, input.code);
      const latest = await tx.checklistTemplate.findFirst({
        where: { code: input.code },
        orderBy: { versionNo: "desc" },
      });
      const now = deps.clock.now();
      const row = await tx.checklistTemplate.create({
        data: {
          id: uuidv7(),
          code: input.code,
          versionNo: (latest?.versionNo ?? 0) + 1,
          items: input.items,
          status: "draft",
          createdByStaffId: staffId,
          createdAt: now,
          updatedAt: now,
        },
      });
      await auditConfig(
        tx,
        ctx,
        "param",
        "flow.checklist.create",
        { type: "checklist_template", id: row.id },
        null,
        row,
      );
      return checklistView(tx, ctx, row);
    },
    async changeChecklist(tx: Tx, ctx: ConfigActor, id: string, activate: boolean) {
      requireConfigActor(ctx, "flow.checklist.manage");
      const first = await tx.checklistTemplate.findUnique({ where: { id } });
      if (!first) throw new AppError("NOT_FOUND");
      await lockCode(tx, first.code);
      const before = await tx.checklistTemplate.findUniqueOrThrow({ where: { id } });
      if (before.status !== "draft") throw new AppError("STATE_NOT_ALLOWED");
      const now = deps.clock.now();
      if (activate)
        await tx.checklistTemplate.updateMany({
          where: { code: before.code, status: "active" },
          data: {
            status: "retired",
            retiredAt: now,
            updatedAt: now,
            lockVersion: { increment: 1 },
          },
        });
      const row = await tx.checklistTemplate.update({
        where: { id },
        data: {
          status: activate ? "active" : "retired",
          ...(activate ? { activatedAt: now } : { retiredAt: now }),
          updatedAt: now,
          lockVersion: { increment: 1 },
        },
      });
      await auditConfig(
        tx,
        ctx,
        "param",
        activate ? "flow.checklist.activate" : "flow.checklist.discard",
        { type: "checklist_template", id },
        before,
        row,
      );
      return checklistView(tx, ctx, row);
    },
  };
}
