import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, expect, it } from "vitest";
import { createTxRunner, uuidv7 } from "../kernel/index.js";
import type { TxRunner } from "../kernel/index.js";
import { createClock, createFactories, useSeededDatabase } from "../testing/index.js";
import type { Factories } from "../testing/index.js";
import { dramaFacts, orderableFacts } from "./checks.js";

const database = useSeededDatabase("services");
const clock = createClock();
let db: PrismaClient, tx: TxRunner, make: Factories;
beforeAll(async () => {
  db = await database.prisma();
  tx = createTxRunner({ prisma: db, appEnv: "test" });
  make = createFactories({ db, clock });
}, 120_000);

it("可订批读与完整事实投影相同：缺版权/可空日期、活动许可过滤与排序、真实日期", async () => {
  const drama = await make.drama({ status: "draft" });
  const compare = () =>
    tx.run(async (handle) => {
      const old = await dramaFacts(handle, drama.id);
      const {
        status,
        archivedAt,
        title,
        totalEpisodes,
        dramaClass,
        genreCodes,
        posterFileId,
        allowedPlacements,
        isAiGenerated,
      } = old.drama;
      const expected = {
        drama: {
          status,
          archivedAt,
          title,
          totalEpisodes,
          dramaClass,
          genreCodes,
          posterFileId,
          allowedPlacements,
          isAiGenerated,
        },
        copyright: old.copyright
          ? {
              licenseEndDate: old.copyright.licenseEndDate,
              platforms: old.copyright.platforms,
            }
          : null,
        permits: old.permits.map(({ platform, permitKind, permitNo, status: permitStatus }) => ({
          platform,
          permitKind,
          permitNo,
          status: permitStatus,
        })),
      };
      expect(await orderableFacts(handle, drama.id)).toEqual(expected);
      return expected;
    });
  expect((await compare()).copyright).toBeNull();
  await db.dramaCopyright.create({
    data: {
      dramaId: drama.id,
      platforms: [],
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
  });
  expect((await compare()).copyright).toEqual({ licenseEndDate: null, platforms: [] });
  const ids = [uuidv7(), uuidv7(), uuidv7()];
  await db.dramaPermit.createMany({
    data: [...ids].reverse().map((id, index) => ({
      id,
      dramaId: drama.id,
      platform: index === 0 ? "all" : "douyin",
      permitKind: "approval_no",
      permitNo: `批读许可${index}`,
      status: index === 1 ? "retired" : "active",
      retiredAt: index === 1 ? clock.now() : null,
      retireReason: index === 1 ? "测试停用" : null,
      createdByStaffId: drama.createdByStaffId,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    })),
  });
  const end = new Date("2028-02-29T00:00:00.000Z");
  await db.dramaCopyright.update({
    where: { dramaId: drama.id },
    data: {
      licenseEndDate: end,
      platforms: ["wechat_channels", "douyin"],
    },
  });
  await db.drama.update({
    where: { id: drama.id },
    data: { title: "当前标题", totalEpisodes: null },
  });
  const facts = await compare();
  expect(facts.copyright?.licenseEndDate).toEqual(end);
  expect(facts.copyright?.licenseEndDate).toBeInstanceOf(Date);
  expect(facts.permits).toHaveLength(2);
  expect(facts.drama).toMatchObject({ title: "当前标题", totalEpisodes: null });
});

it("可订批读缺剧仍是原NOT_FOUND", async () => {
  await expect(tx.run((handle) => orderableFacts(handle, uuidv7()))).rejects.toMatchObject({
    error: "NOT_FOUND",
  });
});
