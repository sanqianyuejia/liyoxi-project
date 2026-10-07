import type { Drama } from "@liyoxi/db";
import { calendarDate } from "@liyoxi/shared/time";
import { stopDate, permitCovers } from "@liyoxi/shared/catalog";
import { AppError } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { paramsAt } from "../config/index.js";
import type { DramaPrices } from "./ports.js";

export const dateOf = (date: Date | null): string | null =>
  date?.toISOString().slice(0, 10) ?? null;
export const permitsOf = (
  rows: readonly { platform: string; permitKind: string; permitNo: string; status: string }[],
) =>
  rows.map((row) => ({
    platform: row.platform,
    kind: row.permitKind,
    number: row.permitNo,
    status: row.status,
  }));
export async function dramaFacts(tx: Tx, id: string) {
  const drama = await tx.drama.findUnique({ where: { id } });
  if (!drama) throw new AppError("NOT_FOUND");
  const [copyright, permits, episodes, poster] = await Promise.all([
    tx.dramaCopyright.findUnique({ where: { dramaId: id } }),
    tx.dramaPermit.findMany({ where: { dramaId: id, status: "active" }, orderBy: { id: "asc" } }),
    tx.dramaEpisode.findMany({ where: { dramaId: id }, orderBy: { episodeNo: "asc" } }),
    drama.posterFileId ? tx.fileObject.findUnique({ where: { id: drama.posterFileId } }) : null,
  ]);
  return { drama, copyright, permits, episodes, poster };
}
/** 可订入口只消费当前剧目、授权和许可；完整上架检查仍用dramaFacts。 */
export async function orderableFacts(tx: Tx, id: string) {
  const [facts] = await tx.$queryRaw<
    (Pick<
      Drama,
      | "status"
      | "archivedAt"
      | "title"
      | "totalEpisodes"
      | "dramaClass"
      | "genreCodes"
      | "posterFileId"
      | "allowedPlacements"
      | "isAiGenerated"
    > & {
      hasCopyright: boolean;
      licenseEndDate: Date | null;
      platforms: string[] | null;
      permits: { platform: string; permitKind: string; permitNo: string; status: string }[];
    })[]
  >`
    SELECT d.status, d.archived_at AS "archivedAt", d.title, d.total_episodes AS "totalEpisodes",
           d.drama_class AS "dramaClass", d.genre_codes AS "genreCodes", d.poster_file_id AS "posterFileId",
           d.allowed_placements AS "allowedPlacements", d.is_ai_generated AS "isAiGenerated",
           c.drama_id IS NOT NULL AS "hasCopyright", c.license_end_date AS "licenseEndDate", c.platforms,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'platform', p.platform, 'permitKind', p.permit_kind, 'permitNo', p.permit_no, 'status', p.status)
             ORDER BY p.id ASC) FROM drama_permit p WHERE p.drama_id = d.id AND p.status = 'active'),
             '[]'::jsonb) AS permits
    FROM drama d LEFT JOIN drama_copyright c ON c.drama_id = d.id
    WHERE d.id = ${id}::uuid`;
  if (!facts) throw new AppError("NOT_FOUND");
  const { hasCopyright, licenseEndDate, platforms, permits, ...drama } = facts;
  // platforms自身非空；只有LEFT JOIN没有版权行时才会是SQL NULL。
  const copyright = hasCopyright ? { licenseEndDate, platforms: platforms! } : null;
  return { drama, copyright, permits };
}
export type DramaFacts = Awaited<ReturnType<typeof dramaFacts>>;
export interface ListingItem {
  code: string;
  label: string;
  severity: "block" | "hint";
  isOk: boolean;
  note: string | null;
  fixTab: "basic" | "commercial" | "episodes" | "license" | "copyright" | null;
}
export interface ListingChecks {
  isShelvable: boolean;
  passedCount: number;
  total: number;
  items: ListingItem[];
  evaluatedAt: string;
}
/** M1 媒体就绪留桩：原片按就绪；预告片尚未就绪。M3 替换为媒体端口。 */
export interface MediaReadiness {
  mastersReady: boolean;
  trailerReady: boolean;
}
export const mediaReadiness = (): MediaReadiness => ({ mastersReady: true, trailerReady: false });
export async function listingChecks(
  tx: Tx,
  id: string,
  at: Date,
  prices: DramaPrices,
): Promise<ListingChecks> {
  const facts = await dramaFacts(tx, id);
  const [priceMap, months, params, flag] = await Promise.all([
    prices.priceAt(tx, [id], at),
    prices.minLicenseMonths(tx, at),
    paramsAt(tx, ["content.placement.open_slots"], at),
    tx.featureFlag.findUnique({
      where: { key: "weapp.video.trailer.enabled" },
      select: { defaultValue: true },
    }),
  ]);
  return evaluateListing(facts, {
    at,
    priceAvailable: typeof priceMap.get(id) === "object",
    minLicenseMonths: months,
    openSlots: params["content.placement.open_slots"],
    trailerBlocking: flag?.defaultValue === true,
  });
}
export function evaluateListing(
  { drama: d, copyright: c, permits, episodes, poster }: DramaFacts,
  options: {
    at: Date;
    priceAvailable: boolean;
    minLicenseMonths: number;
    openSlots: readonly string[];
    trailerBlocking: boolean;
    media?: MediaReadiness;
  },
): ListingChecks {
  const today = calendarDate(options.at),
    end = dateOf(c?.licenseEndDate ?? null),
    ready = options.media ?? mediaReadiness();
  const required = permits.filter((row) =>
    d.dramaClass === "class_3"
      ? row.permitKind === "program_no"
      : (d.dramaClass === "class_1" || d.dramaClass === "class_2") &&
        ["license_no", "approval_no"].includes(row.permitKind),
  );
  const row = (
    code: string,
    label: string,
    isOk: boolean,
    fixTab: ListingItem["fixTab"],
    severity: ListingItem["severity"] = "block",
  ): ListingItem => ({ code, label, severity, isOk, note: isOk ? null : label, fixTab });
  const items = [
    row(
      "L1",
      "必备许可及扫描件齐全",
      required.length > 0 && required.some((item) => item.scanFileIds.length > 0),
      "license",
    ),
    row(
      "L2",
      "版权资料齐全",
      !!c?.source &&
        c.platforms.length > 0 &&
        !!c.territory?.trim() &&
        !!c.licenseStartDate &&
        !!end &&
        c.proofFileIds.length > 0,
      "copyright",
    ),
    row(
      "L3",
      "已获转授权、剪辑植入和改编权",
      !!c?.canSublicense && c.canEditEmbed && c.canAdapt,
      "copyright",
    ),
    row("L4", "已获信息网络传播权", c?.hasNetworkRight === true, "copyright"),
    row("L5", "热度等级及积分价可用", d.heatTier !== null && options.priceAvailable, "commercial"),
    row(
      "L6",
      "预告片已就绪且不超过三分钟",
      ready.trailerReady,
      "basic",
      options.trailerBlocking ? "block" : "hint",
    ),
    row("L7", "授权尚未结束", end !== null && today <= end, "copyright"),
    row(
      "L8",
      "尚未到停止订购日",
      end !== null && today < stopDate(end, options.minLicenseMonths),
      "copyright",
      "hint",
    ),
    row(
      "L9",
      "基础信息齐全且封面可用",
      !!d.title.trim() &&
        !!d.posterFileId &&
        !!d.totalEpisodes &&
        d.genreCodes.length > 0 &&
        !!d.synopsis?.trim() &&
        poster?.status === "stored" &&
        poster.moderationState !== "block",
      "basic",
    ),
    row(
      "L10",
      "剧集和原片齐全",
      d.totalEpisodes !== null && episodes.length === d.totalEpisodes && ready.mastersReady,
      "episodes",
    ),
    row(
      "L11",
      "植入形式已开放且符合类别",
      d.allowedPlacements.length > 0 &&
        d.allowedPlacements.every(
          (slot) =>
            options.openSlots.includes(slot) &&
            (d.dramaClass === "class_3" || slot === "opening" || slot === "ending"),
        ),
      "commercial",
    ),
    row("L12", "许可无需重新核验", !d.isPermitRecheckRequired, "license"),
    row("L13", "已选适配行业", d.industryCodes.length > 0, "commercial", "hint"),
    row(
      "L14",
      "许可覆盖全部授权平台",
      !!c &&
        c.platforms.length > 0 &&
        c.platforms.every((platform) => permitCovers(permitsOf(permits), platform, d.dramaClass)),
      "license",
      "hint",
    ),
  ];
  return {
    isShelvable: items.every((item) => item.severity === "hint" || item.isOk),
    passedCount: items.filter((item) => item.isOk).length,
    total: items.length,
    items,
    evaluatedAt: options.at.toISOString(),
  };
}
export function assertListing(checks: ListingChecks): void {
  if (!checks.isShelvable)
    throw new AppError("LISTING_CHECK_FAILED", {
      details: {
        failed: checks.items
          .filter((item) => item.severity === "block" && !item.isOk)
          .map(({ code, note }) => ({ code, note })),
      },
    });
}
