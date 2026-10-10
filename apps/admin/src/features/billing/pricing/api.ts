import {
  DramaPricePageSchema,
  DramaPriceSummarySchema,
  DramaPriceRevisionPageSchema,
  PriceTierListSchema,
  DramaPriceCreateResultSchema,
  DramaPriceRevisionSchema,
  type DramaPriceCreateBodySchema,
} from "@liyoxi/contract";
import type { AppServices } from "../../../app/services";
import { contentResult } from "../../drama/edit/api";
export type PriceBody = ReturnType<typeof DramaPriceCreateBodySchema.parse>;
export type PriceRow = ReturnType<typeof DramaPricePageSchema.parse>["items"][number];
export type PriceRevision = ReturnType<typeof DramaPriceRevisionSchema.parse>;
export function createPricingApi(services: Pick<AppServices, "api">) {
  const c = services.api.client;
  return {
    list: (query: Record<string, string | number>, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/drama-prices", { params: { query }, signal })
        .then(contentResult)
        .then((v) => DramaPricePageSchema.parse(v)),
    summary: (query: Record<string, string | number>, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/drama-prices/summary", { params: { query }, signal })
        .then(contentResult)
        .then((v) => DramaPriceSummarySchema.parse(v)),
    history: (query: Record<string, string | number>, signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/drama-price-revisions", { params: { query }, signal })
        .then(contentResult)
        .then((v) => DramaPriceRevisionPageSchema.parse(v)),
    tiers: (signal?: AbortSignal) =>
      c
        .GET("/api/v1/admin/price-tier-revisions", { signal })
        .then(contentResult)
        .then((v) => PriceTierListSchema.parse(v)),
    create: (dramaId: string, body: PriceBody, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/dramas/{dramaId}/drama-price-revisions", {
          params: { path: { dramaId } },
          body,
          headers: { "Idempotency-Key": key },
          signal,
        })
        .then(contentResult)
        .then((v) => DramaPriceCreateResultSchema.parse(v)),
    withdraw: (id: string, note: string | null, key: string, signal?: AbortSignal) =>
      c
        .POST("/api/v1/admin/drama-price-revisions/{dramaPriceRevisionId}/withdraw", {
          params: { path: { dramaPriceRevisionId: id } },
          body: { note },
          headers: { "Idempotency-Key": key },
          signal,
        })
        .then(contentResult)
        .then((v) => DramaPriceRevisionSchema.parse(v)),
  };
}
export type PricingApi = ReturnType<typeof createPricingApi>;
