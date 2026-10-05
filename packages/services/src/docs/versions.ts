// 协议“当前版本”的唯一解析口径（W1-03；m01 第 3.12 节；13 分组 第 2.11 节）。
//
//   当前版本 = 同一协议在 pending、active 两种状态里，effective_at <= now 的最新一条。
//
// 不看簿记列 status 是不是 active：它由 docs.sweep 每 5 分钟翻一次，会滞后；到点而仍是 pending 的版本就是当前版本。
// 草稿、已撤回、已失效的不算。全仓只有这一个函数：协议清单、待同意的计算、版本正文的阶段、
// AGREEMENT_VERSION_STALE 的判定，以及别的域返回协议版本的地方（订购报价、广告需求、付款单）都调它。
import type { Tx } from "../kernel/index.js";

/** 只读的库句柄：事务句柄与 Prisma 客户端都合 */
export type DocsReader = Pick<Tx, "agreement" | "agreementVersion" | "agreementConsent">;

/** 解析与展示要用的几列 */
export interface VersionRow {
  readonly id: string;
  readonly agreementKey: string;
  readonly major: number;
  readonly minor: number;
  readonly status: string;
  /** 草稿可空；能被解析到的版本都有 */
  readonly effectiveAt: Date | null;
  readonly summary: string | null;
  readonly isReconsentRequired: boolean;
  readonly contentSha256: string | null;
}

export const VERSION_COLUMNS = {
  id: true,
  agreementKey: true,
  major: true,
  minor: true,
  status: true,
  effectiveAt: true,
  summary: true,
  isReconsentRequired: true,
  contentSha256: true,
} as const;

/** 展示版本号：v{major}.{minor} */
export const versionLabel = (version: Pick<VersionRow, "major" | "minor">): string =>
  `v${version.major}.${version.minor}`;

/** 可被解析为当前版本的两种簿记状态 */
const LIVE_STATUSES = ["pending", "active"];

/** 各协议此刻的当前版本：协议键 → 版本；尚无已生效版本的协议不在返回值里 */
export async function currentVersions(
  db: DocsReader,
  now: Date,
): Promise<Map<string, VersionRow>> {
  const rows = await db.agreementVersion.findMany({
    where: { status: { in: LIVE_STATUSES }, effectiveAt: { lte: now } },
    // 生效时间相同时取版本号大的；再相同（不该出现，docs.N4 会报）取 id 大的，结果仍是确定的
    orderBy: [
      { agreementKey: "asc" },
      { effectiveAt: "desc" },
      { major: "desc" },
      { minor: "desc" },
      { id: "desc" },
    ],
    distinct: ["agreementKey"],
    select: VERSION_COLUMNS,
  });
  return new Map(rows.map((row) => [row.agreementKey, row]));
}

/** 一份协议此刻的当前版本；没有即 null */
export async function currentVersionOf(
  db: DocsReader,
  now: Date,
  agreementKey: string,
): Promise<VersionRow | null> {
  return (await currentVersions(db, now)).get(agreementKey) ?? null;
}

/** 已排期、尚未生效的版本（pending 且 effective_at > now）：协议键 → 版本。每份协议至多一条 */
export async function upcomingVersions(
  db: DocsReader,
  now: Date,
): Promise<Map<string, VersionRow>> {
  const rows = await db.agreementVersion.findMany({
    where: { status: "pending", effectiveAt: { gt: now } },
    select: VERSION_COLUMNS,
  });
  return new Map(rows.map((row) => [row.agreementKey, row]));
}
