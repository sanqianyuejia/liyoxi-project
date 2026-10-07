// W2-04 只读日志：流权限在查询前判定，详情越权与缺失统一404；JSON 再按既有规则脱敏。
import type { AuditLogListQuery, AuditLogItem, AuditLogDetail } from "@liyoxi/contract";
import type { AuditLog, Prisma } from "@liyoxi/db";
import { maskIp } from "@liyoxi/shared/mask";
import { assertAccess } from "../authz/index.js";
import type { StaffContext } from "../authz/index.js";
import { AppError } from "../kernel/index.js";
import { capJson, cleanObject } from "./sanitize.js";
type ReadDb = Pick<Prisma.TransactionClient, "auditLog">;
const allowed = (ctx: StaffContext, stream: string) =>
  stream === "access"
    ? ctx.staff.roleKey === "super_admin"
    : stream === "ops" && ctx.moduleLevels.system !== "n";
function scopeWhere(ctx: StaffContext): Prisma.AuditLogWhereInput {
  // 审计自身可证明的负责人事实只有员工操作人；未知业务归属不推成全量授权。
  return ctx.scope.kind === "all"
    ? {}
    : { actorType: "staff", actorId: { in: [...ctx.scope.staffIds] } };
}
function inScope(ctx: StaffContext, row: AuditLog): boolean {
  return (
    ctx.scope.kind === "all" ||
    (row.actorType === "staff" && row.actorId !== null && ctx.scope.staffIds.includes(row.actorId))
  );
}
function link(ctx: StaffContext, row: AuditLog): AuditLogDetail["link"] {
  if (row.targetType === "staff" && row.targetId !== null)
    return {
      route: "system.staff",
      params: { staffId: row.targetId },
      label: row.targetLabel ?? "员工账号",
    };
  if (row.targetType === "staff_role" && row.targetKey !== null)
    return {
      route: "system.roles",
      params: { roleKey: row.targetKey },
      label: row.targetLabel ?? "角色权限",
    };
  if (
    ["store", "store_profile"].includes(row.targetType ?? "") &&
    row.targetId !== null &&
    ["v", "e"].includes(ctx.moduleLevels.merchant)
  )
    return {
      route: "merchant.detail",
      params: { storeId: row.targetId },
      label: row.targetLabel ?? "商家详情",
    };
  return null;
}
function item(row: AuditLog): AuditLogItem {
  return {
    auditLogId: row.id,
    logNo: row.logNo,
    createdAt: row.createdAt.toISOString(),
    stream: row.stream as AuditLogItem["stream"],
    category: row.category,
    action: row.action,
    summary: row.summary,
    actor: {
      actorType: row.actorType,
      actorId: row.actorId,
      name: row.actorName,
      role: row.actorRole,
      client: row.client,
    },
    target:
      row.targetType === null
        ? null
        : { type: row.targetType, id: row.targetId, key: row.targetKey, label: row.targetLabel },
    entityId: row.entityId,
    storeId: row.storeId,
  };
}
const json = (value: unknown) => (value === null ? null : capJson(cleanObject(value, true)));
function cursor(value: string): { at: Date; seq: bigint } {
  try {
    if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("at" in decoded) ||
      !("seq" in decoded) ||
      typeof decoded.at !== "string" ||
      typeof decoded.seq !== "string" ||
      !/^\d+$/.test(decoded.seq)
    )
      throw new Error();
    const at = new Date(decoded.at);
    if (!Number.isFinite(at.getTime())) throw new Error();
    return { at, seq: BigInt(decoded.seq) };
  } catch {
    throw new AppError("VALIDATION_FAILED");
  }
}
export function createAuditRead(db: ReadDb) {
  return {
    async list(ctx: StaffContext, query: AuditLogListQuery) {
      if (!allowed(ctx, query.stream)) throw new AppError("PERMISSION_DENIED");
      if (query.stream === "ops")
        assertAccess(ctx, { module: { module: "system", need: "view" }, permission: null });
      const where: Prisma.AuditLogWhereInput = {
        AND: [scopeWhere(ctx)],
        stream: query.stream,
        ...(query.category ? { category: { in: query.category.split(",") } } : {}),
        ...(query.actorType ? { actorType: query.actorType } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
        ...(query.targetKey ? { targetKey: query.targetKey } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.storeId ? { storeId: query.storeId } : {}),
        ...(query.q
          ? query.q.startsWith("RZ")
            ? { logNo: query.q }
            : { summary: { contains: query.q } }
          : {}),
        ...(query.createdFrom || query.createdTo
          ? {
              createdAt: {
                ...(query.createdFrom
                  ? { gte: new Date(query.createdFrom + "T00:00:00+08:00") }
                  : {}),
                ...(query.createdTo
                  ? {
                      lt: new Date(
                        new Date(query.createdTo + "T00:00:00+08:00").getTime() + 86_400_000,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
      };
      const after = query.cursor ? cursor(query.cursor) : null;
      const rows = await db.auditLog.findMany({
        where: after
          ? {
              AND: [
                where,
                {
                  OR: [
                    { createdAt: { lt: after.at } },
                    { createdAt: after.at, seq: { lt: after.seq } },
                  ],
                },
              ],
            }
          : where,
        orderBy: [{ createdAt: "desc" }, { seq: "desc" }],
        take: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const visible = rows.slice(0, query.limit);
      const last = visible.at(-1);
      return {
        items: visible.map(item),
        hasMore,
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify({ at: last.createdAt.toISOString(), seq: String(last.seq) }),
              ).toString("base64url")
            : null,
        totalApprox: Math.min(10_000, await db.auditLog.count({ where })),
      };
    },
    async get(ctx: StaffContext, id: string): Promise<AuditLogDetail> {
      const row = await db.auditLog.findUnique({ where: { id } });
      if (row === null || !allowed(ctx, row.stream) || !inScope(ctx, row))
        throw new AppError("NOT_FOUND");
      return {
        ...item(row),
        reason: row.reasonCode === null ? null : { code: row.reasonCode, text: row.reasonText },
        before: json(row.before),
        after: json(row.after),
        meta: json(row.meta),
        authMethod: row.authMethod,
        ipMask: row.ip === null ? null : maskIp(row.ip),
        requestId: row.requestId,
        jobName: row.jobName,
        onBehalfOfEntityId: row.onBehalfOfEntityId,
        link: link(ctx, row),
      };
    },
  };
}
