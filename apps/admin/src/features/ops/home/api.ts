import type { operations } from "@liyoxi/contract/types/admin";
import { SiteConfigViewSchema, type SiteConfigView } from "@liyoxi/contract";
import type { AppServices } from "../../../app/services";
import { readFailure, type ApiFailure } from "../../../lib/api-errors";

type Body<K extends keyof operations> = operations[K] extends {
  requestBody: { content: { "application/json": infer T } };
}
  ? T
  : never;
export type ConfigKey = "home_recommend" | "mall";
export type DraftBody = Body<"admin.siteConfig.draft.replace">;
export type PublishBody = Body<"admin.siteConfig.publish">;
export type BannerBody = Body<"admin.homeBanner.create">;
export type BannerUpdateBody = Body<"admin.homeBanner.update">;
export type BannerQuery = NonNullable<operations["admin.homeBanner.list"]["parameters"]["query"]>;
export class SiteFailure extends Error {
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
  const response =
    result.error === undefined
      ? result.response
      : new Response(JSON.stringify(result.error), {
          status: result.response.status,
          headers: result.response.headers,
        });
  throw new SiteFailure(await readFailure(response));
}
export function siteError(error: unknown) {
  return error instanceof Error ? error.message : "请求没有成功，请重试";
}
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof SiteFailure)) return {};
  const fields = Object.fromEntries(
    (error.failure.body?.fieldErrors ?? []).map((item) => [item.path, item.message]),
  );
  const details = error.failure.body?.details;
  if (
    error.failure.symbol === "CONFIG_REF_INVALID" &&
    typeof details === "object" &&
    details !== null &&
    "items" in details &&
    Array.isArray(details.items)
  ) {
    for (const item of details.items) {
      if (
        typeof item === "object" &&
        item !== null &&
        "path" in item &&
        typeof item.path === "string"
      )
        fields[item.path] =
          "reason" in item && typeof item.reason === "string"
            ? item.reason
            : "引用已失效，请重新选择";
    }
  }
  return fields;
}
export function versionConflict(error: unknown) {
  return (
    error instanceof SiteFailure &&
    ["VERSION_CONFLICT", "CONFIG_REV_CONFLICT"].includes(error.failure.symbol)
  );
}
export function bannerOrderStale(error: unknown) {
  return error instanceof SiteFailure && error.failure.symbol === "BANNER_ORDER_STALE";
}
export function createSiteApi(services: Pick<AppServices, "api">) {
  const c = services.api.client;
  const banners = (query: BannerQuery, signal?: AbortSignal) =>
    c
      .GET("/api/v1/admin/home-banners", {
        params: { query },
        signal,
      })
      .then(unwrap);
  return {
    get: (configKey: ConfigKey, signal?: AbortSignal): Promise<SiteConfigView> =>
      c
        .GET("/api/v1/admin/site-configs/{configKey}", { params: { path: { configKey } }, signal })
        .then(unwrap)
        .then((data) => SiteConfigViewSchema.parse(data)),
    save: (configKey: ConfigKey, body: DraftBody, key: string, signal?: AbortSignal) =>
      c
        .PUT("/api/v1/admin/site-configs/{configKey}/draft", {
          params: { path: { configKey } },
          body,
          headers: { "Idempotency-Key": key },
          signal,
        })
        .then(unwrap)
        .then((data) => SiteConfigViewSchema.parse(data)),
    publish: (configKey: ConfigKey, body: PublishBody, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/site-configs/{configKey}/publish", {
          params: { path: { configKey } },
          body,
          headers: { "Idempotency-Key": key },
          signal,
        })
        .then(unwrap)
        .then((data) => SiteConfigViewSchema.parse(data)),
    revisions: (configKey: ConfigKey, page: number, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/site-configs/{configKey}/revisions", {
          params: { path: { configKey }, query: { page, pageSize: 20 } },
          signal,
        })
        .then(unwrap),
    dictionaries: (signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dict-items", {
          params: { query: { typeKey: "genre,industry" } },
          signal,
        })
        .then(unwrap),
    dramas: (q?: string, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/dramas", {
          params: {
            query: { q: q?.trim().slice(0, 20) || undefined, status: "listed", pageSize: 100 },
          },
          signal,
        })
        .then(unwrap),
    banners,
    async unended(signal?: AbortSignal) {
      const first = await banners(
        { isEnded: false, sort: "position", page: 1, pageSize: 100 },
        signal,
      );
      const items = [...first.items];
      for (let page = 2; items.length < first.total; page++) {
        const next = await banners(
          { isEnded: false, sort: "position", page, pageSize: 100 },
          signal,
        );
        if (!next.items.length) throw new Error("Banner 列表已变化，请重新加载后排序");
        items.push(...next.items);
      }
      if (new Set(items.map((row) => row.homeBannerId)).size !== items.length)
        throw new Error("Banner 列表已变化，请重新加载后排序");
      return items;
    },
    summary: (signal?: AbortSignal) =>
      c.GET("/api/v1/admin/home-banners/summary", { signal }).then(unwrap),
    createBanner: (body: BannerBody, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/home-banners", { body, headers: { "Idempotency-Key": key }, signal })
        .then(unwrap),
    updateBanner: (
      homeBannerId: string,
      body: BannerUpdateBody,
      key: string,
      signal?: AbortSignal,
    ) =>
      c
        .PATCH("/api/v1/admin/home-banners/{homeBannerId}", {
          params: { path: { homeBannerId } },
          body,
          headers: { "Idempotency-Key": key },
          signal,
        })
        .then(unwrap),
    reorder: (homeBannerIds: string[], key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/home-banners/reorder", {
          body: { homeBannerIds },
          headers: { "Idempotency-Key": key },
          signal,
        })
        .then(unwrap),
    file: (body: Body<"admin.file.create">, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/files", { body, headers: { "Idempotency-Key": key }, signal })
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
  };
}
export type SiteApi = ReturnType<typeof createSiteApi>;
export type Banner = Awaited<ReturnType<SiteApi["banners"]>>["items"][number];
export type SiteRevision = Awaited<ReturnType<SiteApi["revisions"]>>["items"][number];
