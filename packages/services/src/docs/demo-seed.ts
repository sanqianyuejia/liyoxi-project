// 协议的占位版本（W1-03 的演示种子；任务书 第 10 节第 5、6 项）：六份协议各一个版本，正文是带“占位”字样的 HTML。
// 法务的正式文本到位（E8）之前，本地与预发靠它才登录得了、下得了单；M2 起经后台的协议管理录入正式版本。
// 只进本地、测试与预发：appEnv 是 prod 即拒绝。不是 W0-21 的种子（seed.ts 只播协议清单），由演示种子的运行器调。
//
//   await tx.run((handle) => seedPlaceholderAgreementVersions(handle, ctx, { clock, notices, appEnv }, { staffId, files }));
//
// 调用方给：一位员工的 id（建版本的人与发布人），六份占位 PDF 的文件行与各自的 SHA-256（协议版本要这两样外键；
// 文件的入库走 media 的 putSystemFile，接线在 W1-07）。
// 没有才插：某份协议已有离开草稿、没撤回的版本就跳过它，所以可以重复跑，新增 0 行。
// 版本直接以 pending、effective_at = 播种时刻插入：按“当前版本”的口径它立刻就是当前版本，簿记列不用翻。
// member、points 两份库里要求挂公告：经 notices.announce 各建一条（首页公告条关掉）。
import { createHash } from "node:crypto";

import type { Notices } from "../config/index.js";
import { uuidv7 } from "../kernel/index.js";
import type { AppEnv, Clock, IdentityContext, SeedTableResult, Tx } from "../kernel/index.js";
import { AGREEMENT_SEEDS } from "./seed.js";

/** 要挂规则变更公告的两份协议（13 分组 第 2.11 节 ck_agreement_version_notice） */
const ANNOUNCED_KEYS: readonly string[] = ["member", "points"];

export const PLACEHOLDER_SUMMARY = "占位版本：正式文本由法务出稿后替换";
export const PLACEHOLDER_SHORT_NOTICE_REASON = "占位版本，只用于本地与预发，不走公告期";

/** 一份占位 PDF：文件行的 id 与文件字节的 SHA-256（十六进制小写 64 位） */
export interface PlaceholderFile {
  readonly pdfFileId: string;
  readonly sha256: string;
  /** 展示版 HTML 的来源文件（库里要求有展示版必有来源文件）；占位版本没有 Word，不给即记同一份占位 PDF */
  readonly sourceFileId?: string;
}

export interface PlaceholderSeedInput {
  /** 建版本的员工，也记作发布人 */
  readonly staffId: string;
  /** 协议键 → 占位 PDF；六份都要给 */
  readonly files: Readonly<Record<string, PlaceholderFile>>;
}

export interface PlaceholderSeedDeps {
  readonly clock: Clock;
  readonly notices: Pick<Notices, "announce">;
  readonly appEnv: AppEnv;
}

/** 占位正文：一眼看得出不是正式文本 */
export const placeholderHtml = (name: string): string =>
  `<h1>${name}（占位）</h1>` +
  `<p>本文为占位文本，仅用于本地开发与预发环境的流程演示，不具有法律效力。</p>` +
  `<p>正式文本由法务审定后经后台“协议管理”发布，届时本版本即被取代。</p>`;

export async function seedPlaceholderAgreementVersions(
  tx: Tx,
  ctx: IdentityContext,
  deps: PlaceholderSeedDeps,
  input: PlaceholderSeedInput,
): Promise<SeedTableResult[]> {
  if (deps.appEnv === "prod") throw new Error("协议的占位版本只进本地、测试与预发，生产环境拒绝");
  const missingFile = AGREEMENT_SEEDS.find((seed) => input.files[seed.key] === undefined);
  if (missingFile !== undefined) throw new TypeError(`缺协议 ${missingFile.key} 的占位 PDF 文件行`);

  const now = deps.clock.now();
  const taken = new Set(
    (
      await tx.agreementVersion.findMany({
        where: { status: { in: ["pending", "active", "superseded"] } },
        select: { agreementKey: true },
        distinct: ["agreementKey"],
      })
    ).map((row) => row.agreementKey),
  );
  let versions = 0;
  let notices = 0;
  for (const seed of AGREEMENT_SEEDS) {
    if (taken.has(seed.key)) continue;
    const file = input.files[seed.key] as PlaceholderFile;
    const id = uuidv7();
    const html = placeholderHtml(seed.name);
    let siteNoticeId: string | null = null;
    if (ANNOUNCED_KEYS.includes(seed.key)) {
      const announced = await deps.notices.announce(tx, ctx, {
        kind: "agreement_version",
        refId: id,
        title: `${seed.name}占位版本`,
        summary: PLACEHOLDER_SUMMARY,
        effectiveAt: now,
        shortNoticeReason: PLACEHOLDER_SHORT_NOTICE_REASON,
        link: { route: "agreement.version", params: { agreementVersionId: id } },
        barEnabled: false,
        createdByStaffId: input.staffId,
      });
      siteNoticeId = announced.siteNoticeId;
      if (announced.created) notices += 1;
    }
    await tx.agreementVersion.create({
      data: {
        id,
        agreementKey: seed.key,
        major: 1,
        minor: 0,
        status: "pending",
        effectiveAt: now,
        summary: PLACEHOLDER_SUMMARY,
        isReconsentRequired: true,
        sourceFileId: file.sourceFileId ?? file.pdfFileId,
        pdfFileId: file.pdfFileId,
        contentHtml: html,
        contentSha256: file.sha256,
        htmlSha256: createHash("sha256").update(html, "utf8").digest("hex"),
        isLegalApproved: true,
        siteNoticeId,
        shortNoticeReason: siteNoticeId === null ? null : PLACEHOLDER_SHORT_NOTICE_REASON,
        createdByStaffId: input.staffId,
        publishedByStaffId: input.staffId,
        createdAt: now,
        updatedAt: now,
      },
    });
    versions += 1;
  }
  const expectedNotices = AGREEMENT_SEEDS.filter((seed) => ANNOUNCED_KEYS.includes(seed.key)).length;
  return [
    {
      table: "agreement_version",
      inserted: versions,
      existing: AGREEMENT_SEEDS.length - versions,
    },
    { table: "site_notice", inserted: notices, existing: expectedNotices - notices },
  ];
}
