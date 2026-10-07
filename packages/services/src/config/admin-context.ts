import type {
  AuditAction,
  AuditCategory,
  AuditTargetType,
  AuditMetaFields,
  StaffBrief,
} from "@liyoxi/contract";
import type { Assembly, Clock, IdentityContext, Tx, TxRunner } from "../kernel/index.js";
import type { StaffContext } from "../authz/index.js";
import { assertAccess } from "../authz/index.js";
import { AppError } from "../kernel/index.js";
import { record } from "../audit/index.js";
import type { AuditRequestMeta } from "../audit/index.js";
import type { ConfigCache } from "./cache.js";

export interface ConfigAdminDeps {
  readonly tx: TxRunner;
  readonly clock: Clock;
  readonly assembly: Assembly;
  readonly config: { readonly cache: Pick<ConfigCache, "bump"> };
  /** 由 staff 公开服务供给；config 不读取上层私有表。 */
  readonly staffBriefs: (tx: Tx, ids: readonly string[]) => Promise<StaffBrief[]>;
}
export interface ConfigActor {
  readonly staff: StaffContext;
  readonly identity: IdentityContext;
  readonly meta?: AuditRequestMeta;
}
export const invalid = (path: string, message: string): never => {
  throw new AppError("VALIDATION_FAILED", { details: { fieldErrors: [{ path, message }] } });
};
export function requireConfigActor(
  ctx: ConfigActor,
  permission: "sys.dict.edit" | "sys.param.edit" | "sys.super_admin" | "flow.checklist.manage",
) {
  assertAccess(ctx.staff, { module: null, permission });
  if (ctx.identity.actor.type !== "staff" || ctx.identity.actor.id !== ctx.staff.staff.id)
    throw new AppError("PERMISSION_DENIED");
  return ctx.staff.staff.id;
}
export async function auditConfig(
  tx: Tx,
  ctx: ConfigActor,
  category: AuditCategory,
  action: AuditAction,
  target: { type: AuditTargetType; id: string },
  before: object | null,
  after: object | null,
  reason?: string,
  meta?: AuditMetaFields,
) {
  await record(
    tx,
    ctx.identity.actor,
    ctx.meta ?? {
      requestId: ctx.identity.requestId,
      ip: null,
      userAgent: null,
      authMethod: null,
      sessionId: null,
    },
    {
      stream: "ops",
      category,
      action,
      summary: action,
      target,
      before,
      after,
      ...(meta ? { meta } : {}),
      fields: [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])],
      ...(reason ? { reason: { code: "other", text: reason } } : {}),
    },
  );
}
