// 协议占位版本的用例（任务书 W1-03 第 7 节验收 11），顺带验 notices.announce 的最小实现（14 分组 第 2.6 节）。
// 在带 W0-21 种子的库上跑：员工与六份占位 PDF 的文件行由用例自己造。
import { createHash } from "node:crypto";

import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { createNotices } from "../config/index.js";
import type { Notices } from "../config/index.js";
import { createEvents } from "../events/index.js";
import { createIdentityContext, createTxRunner } from "../kernel/index.js";
import type { TxRunner } from "../kernel/index.js";
import {
  assembleForTest,
  createClock,
  createFactories,
  useSeededDatabase,
} from "../testing/index.js";
import type { AdjustableClock, Factories } from "../testing/index.js";
import {
  AGREEMENT_SEEDS,
  createDocs,
  findN13Violations,
  findN4Violations,
  seedPlaceholderAgreementVersions,
} from "./index.js";
import type { PlaceholderSeedInput } from "./index.js";

const db = useSeededDatabase("services");
const SLOW = 60_000;
const ctx = createIdentityContext({ actor: { type: "system", job: "docs.demo_seed" } });

let prisma: PrismaClient;
let clock: AdjustableClock;
let make: Factories;
let tx: TxRunner;
let notices: Notices;
let input: PlaceholderSeedInput;

beforeAll(async () => {
  prisma = await db.prisma();
  clock = createClock();
  make = createFactories({ db: prisma, clock });
  tx = createTxRunner({ prisma, appEnv: "test" });
  const assembly = assembleForTest({ entry: "worker" });
  notices = createNotices({ clock, events: createEvents({ assembly, clock, tx }) });
  const staff = await make.staff({ staffRoleKey: "super_admin" });
  const files: Record<string, { pdfFileId: string; sha256: string }> = {};
  for (const seed of AGREEMENT_SEEDS) {
    const sha256 = createHash("sha256").update(`placeholder:${seed.key}`).digest("hex");
    const file = await make.fileObject({
      bucket: "secure",
      category: "legal_doc",
      ext: "pdf",
      sha256,
    });
    files[seed.key] = { pdfFileId: file.id, sha256 };
  }
  input = { staffId: staff.id, files };
}, SLOW);

const seed = (appEnv: "test" | "prod" = "test") =>
  tx.run((handle) =>
    seedPlaceholderAgreementVersions(handle, ctx, { clock, notices, appEnv }, input),
  );

describe("协议的占位版本", () => {
  it(
    "六份协议各有当前版本；再跑一遍新增 0 行；docs.N4、docs.N13 0 违规",
    async () => {
      await expect(seed("prod")).rejects.toThrow(/生产环境拒绝/);
      expect(await prisma.agreementVersion.count()).toBe(0);

      expect(await seed()).toEqual([
        { table: "agreement_version", inserted: 6, existing: 0 },
        { table: "site_notice", inserted: 2, existing: 0 },
      ]);
      const docs = createDocs({ tx, clock });
      const current = await docs.currentVersions(prisma);
      expect([...current.keys()].sort()).toEqual(AGREEMENT_SEEDS.map((item) => item.key).sort());
      const list = await docs.listAgreements({ limit: 20 });
      expect(list.items.every((item) => item.currentVersion?.versionLabel === "v1.0")).toBe(true);

      const member = current.get("member");
      const detail = await docs.getAgreementVersion(member?.id ?? "");
      expect(detail).toMatchObject({ phase: "current", contentSha256: input.files.member?.sha256 });
      expect(detail.contentHtml).toContain("占位");
      // member、points 挂了公告：已公告、首页公告条关着、公告期 0 天并写了原因；各发一条 site_notice.announced
      const announced = await prisma.siteNotice.findMany({ orderBy: { title: "asc" } });
      expect(announced).toHaveLength(2);
      for (const notice of announced) {
        expect(notice).toMatchObject({
          kind: "agreement_version",
          status: "announced",
          barEnabled: false,
          leadDays: 0,
          createdByStaffId: input.staffId,
        });
        expect(notice.shortNoticeReason).toContain("占位");
      }
      const events = await prisma.outboxEvent.findMany({
        where: { eventType: "site_notice.announced" },
      });
      expect(events.map((event) => event.aggregateId).sort()).toEqual(
        announced.map((notice) => notice.id).sort(),
      );
      expect(events[0]?.payload).toMatchObject({ v: 1, kind: "agreement_version" });

      // 再跑一遍：新增 0 行
      clock.advance(60_000);
      expect(await seed()).toEqual([
        { table: "agreement_version", inserted: 0, existing: 6 },
        { table: "site_notice", inserted: 0, existing: 2 },
      ]);
      expect(await prisma.agreementVersion.count()).toBe(6);
      expect(await prisma.siteNotice.count()).toBe(2);
      expect(await prisma.outboxEvent.count({ where: { eventType: "site_notice.announced" } })).toBe(2);

      const now = clock.now();
      expect(await findN4Violations(prisma, { now })).toEqual([]);
      expect(await findN13Violations(prisma, { now })).toEqual([]);
    },
    SLOW,
  );

  it(
    "notices.announce：同一变更重复公告返回同一行；撤回后可再公告；docs.N13 报出公告被撤回的待生效版本",
    async () => {
      const points = await prisma.agreementVersion.findFirstOrThrow({
        where: { agreementKey: "points" },
      });
      const again = await tx.run((handle) =>
        notices.announce(handle, ctx, {
          kind: "agreement_version",
          refId: points.id,
          title: "重复公告",
          summary: "同一变更再公告一次",
          effectiveAt: clock.now(),
          link: { route: "agreement.version", params: {} },
          createdByStaffId: input.staffId,
        }),
      );
      expect(again).toEqual({ siteNoticeId: points.siteNoticeId, created: false });
      expect(await prisma.siteNotice.count()).toBe(2);

      // 站在占位版本生效之前看：两份都是“排在将来的待生效版本”，公告都在，0 违规；撤回其中一条公告即被报出
      const before = new Date(points.effectiveAt === null ? 0 : points.effectiveAt.getTime() - 1);
      expect(await findN13Violations(prisma, { now: before })).toEqual([]);
      const now = clock.now();
      await prisma.siteNotice.update({
        where: { id: points.siteNoticeId ?? "" },
        data: {
          status: "withdrawn",
          withdrawnAt: now,
          withdrawnByStaffId: input.staffId,
          updatedAt: now,
        },
      });
      expect(await findN13Violations(prisma, { now: before })).toEqual([
        {
          subject: { type: "agreement_version", id: points.id },
          detail: {
            problem: "pending_version_without_announced_notice",
            agreementKey: "points",
            siteNoticeId: points.siteNoticeId,
            noticeStatus: "withdrawn",
          },
        },
      ]);
      // 已生效的版本不在 N13 之内
      expect(await findN13Violations(prisma, { now })).toEqual([]);
      // 撤回后同一变更可以再公告：新建一行
      const renewed = await tx.run((handle) =>
        notices.announce(handle, ctx, {
          kind: "agreement_version",
          refId: points.id,
          title: "再次公告",
          summary: "撤回后重新公告",
          effectiveAt: new Date(now.getTime() + 86_400_000 * 40),
          link: { route: "agreement.version", params: {} },
          createdByStaffId: input.staffId,
        }),
      );
      expect(renewed.created).toBe(true);
      const row = await prisma.siteNotice.findUniqueOrThrow({ where: { id: renewed.siteNoticeId } });
      expect(row).toMatchObject({ leadDays: 40, barEnabled: true, shortNoticeReason: null });
    },
    SLOW,
  );
});
