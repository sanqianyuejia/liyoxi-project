import { recordAuthEvent } from "../audit/index.js";
import type { Clock, TxRunner } from "../kernel/index.js";
import type { ProviderLogger } from "../providers/types.js";
/** 认证前没有可信账号身份，subjectId 必须为空；不更新账号锁定/会话。 */
export async function recordOffnetDenied(
  deps: { readonly tx: TxRunner; readonly clock: Clock; readonly logger: ProviderLogger },
  input: {
    readonly ip: string | null;
    readonly userAgent?: string | null;
    readonly requestId: string;
  },
): Promise<void> {
  try {
    await deps.tx.run((tx) =>
      recordAuthEvent(tx, {
        space: "staff",
        subjectId: null,
        event: "offnet_denied",
        ip: input.ip,
        userAgent: input.userAgent ?? null,
        at: deps.clock.now(),
        detail: { requestId: input.requestId, reason: "admin_ip_allowlist" },
      }),
    );
  } catch {
    deps.logger.error(
      { evt: "security.offnet_audit_failed", requestId: input.requestId },
      "来源白名单拒绝的独立安全事实写入失败",
    );
  }
}
