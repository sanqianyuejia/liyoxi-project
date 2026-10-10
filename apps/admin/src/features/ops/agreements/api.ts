import type { components, operations } from "@liyoxi/contract/types/admin";
import type { AppServices } from "../../../app/services";
import { readFailure, type ApiFailure } from "../../../lib/api-errors";

export type CreateBody = components["schemas"]["AgreementVersionCreateBody"];
export type UpdateBody = components["schemas"]["AgreementVersionUpdateBody"];
export type ScheduleBody = components["schemas"]["AgreementVersionScheduleBody"];
export type WithdrawBody = components["schemas"]["AgreementVersionWithdrawBody"];
export type ConsentQuery = NonNullable<
  operations["admin.agreementConsent.list"]["parameters"]["query"]
>;
export class AgreementFailure extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
  }
}
async function unwrap<T>(result: {
  data?: { data: T };
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data) return result.data.data;
  throw new AgreementFailure(
    await readFailure(
      result.error === undefined
        ? result.response
        : new Response(JSON.stringify(result.error), {
            status: result.response.status,
            headers: result.response.headers,
          }),
    ),
  );
}
export function createAgreementApi({ api }: Pick<AppServices, "api">) {
  const c = api.client;
  return {
    list: (signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/agreements", {
          params: { query: { page: 1, pageSize: 20 } },
          signal,
        })
        .then(unwrap),
    get: (agreementKey: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/agreements/{agreementKey}", {
          params: { path: { agreementKey } },
          signal,
        })
        .then(unwrap),
    create: (agreementKey: string, body: CreateBody, key: string) =>
      c
        .POST("/api/v1/admin/agreements/{agreementKey}/agreement-versions", {
          params: { path: { agreementKey } },
          body,
          headers: { "Idempotency-Key": key },
        })
        .then(unwrap),
    update: (agreementVersionId: string, body: UpdateBody, key: string) =>
      c
        .PATCH("/api/v1/admin/agreement-versions/{agreementVersionId}", {
          params: { path: { agreementVersionId } },
          body,
          headers: { "Idempotency-Key": key },
        })
        .then(unwrap),
    schedule: (agreementVersionId: string, body: ScheduleBody, key: string) =>
      c
        .POST("/api/v1/admin/agreement-versions/{agreementVersionId}/schedule", {
          params: { path: { agreementVersionId } },
          body,
          headers: { "Idempotency-Key": key },
        })
        .then(unwrap),
    withdraw: (agreementVersionId: string, body: WithdrawBody, key: string) =>
      c
        .POST("/api/v1/admin/agreement-versions/{agreementVersionId}/withdraw", {
          params: { path: { agreementVersionId } },
          body,
          headers: { "Idempotency-Key": key },
        })
        .then(unwrap),
    consents: (query: ConsentQuery, signal?: AbortSignal) =>
      c.GET("/api/v1/admin/agreement-consents", { params: { query }, signal }).then(unwrap),
    consent: (agreementConsentId: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/agreement-consents/{agreementConsentId}", {
          params: { path: { agreementConsentId } },
          signal,
        })
        .then(unwrap),
    download: (fileId: string) =>
      c
        .POST("/api/v1/admin/files/{fileId}/download-urls", {
          params: { path: { fileId } },
          body: { disposition: "attachment" },
        })
        .then(unwrap),
  };
}
export type AgreementApi = ReturnType<typeof createAgreementApi>;

// Match the central client response projection, including its future enum representation.
export type AgreementItem = Awaited<ReturnType<AgreementApi["list"]>>["items"][number];
export type AgreementDetail = Awaited<ReturnType<AgreementApi["get"]>>;
export type Version = AgreementDetail["versions"][number];
export type ConsentItem = Awaited<ReturnType<AgreementApi["consents"]>>["items"][number];
export type ConsentDetail = Awaited<ReturnType<AgreementApi["consent"]>>;
