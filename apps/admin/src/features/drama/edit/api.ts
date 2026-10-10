import {
  AdminDramaDetailSchema,
  AdminDramaWriteResultSchema,
  type DramaBasicBodySchema,
  type DramaCommercialBodySchema,
  type DramaCastBodySchema,
  type CopyrightReplaceBodySchema,
  type CopyrightRevisionCreateBodySchema,
  CopyrightRevisionCreateResultSchema,
  type DramaPermitCreateBodySchema,
  type DramaPermitUpdateBodySchema,
  DramaPermitCreateResultSchema,
  DramaPermitWriteResultSchema,
  DramaPermitListResultSchema,
  DramaEpisodeListResultSchema,
  DramaEpisodeWriteResultSchema,
  DramaActivityResultSchema,
  MediaReadinessSchema,
  ListingCheckResultSchema,
  DramaTrailerWriteResultSchema,
  DictItemListSchema,
  type AdminFileCreateBodySchema,
  FileRegistrationSchema,
  AdminFileViewSchema,
  SignedUrlSchema,
  MediaJobPageSchema,
} from "@liyoxi/contract";
import type { AppServices } from "../../../app/services";
import { readFailure, type ApiFailure } from "../../../lib/api-errors";
import { createBatchApi } from "../../delivery/ticket-detail/batch-api";

