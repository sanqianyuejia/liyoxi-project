import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { uuidv7 } from "../../kernel/index.js";
import { createClock, createFactories, useSeededDatabase } from "../../testing/index.js";
import type { Factories } from "../../testing/index.js";
import { paramsAt, priceAt } from "./index.js";

// 价目与参数的读侧：按时间取值——effective_at ≤ t 且未撤销的最新一行。种子播在 2026-01-05 12:00（北京时间）。

const SLOW = 120_000;
const at = (local: string): Date => new Date(`${local}+08:00`);
const SEEDED = at("2026-01-05T12:00:00");

const db = useSeededDatabase("services");
const clock = createClock();
let prisma: PrismaClient;
let make: Factories;

beforeAll(async () => {
  prisma = await db.prisma();
  make = createFactories({ db: prisma, clock });
}, SLOW);

describe("paramsAt", () => {
  it(
    "种子的十二个键都取得到；后来生效的修订到点才算，撤销的不算；种子之前没有值即抛错",
    async () => {
      const seeded = await paramsAt(prisma, SEEDED);
      expect(seeded).toEqual({
        adUnitPoints: 50,
        adFreeRevisions: 2,
        topModelSurchargeBp: 2000,
        cancelDeductionBp: {
          planConfirm: 1000,
          adAndSample: 3000,
          samplePending: 5000,
          postSample: null,
          adInProduction: 10_000,
        },
        expiredTermRefund: { merchant: "addon", platform: "addon", qualification: "addon" },
        minLicenseMonths: 3,
        renewalReminderDays: [7, 3, 1],
        prorationBaseDays: 30,
        planRefundWindowHours: 168,
        enabledCycles: [1, 3, 12],
        maxScheduledTerms: 1,
        noticeDays: 30,
      });

      const row = (value: number, effectiveAt: Date, cancelledAt: Date | null = null) => ({
        id: uuidv7(),
        key: "adUnitPoints",
        value,
        effectiveAt,
        changeId: uuidv7(),
        cancelledAt,
        createdAt: SEEDED,
      });
      await prisma.billingParam.createMany({
        data: [
          row(60, at("2026-03-01T00:00:00")),
          // 生效前撤销的修订不算
          row(99, at("2026-04-01T00:00:00"), at("2026-03-15T00:00:00")),
        ],
      });
      const points = async (local: string) => (await paramsAt(prisma, at(local))).adUnitPoints;
      expect(await points("2026-02-28T23:59:59")).toBe(50);
      expect(await points("2026-03-01T00:00:00")).toBe(60);
      expect(await points("2026-04-02T00:00:00")).toBe(60);
      // 别的键不受影响
      expect((await paramsAt(prisma, at("2026-04-02T00:00:00"))).adFreeRevisions).toBe(2);
      await expect(paramsAt(prisma, at("2025-12-31T00:00:00"))).rejects.toThrow(/没有生效的值/);
    },
    SLOW,
  );
});

