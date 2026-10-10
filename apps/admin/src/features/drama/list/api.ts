import {
  DramaListResultSchema,
  DramaSummarySchema,
  DramaCreateBodySchema,
  AdminDramaWriteResultSchema,
  AdminDramaDetailSchema,
  ListingCheckResultSchema,
  MediaReadinessSchema,
  type DramaDelistBodySchema,
} from "@liyoxi/contract";
import type { AppServices } from "../../../app/services";
import { contentResult } from "../edit/api";
export function createDramaListApi(services: Pick<AppServices, "api">) {
  const c = services.api.client;
  return {
    list: (query: Record<string, string | number>, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dramas", { params: { query }, signal })
        .then(contentResult)
        .then((v) => DramaListResultSchema.parse(v)),
    summary: (signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dramas/summary", { signal })
        .then(contentResult)
        .then((v) => DramaSummarySchema.parse(v)),
    create: (title: string, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/dramas", {
          body: DramaCreateBodySchema.parse({ title }),
          headers: { "Idempotency-Key": key },
          signal,
        })
        .then(contentResult)
        .then((v) => AdminDramaWriteResultSchema.parse(v)),
    detail: (id: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dramas/{dramaId}", { params: { path: { dramaId: id } }, signal })
        .then(contentResult)
        .then((v) => AdminDramaDetailSchema.parse(v)),
    checks: (id: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dramas/{dramaId}/listing-checks", {
          params: { path: { dramaId: id } },
          signal,
        })
        .then(contentResult)
        .then((v) => ListingCheckResultSchema.parse(v)),
    readiness: (id: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dramas/{dramaId}/media-readiness", {
          params: { path: { dramaId: id } },
          signal,
        })
        .then(contentResult)
        .then((v) => MediaReadinessSchema.parse(v)),
    shelve: (id: string, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/dramas/{dramaId}/shelve", {
          params: { path: { dramaId: id } },
          body: {},
          headers: { "Idempotency-Key": key },
          signal,
        })
        .then(contentResult)
        .then((v) => AdminDramaWriteResultSchema.parse(v)),
    delist: (
      id: string,
      body: ReturnType<typeof DramaDelistBodySchema.parse>,
      key: string,
      signal?: AbortSignal,
    ) =>
      c
        .POST("/api/v1/admin/dramas/{dramaId}/delist", {
          params: { path: { dramaId: id } },
          body,
          headers: { "Idempotency-Key": key },
          signal,
        })
        .then(contentResult)
        .then((v) => AdminDramaWriteResultSchema.parse(v)),
  };
}
export type DramaListApi = ReturnType<typeof createDramaListApi>;
