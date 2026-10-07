import type { components, operations } from "@liyoxi/contract/types/admin";
import type { AppServices } from "../../../app/services";
import { readFailure } from "../../../lib/api-errors";
export type AuditQuery = NonNullable<operations["admin.auditLog.list"]["parameters"]["query"]>;
export type AuditItem = components["schemas"]["AuditLogItem"];
export type AuditDetail = components["schemas"]["AuditLogDetail"];
export class AuditFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
async function unwrap<T>(result: { data?: { data: T }; response: Response }): Promise<T> {
  if (result.data) return result.data.data;
  const failure = await readFailure(result.response);
  throw new AuditFailure(failure.message, failure.symbol);
}
export function createAuditApi(services: Pick<AppServices, "api">) {
  return {
    list: (query: AuditQuery) =>
      services.api.client.GET("/api/v1/admin/audit-logs", { params: { query } }).then(unwrap),
    get: (id: string) =>
      services.api.client
        .GET("/api/v1/admin/audit-logs/{auditLogId}", { params: { path: { auditLogId: id } } })
        .then(unwrap),
  };
}
