import type { Context } from "hono";
import { isAppError } from "@liyoxi/services";
import { z } from "@liyoxi/contract";
import { ValidationFailure } from "../../http/errors.js";
import type { Runtime } from "@liyoxi/services";
import type { ApiEnv } from "../../context.js";
import type { AdminStaff } from "../../routing/admin.js";
export function configActor(
  c: Context<ApiEnv>,
  staff: AdminStaff,
): Parameters<Runtime["configAdmin"]["createDictItem"]>[0] {
  const identity = c.var.identity;
  if (!identity) throw new Error("配置写入缺少身份上下文");
  return {
    staff: staff.ctx,
    identity,
    meta: {
      requestId: identity.requestId,
      ip: identity.ip,
      userAgent: identity.userAgent,
      authMethod:
        staff.principal.session.authMethod === "password+recovery"
          ? "password+recovery"
          : staff.principal.session.authMethod === "password+totp"
            ? "password+totp"
            : null,
      sessionId: staff.principal.session.id,
    },
  };
}

export function configError(error: unknown): never {
  if (isAppError(error) && error.error === "VALIDATION_FAILED") {
    const result = z
      .object({ fieldErrors: z.array(z.object({ path: z.string(), message: z.string() })) })
      .safeParse(error.details);
    if (result.success) throw new ValidationFailure(result.data.fieldErrors);
  }
  throw error;
}
