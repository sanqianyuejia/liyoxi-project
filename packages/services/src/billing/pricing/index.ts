// 价目与参数的读侧（W1-10）：某一时刻生效的计费参数 paramsAt、剧目积分价 priceAt。
// 依据：07 分组 第 2.5–2.7、4.3、5.1 节；任务书 第 10 节第 1 项。
// 价目按时间取值：effective_at ≤ t 且未撤销的最新一行就是当时的值，到点不需要任何任务去切换。
// 时刻由调用方给：账本操作传账本时钟（锁内），读侧传注入时钟的现在。只读，不加行锁。写侧在 M3、M4。
import { BILLING_PARAM_KEY, BILLING_PARAM_VALUES } from "@liyoxi/contract";
import type { BillingParams, HeatTier } from "@liyoxi/contract";

import type { Db } from "../ledger/types.js";

/** 取不到价的原因：没有热度等级又没有生效的单剧修订；或该等级还没有生效的模板价；或没有这部剧 */
export type PriceUnavailable = "no_tier" | "no_template" | "not_found";

export interface DramaPrice {
  readonly dramaId: string;
  /** 剧目积分价 P */
  readonly points: number;
  /** 快照里的 priceSource（07 分组 第 4.5 节） */
  readonly source: {
    readonly mode: "template" | "custom";
    readonly tier: HeatTier | null;
    readonly dramaPriceRevisionId: string | null;
    readonly tierRevisionId: string | null;
  };
}

/** 时刻 at 生效的全部计费参数：每个键取 effective_at ≤ at 且未撤销的最新一行。少一个键即抛错（12 个键由种子播下） */
export async function paramsAt(db: Db, at: Date): Promise<BillingParams> {
  const rows = await db.$queryRaw<{ key: string; value: unknown }[]>`
    SELECT DISTINCT ON (key) key, value
    FROM billing_param
    WHERE effective_at <= ${at} AND cancelled_at IS NULL
    ORDER BY key, effective_at DESC`;
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const params: Record<string, unknown> = {};
  for (const key of BILLING_PARAM_KEY.values) {
    if (!stored.has(key)) throw new Error(`计费参数 ${key} 在 ${at.toISOString()} 没有生效的值`);
    params[key] = BILLING_PARAM_VALUES[key].parse(stored.get(key));
  }
  return params as BillingParams;
}

/**
 * 时刻 at 的剧目积分价 P(drama, at)：单剧修订优先（custom 取它的价）；按模板（或没有修订）取该剧热度等级在 at 的模板价。
 * 等级是 drama.heat_tier，billing 自己读（L2 读 L1）；等级为空又没有生效的单剧修订时取不到价。
 * 返回每部剧一项：价格，或取不到的原因。
 */
export async function priceAt(
  db: Db,
  dramaIds: readonly string[],
  at: Date,
): Promise<Map<string, DramaPrice | PriceUnavailable>> {
  const ids = [...new Set(dramaIds)];
  const result = new Map<string, DramaPrice | PriceUnavailable>();
  if (ids.length === 0) return result;
  const facts = await db.$queryRaw<
    {
      id: string;
      heatTier: string | null;
      revisionId: string | null;
      revisionMode: string | null;
      customPoints: number | null;
      templateId: string | null;
      templatePoints: number | null;
    }[]
  >`
    WITH current_revision AS (
      SELECT DISTINCT ON (drama_id) id, drama_id, mode, custom_points
      FROM drama_price_revision
      WHERE drama_id = ANY(${ids}::uuid[]) AND effective_at <= ${at} AND cancelled_at IS NULL
      ORDER BY drama_id, effective_at DESC
    ), current_tier AS (
      SELECT DISTINCT ON (tier) id, tier, points FROM price_tier_revision
      WHERE effective_at <= ${at} ORDER BY tier, effective_at DESC
    )
    SELECT d.id::text, d.heat_tier AS "heatTier", r.id::text AS "revisionId",
           r.mode AS "revisionMode", r.custom_points AS "customPoints",
           t.id::text AS "templateId", t.points AS "templatePoints"
    FROM drama d LEFT JOIN current_revision r ON r.drama_id = d.id
    LEFT JOIN current_tier t ON t.tier = d.heat_tier
    WHERE d.id = ANY(${ids}::uuid[])`;
  const revisionOf = new Map(
    facts
      .filter((row) => row.revisionId !== null)
      .map((row) => [
        row.id,
        {
          id: row.revisionId!,
          mode: row.revisionMode,
          custom_points: row.customPoints,
        },
      ]),
  );
  const templateOf = new Map(
    facts
      .filter((row) => row.templateId !== null)
      .map((row) => [
        row.heatTier,
        {
          id: row.templateId!,
          points: row.templatePoints!,
        },
      ]),
  );
  const tierOf = new Map(facts.map((row) => [row.id, row.heatTier as HeatTier | null]));
  for (const dramaId of ids) {
    if (!tierOf.has(dramaId)) {
      result.set(dramaId, "not_found");
      continue;
    }
    const tier = tierOf.get(dramaId) ?? null;
    const revision = revisionOf.get(dramaId);
    if (revision?.mode === "custom" && revision.custom_points !== null) {
      result.set(dramaId, {
        dramaId,
        points: revision.custom_points,
        source: { mode: "custom", tier, dramaPriceRevisionId: revision.id, tierRevisionId: null },
      });
      continue;
    }
    const template = tier === null ? undefined : templateOf.get(tier);
    if (template === undefined) {
      result.set(dramaId, tier === null ? "no_tier" : "no_template");
      continue;
    }
    result.set(dramaId, {
      dramaId,
      points: template.points,
      source: {
        mode: "template",
        tier,
        dramaPriceRevisionId: revision?.id ?? null,
        tierRevisionId: template.id,
      },
    });
  }
  return result;
}