describe("priceAt：剧目积分价 P(drama, t)", () => {
  it(
    "批读保留入参去重顺序、缺模板与无等级区分；custom不依赖模板，未来/取消行不覆盖",
    async () => {
      const time = at("2025-12-01T00:00:00");
      const plain = await make.drama({ heatTier: "S" });
      const noTier = await make.drama();
      const custom = await make.drama({ heatTier: "S" });
      const missing = uuidv7();
      const staff = await make.staff();
      const revision = {
        id: uuidv7(),
        dramaId: custom.id,
        mode: "custom",
        customPoints: 1900,
        newPoints: 1900,
        effectiveAt: time,
        reasonCode: "quality",
        createdByStaffId: staff.id,
        createdAt: time,
      };
      await prisma.dramaPriceRevision.createMany({
        data: [
          revision,
          {
            ...revision,
            id: uuidv7(),
            customPoints: 2900,
            newPoints: 2900,
            effectiveAt: at("2025-12-02T00:00:00"),
            cancelledAt: at("2025-12-01T12:00:00"),
          },
          {
            ...revision,
            id: uuidv7(),
            customPoints: 3900,
            newPoints: 3900,
            effectiveAt: at("2025-12-03T00:00:00"),
          },
        ],
      });
      const ids = [custom.id, missing, plain.id, noTier.id, custom.id];
      const prices = await priceAt(prisma, ids, at("2025-12-02T12:00:00"));
      expect([...prices.keys()]).toEqual(ids.slice(0, 4));
      expect(prices.get(custom.id)).toEqual({
        dramaId: custom.id,
        points: 1900,
        source: {
          mode: "custom",
          tier: "S",
          dramaPriceRevisionId: revision.id,
          tierRevisionId: null,
        },
      });
      expect(prices.get(missing)).toBe("not_found");
      expect(prices.get(plain.id)).toBe("no_template");
      expect(prices.get(noTier.id)).toBe("no_tier");
      await expect(
        prisma.dramaPriceRevision.create({
          data: {
            ...revision,
            id: uuidv7(),
            customPoints: null,
            effectiveAt: at("2025-12-04T00:00:00"),
          },
        }),
      ).rejects.toThrow(/ck_drama_price_revision_custom_points/);
      expect((await priceAt(prisma, [custom.id], time)).get(custom.id)).toEqual(
        prices.get(custom.id),
      );
    },
    SLOW,
  );
  it(
    "按模板：取该剧热度等级在 t 的模板价；模板价的新修订到点才算",
    async () => {
      const [s, c] = [await make.drama({ heatTier: "S" }), await make.drama({ heatTier: "C" })];
      const prices = await priceAt(prisma, [s.id, c.id, s.id], SEEDED);
      expect([...prices.keys()].sort()).toEqual([s.id, c.id].sort());
      expect(prices.get(s.id)).toMatchObject({
        dramaId: s.id,
        points: 3000,
        source: { mode: "template", tier: "S", dramaPriceRevisionId: null },
      });
      expect(prices.get(c.id)).toMatchObject({ points: 1000, source: { tier: "C" } });

      const revisionId = uuidv7();
      await prisma.priceTierRevision.create({
        data: {
          id: revisionId,
          tier: "C",
          points: 1200,
          effectiveAt: at("2026-05-01T00:00:00"),
          batchId: uuidv7(),
          createdAt: SEEDED,
        },
      });
      const price = async (local: string) => (await priceAt(prisma, [c.id], at(local))).get(c.id);
      expect(await price("2026-04-30T23:59:59")).toMatchObject({ points: 1000 });
      expect(await price("2026-05-01T00:00:00")).toMatchObject({
        points: 1200,
        source: { mode: "template", tier: "C", tierRevisionId: revisionId },
      });
    },
    SLOW,
  );

  it(
    "单剧修订优先：custom 取它的价；到点才算、撤销的不算；改回按模板即回到模板价",
    async () => {
      const drama = await make.drama({ heatTier: "A" });
      const staff = await make.staff();
      const revision = (
        mode: "custom" | "template",
        points: number,
        effectiveAt: Date,
        cancelledAt: Date | null = null,
      ) => ({
        id: uuidv7(),
        dramaId: drama.id,
        mode,
        customPoints: mode === "custom" ? points : null,
        prevPoints: mode === "custom" ? 2000 : 2500,
        newPoints: points,
        effectiveAt,
        reasonCode: mode === "custom" ? "quality" : "restore_template",
        cancelledAt,
        createdByStaffId: staff.id,
        createdAt: SEEDED,
      });
      const custom = revision("custom", 2500, at("2026-02-01T00:00:00"));
      const cancelled = revision(
        "custom",
        9000,
        at("2026-02-15T00:00:00"),
        at("2026-02-10T00:00:00"),
      );
      const restored = revision("template", 2000, at("2026-03-01T00:00:00"));
      await prisma.dramaPriceRevision.createMany({ data: [custom, cancelled, restored] });

      const price = async (local: string) =>
        (await priceAt(prisma, [drama.id], at(local))).get(drama.id);
      expect(await price("2026-01-31T23:59:59")).toMatchObject({
        points: 2000,
        source: { mode: "template", tier: "A", dramaPriceRevisionId: null },
      });
      expect(await price("2026-02-01T00:00:00")).toEqual({
        dramaId: drama.id,
        points: 2500,
        source: {
          mode: "custom",
          tier: "A",
          dramaPriceRevisionId: custom.id,
          tierRevisionId: null,
        },
      });
      expect(await price("2026-02-20T00:00:00")).toMatchObject({ points: 2500 });
      expect(await price("2026-03-01T00:00:00")).toMatchObject({
        points: 2000,
        source: { mode: "template", tier: "A", dramaPriceRevisionId: restored.id },
      });
    },
    SLOW,
  );

  it(
    "没有热度等级：只有生效的单剧修订才取得到价；没有这部剧、空的入参",
    async () => {
      const drama = await make.drama();
      expect(drama.heatTier).toBeNull();
      const missing = uuidv7();
      const before = await priceAt(prisma, [drama.id, missing], SEEDED);
      expect(before.get(drama.id)).toBe("no_tier");
      expect(before.get(missing)).toBe("not_found");
      expect((await priceAt(prisma, [], SEEDED)).size).toBe(0);

      const staff = await make.staff();
      await prisma.dramaPriceRevision.create({
        data: {
          id: uuidv7(),
          dramaId: drama.id,
          mode: "custom",
          customPoints: 1800,
          newPoints: 1800,
          effectiveAt: SEEDED,
          reasonCode: "genre_fit",
          createdByStaffId: staff.id,
          createdAt: SEEDED,
        },
      });
      expect((await priceAt(prisma, [drama.id], SEEDED)).get(drama.id)).toMatchObject({
        points: 1800,
        source: { mode: "custom", tier: null },
      });
    },
    SLOW,
  );
});
