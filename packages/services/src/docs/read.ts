// 协议的读侧（W1-03）：协议清单与版本正文，两条公开接口的取数（m01 第 3.12、3.13 节）。只读。
import type {
  AgreementCurrent,
  AgreementVersionBrief,
  AgreementVersionDetail,
  AgreementVersionPhase,
} from "@liyoxi/contract";

import { AppError } from "../kernel/index.js";
import { pageOf } from "./cursor.js";
import type { Page } from "./cursor.js";
import { currentVersions, upcomingVersions, versionLabel } from "./versions.js";
import type { DocsReader, VersionRow } from "./versions.js";

/** 协议 PDF 读地址的有效期（裁决 A125） */
export const AGREEMENT_PDF_URL_TTL_MS = 30 * 60_000;

export interface AgreementListQuery {
  /** 协议键；多值逗号分隔 */
  readonly agreementKey?: string | undefined;
  /** 签署场景：agreement.scenes 含它 */
  readonly scene?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

function briefOf(version: VersionRow | undefined): AgreementVersionBrief | null {
  // 能被解析到的版本都离开了草稿：生效时间与摘要必有（ck_agreement_version_effective_at、_published）
  if (version === undefined || version.effectiveAt === null || version.summary === null) return null;
  return {
    agreementVersionId: version.id,
    versionLabel: versionLabel(version),
    effectiveAt: version.effectiveAt.toISOString(),
    summary: version.summary,
    isReconsentRequired: version.isReconsentRequired,
  };
}

/** 当前生效的协议：按 agreement.sort_no；两个筛选都不传即全部 */
export async function listAgreements(
  db: DocsReader,
  now: Date,
  query: AgreementListQuery,
): Promise<Page<AgreementCurrent>> {
  const keys = query.agreementKey?.split(",");
  const agreements = await db.agreement.findMany({
    where: {
      ...(keys === undefined ? {} : { key: { in: keys } }),
      ...(query.scene === undefined ? {} : { scenes: { has: query.scene } }),
    },
    orderBy: { sortNo: "asc" },
  });
  const current = await currentVersions(db, now);
  const upcoming = await upcomingVersions(db, now);
  const items = agreements.map(
    (agreement): AgreementCurrent => ({
      agreementKey: agreement.key,
      name: agreement.name,
      // 三列在库里各有 CHECK，取值就是契约的枚举
      subjectKind: agreement.subjectKind as AgreementCurrent["subjectKind"],
      consentMode: agreement.consentMode as AgreementCurrent["consentMode"],
      scenes: agreement.scenes as AgreementCurrent["scenes"],
      currentVersion: briefOf(current.get(agreement.key)),
      upcomingVersion: briefOf(upcoming.get(agreement.key)),
    }),
  );
  return pageOf(items, query.cursor, query.limit);
}

/** 可读的版本：待生效（含已排期未生效的）、生效中、已失效；草稿与已撤回按不存在 */
const READABLE_STATUSES = ["pending", "active", "superseded"];

/** 协议版本的正文：阶段按生效时间现算，不用簿记列 */
export async function getAgreementVersion(
  db: DocsReader,
  now: Date,
  agreementVersionId: string,
): Promise<AgreementVersionDetail> {
  const version = await db.agreementVersion.findUnique({
    where: { id: agreementVersionId },
    include: { agreement: { select: { name: true } } },
  });
  if (
    version === null ||
    !READABLE_STATUSES.includes(version.status) ||
    version.effectiveAt === null ||
    version.summary === null ||
    version.contentSha256 === null
  ) {
    throw new AppError("NOT_FOUND");
  }
  let phase: AgreementVersionPhase = "superseded";
  if (version.effectiveAt.getTime() > now.getTime()) phase = "upcoming";
  else if ((await currentVersions(db, now)).get(version.agreementKey)?.id === version.id) {
    phase = "current";
  }
  return {
    agreementVersionId: version.id,
    agreementKey: version.agreementKey,
    name: version.agreement.name,
    versionLabel: versionLabel(version),
    major: version.major,
    minor: version.minor,
    phase,
    effectiveAt: version.effectiveAt.toISOString(),
    summary: version.summary,
    isReconsentRequired: version.isReconsentRequired,
    contentHtml: version.contentHtml,
    contentSha256: version.contentSha256,
    // 留桩：PDF 的签名读地址要经 media 现签，docs → media 不在同层白名单里（06 第 3.6 节），随 G2-B 定走法。
    // 现在地址为空串，端上只展示 contentHtml（docs/plan/stubs/m2-docs-agreement-pdf-url.md）
    pdf: { url: "", expiresAt: new Date(now.getTime() + AGREEMENT_PDF_URL_TTL_MS).toISOString() },
  };
}
