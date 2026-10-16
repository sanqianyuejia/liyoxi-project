import type { operations } from "@liyoxi/contract/types/admin";
import type { AppServices } from "../../../app/services";
import { readFailure } from "../../../lib/api-errors";
import { createBatchApi } from "./batch-api";
type Body<K extends keyof operations> = operations[K] extends {
  requestBody: { content: { "application/json": infer T } };
}
  ? T
  : never;
export type DraftBody = Body<"admin.deliveryPlan.draft.replace">;
export type FileBody = Body<"admin.file.create">;
export type QcBody = Body<"admin.sample.inspect">;
export type EpisodesBody = Body<"admin.deliveryTicket.episodeOutput.create">;
export type EpisodeQcBody = Body<"admin.deliveryTicket.inspectEpisodes">;
export class DeliveryFailure extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
async function unwrap<T>(result: { data?: { data: T }; response: Response }): Promise<T> {
  if (result.data) return result.data.data;
  const failure = await readFailure(result.response);
  throw new DeliveryFailure(failure.message, failure.body?.error, failure.body?.details);
}
export function createTicketDetailApi(services: Pick<AppServices, "api">) {
  const c = services.api.client;
  return {
    batches: createBatchApi(services),
    find: (ticketNo: string) =>
      c
        .GET("/api/v1/admin/delivery-tickets", {
          params: { query: { q: ticketNo, tab: "all", pageSize: 100 } },
        })
        .then(unwrap),
    get: (id: string) =>
      c
        .GET("/api/v1/admin/delivery-tickets/{deliveryTicketId}", {
          params: { path: { deliveryTicketId: id } },
        })
        .then(unwrap),
    plan: (id: string) =>
      c
        .GET("/api/v1/admin/delivery-plans/{deliveryPlanId}", {
          params: { path: { deliveryPlanId: id } },
        })
        .then(unwrap),
    order: (id: string) =>
      c.GET("/api/v1/admin/orders/{orderId}", { params: { path: { orderId: id } } }).then(unwrap),
    focus: () =>
      c
        .GET("/api/v1/admin/dict-items", { params: { query: { typeKey: "custom_focus" } } })
        .then(unwrap),
    template: (code: "qc.sample" | "qc.episode" | "qc.package") =>
      c
        .GET("/api/v1/admin/checklist-templates", { params: { query: { code, status: "active" } } })
        .then(unwrap)
        .then((r) => r.items.find((t) => t.code === code)),
    draft: (id: string, body: DraftBody, key: string) =>
      c
        .PUT("/api/v1/admin/delivery-plans/{deliveryPlanId}/draft", {
          params: { path: { deliveryPlanId: id } },
          body,
          headers: { "Idempotency-Key": key },
        })
        .then(unwrap),
    pushPlan: (id: string, draftLockVersion: number, key: string) =>
      c
        .POST("/api/v1/admin/delivery-plans/{deliveryPlanId}/push", {
          params: { path: { deliveryPlanId: id } },
          body: { draftLockVersion },
          headers: { "Idempotency-Key": key },
        })
        .then(unwrap),
    file: (body: FileBody, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/files", { body, headers: { "Idempotency-Key": key }, signal })
        .then(unwrap),
    refreshCredentials: (fileId: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/files/{fileId}/refresh-credentials", {
          params: { path: { fileId } },
          signal,
        })
        .then(unwrap),
    complete: (fileId: string, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/files/{fileId}/complete", {
          params: { path: { fileId } },
          headers: { "Idempotency-Key": key },
          signal,
        })
        .then(unwrap),
    fileStatus: (fileId: string, signal?: AbortSignal) =>
      c.GET("/api/v1/admin/files/{fileId}", { params: { path: { fileId } }, signal }).then(unwrap),
    sample: (id: string, fileId: string, key: string) =>
      c
        .POST("/api/v1/admin/delivery-tickets/{deliveryTicketId}/samples", {
          params: { path: { deliveryTicketId: id } },
          body: { fileId, adSlots: [] },
          headers: { "Idempotency-Key": key },
        })
        .then(unwrap),
    inspectSample: (sampleId: string, body: QcBody, key: string) =>
      c
        .POST("/api/v1/admin/samples/{sampleId}/inspect", {
          params: { path: { sampleId } },
          body,
          headers: { "Idempotency-Key": key },
        })
        .then(unwrap),
    pushSample: (sampleId: string, key: string) =>
      c
        .POST("/api/v1/admin/samples/{sampleId}/push", {
          params: { path: { sampleId } },
          body: {},
          headers: { "Idempotency-Key": key },
        })
        .then(unwrap),
    episodes: (id: string) =>
      c
        .GET("/api/v1/admin/delivery-tickets/{deliveryTicketId}/episode-outputs", {
          params: { path: { deliveryTicketId: id } },
        })
        .then(unwrap),
    registerEpisodes: (id: string, body: EpisodesBody, key: string) =>
      c
        .POST("/api/v1/admin/delivery-tickets/{deliveryTicketId}/episode-outputs", {
          params: { path: { deliveryTicketId: id } },
          body,
          headers: { "Idempotency-Key": key },
        })
        .then(unwrap),
    inspectEpisodes: (id: string, body: EpisodeQcBody, key: string) =>
      c
        .POST("/api/v1/admin/delivery-tickets/{deliveryTicketId}/inspect-episodes", {
          params: { path: { deliveryTicketId: id } },
          body,
          headers: { "Idempotency-Key": key },
        })
        .then(unwrap),
    inspectPackage: (id: string, body: QcBody, key: string) =>
      c
        .POST("/api/v1/admin/delivery-tickets/{deliveryTicketId}/inspect-package", {
          params: { path: { deliveryTicketId: id } },
          body,
          headers: { "Idempotency-Key": key },
        })
        .then(unwrap),
  };
}
export type DetailApi = ReturnType<typeof createTicketDetailApi>;
export type Ticket = Awaited<ReturnType<DetailApi["get"]>>;
export type Plan = Awaited<ReturnType<DetailApi["plan"]>>;
export type Template = NonNullable<Awaited<ReturnType<DetailApi["template"]>>>;
export type Grid = Awaited<ReturnType<DetailApi["episodes"]>>;