export type DramaDetail = ReturnType<typeof AdminDramaDetailSchema.parse>;
export type BasicBody = ReturnType<typeof DramaBasicBodySchema.parse>;
export type CommercialBody = ReturnType<typeof DramaCommercialBodySchema.parse>;
export type CastBody = ReturnType<typeof DramaCastBodySchema.parse>;
export type CopyrightBody = ReturnType<typeof CopyrightReplaceBodySchema.parse>;
export type CopyrightRevisionBody = ReturnType<typeof CopyrightRevisionCreateBodySchema.parse>;
export type PermitBody = ReturnType<typeof DramaPermitCreateBodySchema.parse>;
export type PermitUpdateBody = ReturnType<typeof DramaPermitUpdateBodySchema.parse>;
export type FileBody = ReturnType<typeof AdminFileCreateBodySchema.parse>;
export type Dictionary = ReturnType<typeof DictItemListSchema.parse>["items"];
export class ContentFailure extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
  }
}
export async function contentResult<T>(result: {
  data?: { data: T };
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data) return result.data.data;
  const response =
    result.error === undefined
      ? result.response
      : new Response(JSON.stringify(result.error), {
          status: result.response.status,
          headers: result.response.headers,
        });
  throw new ContentFailure(await readFailure(response));
}
export function contentError(error: unknown): string {
  if (error instanceof ContentFailure) {
    const fields = error.failure.body?.fieldErrors;
    return fields?.length ? fields.map((v) => `${v.path}：${v.message}`).join("；") : error.message;
  }
  return error instanceof Error ? error.message : "请求没有完成，请重试";
}
export function contentConflict(error: unknown) {
  return (
    error instanceof ContentFailure &&
    ["VERSION_CONFLICT", "PRECONDITION_CHANGED", "CONFIRM_MISMATCH"].includes(error.failure.symbol)
  );
}
export function createDramaApi(services: Pick<AppServices, "api">) {
  const c = services.api.client;
  const params = (dramaId: string) => ({ path: { dramaId } });
  const headers = (key: string) => ({ "Idempotency-Key": key });
  return {
    batches: createBatchApi(services),
    get: (id: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dramas/{dramaId}", { params: params(id), signal })
        .then(contentResult)
        .then((v) => AdminDramaDetailSchema.parse(v)),
    basic: (id: string, body: BasicBody, key: string, signal?: AbortSignal) =>
      c
        .PATCH("/api/v1/admin/dramas/{dramaId}/basic", {
          params: params(id),
          body,
          headers: headers(key),
          signal,
        })
        .then(contentResult)
        .then((v) => AdminDramaWriteResultSchema.parse(v)),
    commercial: (id: string, body: CommercialBody, key: string, signal?: AbortSignal) =>
      c
        .PATCH("/api/v1/admin/dramas/{dramaId}/commercial", {
          params: params(id),
          body,
          headers: headers(key),
          signal,
        })
        .then(contentResult)
        .then((v) => AdminDramaWriteResultSchema.parse(v)),
    cast: (id: string, body: CastBody, key: string, signal?: AbortSignal) =>
      c
        .PUT("/api/v1/admin/dramas/{dramaId}/cast", {
          params: params(id),
          body,
          headers: headers(key),
          signal,
        })
        .then(contentResult)
        .then((v) => AdminDramaWriteResultSchema.parse(v)),
    copyright: (id: string, body: CopyrightBody, key: string, signal?: AbortSignal) =>
      c
        .PUT("/api/v1/admin/dramas/{dramaId}/copyright", {
          params: params(id),
          body,
          headers: headers(key),
          signal,
        })
        .then(contentResult)
        .then((v) => AdminDramaWriteResultSchema.parse(v)),
    reviseCopyright: (id: string, body: CopyrightRevisionBody, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/dramas/{dramaId}/drama-copyright-revisions", {
          params: params(id),
          body,
          headers: headers(key),
          signal,
        })
        .then(contentResult)
        .then((v) => CopyrightRevisionCreateResultSchema.parse(v)),
    permits: (id: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dramas/{dramaId}/drama-permits", { params: params(id), signal })
        .then(contentResult)
        .then((v) => DramaPermitListResultSchema.parse(v)),
    createPermit: (id: string, body: PermitBody, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/dramas/{dramaId}/drama-permits", {
          params: params(id),
          body,
          headers: headers(key),
          signal,
        })
        .then(contentResult)
        .then((v) => DramaPermitCreateResultSchema.parse(v)),
    updatePermit: (id: string, body: PermitUpdateBody, key: string, signal?: AbortSignal) =>
      c
        .PATCH("/api/v1/admin/drama-permits/{dramaPermitId}", {
          params: { path: { dramaPermitId: id } },
          body,
          headers: headers(key),
          signal,
        })
        .then(contentResult)
        .then((v) => DramaPermitWriteResultSchema.parse(v)),
    retirePermit: (id: string, retireReason: string, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/drama-permits/{dramaPermitId}/retire", {
          params: { path: { dramaPermitId: id } },
          body: { retireReason },
          headers: headers(key),
          signal,
        })
        .then(contentResult)
        .then((v) => DramaPermitWriteResultSchema.parse(v)),
    episodes: (id: string, page: number, pageSize: number, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dramas/{dramaId}/drama-episodes", {
          params: { ...params(id), query: { page, pageSize } },
          signal,
        })
        .then(contentResult)
        .then((v) => DramaEpisodeListResultSchema.parse(v)),
    episode: (
      id: string,
      body: { dramaLockVersion: number; title: string | null },
      key: string,
      signal?: AbortSignal,
    ) =>
      c
        .PATCH("/api/v1/admin/drama-episodes/{dramaEpisodeId}", {
          params: { path: { dramaEpisodeId: id } },
          body,
          headers: headers(key),
          signal,
        })
        .then(contentResult)
        .then((v) => DramaEpisodeWriteResultSchema.parse(v)),
    readiness: (id: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dramas/{dramaId}/media-readiness", { params: params(id), signal })
        .then(contentResult)
        .then((v) => MediaReadinessSchema.parse(v)),
    checks: (id: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dramas/{dramaId}/listing-checks", { params: params(id), signal })
        .then(contentResult)
        .then((v) => ListingCheckResultSchema.parse(v)),
    activity: (id: string, cursor?: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dramas/{dramaId}/activities", {
          params: { ...params(id), query: { cursor, limit: 20 } },
          signal,
        })
        .then(contentResult)
        .then((v) => DramaActivityResultSchema.parse(v)),
    recheck: (id: string, note: string, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/dramas/{dramaId}/confirm-permit-recheck", {
          params: params(id),
          body: { note },
          headers: headers(key),
          signal,
        })
        .then(contentResult)
        .then((v) => AdminDramaWriteResultSchema.parse(v)),
    trailer: (id: string, sourceFileId: string, key: string, signal?: AbortSignal) =>
      c
        .PUT("/api/v1/admin/dramas/{dramaId}/trailer", {
          params: params(id),
          body: { sourceFileId },
          headers: headers(key),
          signal,
        })
        .then(contentResult)
        .then((v) => DramaTrailerWriteResultSchema.parse(v)),
    dict: (typeKey: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dict-items", { params: { query: { typeKey } }, signal })
        .then(contentResult)
        .then((v) => DictItemListSchema.parse(v).items),
    file: (body: FileBody, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/files", { body, headers: headers(key), signal })
        .then(contentResult)
        .then((v) => FileRegistrationSchema.parse(v)),
    complete: (fileId: string, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/files/{fileId}/complete", {
          params: { path: { fileId } },
          headers: headers(key),
          signal,
        })
        .then(contentResult)
        .then((v) => AdminFileViewSchema.parse(v)),
    fileStatus: (fileId: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/files/{fileId}", { params: { path: { fileId } }, signal })
        .then(contentResult)
        .then((v) => AdminFileViewSchema.parse(v)),
    fileUrl: (fileId: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/files/{fileId}/download-urls", {
          params: { path: { fileId } },
          body: { disposition: "inline", purpose: "内容运营核对" },
          signal,
        })
        .then(contentResult)
        .then((v) => SignedUrlSchema.parse(v)),
    trailerJobs: (playableId: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/media-jobs", {
          params: {
            query: {
              parentType: "playable_asset",
              parentId: playableId,
              state: "failed",
              pageSize: 100,
            },
          },
          signal,
        })
        .then(contentResult)
        .then((v) => MediaJobPageSchema.parse(v)),
    retryJob: (mediaJobId: string, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/media-jobs/{mediaJobId}/retry", {
          params: { path: { mediaJobId } },
          body: { note: "内容运营重试预告片" },
          headers: headers(key),
          signal,
        })
        .then(contentResult),
  };
}
export type DramaApi = ReturnType<typeof createDramaApi>;
