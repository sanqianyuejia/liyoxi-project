// 待同意的协议与指纹（W1-03；m01 第 2.5 节；m08 第 2.2 节）。只读、现算，不写库。
//
// 待同意：对每份用户级协议取当前版本 v：本人有 v 的同意记录即已同意；
// v 关了“需重新同意”（小修订）且本人同意过这份协议任一更早的版本，也算已同意；其余列入。
//
// 指纹：一组“协议键:当前版本 id”排序后拼起来的 SHA-256。两个，算法相同、输入不同：
//   user 用户级协议的当前版本集合：协议同意中间件拿它与 merchant_user.consent_stamp 比，常态只比一次字符串；
//   all  全部协议的当前版本集合：引导数据的 versions.agreement 用，端上据此知道该不该重拉协议清单。
// 当前版本集合一变，指纹就变。consent_stamp 由 identity 自己写，docs 只给指纹（13 分组 第 5.2 节）。
import { createHash } from "node:crypto";

import type { PendingConsent } from "@liyoxi/contract";

import { currentVersions, versionLabel } from "./versions.js";
import type { DocsReader, VersionRow } from "./versions.js";

export interface ConsentStamps {
  /** 用户级协议当前版本集合的指纹 */
  readonly user: string;
  /** 全部协议当前版本集合的指纹 */
  readonly all: string;
}

/** 一组当前版本的指纹：与传入的先后无关 */
export function stampOf(versions: readonly Pick<VersionRow, "agreementKey" | "id">[]): string {
  const lines = versions.map((version) => `${version.agreementKey}:${version.id}`).sort();
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

/** 用户级协议的键 */
async function userLevelKeys(db: DocsReader): Promise<Map<string, { name: string }>> {
  const agreements = await db.agreement.findMany({
    where: { subjectKind: "user" },
    orderBy: { sortNo: "asc" },
    select: { key: true, name: true },
  });
  return new Map(agreements.map((agreement) => [agreement.key, { name: agreement.name }]));
}

export async function consentStamps(db: DocsReader, now: Date): Promise<ConsentStamps> {
  const current = await currentVersions(db, now);
  const userKeys = await userLevelKeys(db);
  const all = [...current.values()];
  return {
    user: stampOf(all.filter((version) => userKeys.has(version.agreementKey))),
    all: stampOf(all),
  };
}

/** 本人此刻待同意的用户级协议，按 agreement.sort_no */
export async function pendingConsents(
  db: DocsReader,
  now: Date,
  merchantUserId: string,
): Promise<PendingConsent[]> {
  const userKeys = await userLevelKeys(db);
  const current = await currentVersions(db, now);
  // 本人对用户级协议的全部同意记录（一份协议一个版本至多一条），连同那个版本的生效时间
  const consents = await db.agreementConsent.findMany({
    where: { merchantUserId, agreementKey: { in: [...userKeys.keys()] } },
    select: {
      agreementKey: true,
      agreementVersionId: true,
      agreementVersion: { select: { effectiveAt: true } },
    },
  });
  const pending: PendingConsent[] = [];
  for (const [key, agreement] of userKeys) {
    const version = current.get(key);
    // 尚无已生效版本的协议端上不展示，也谈不上待同意
    if (version === undefined || version.effectiveAt === null || version.summary === null) continue;
    const mine = consents.filter((consent) => consent.agreementKey === key);
    const effectiveAt = version.effectiveAt;
    const consented =
      mine.some((consent) => consent.agreementVersionId === version.id) ||
      (!version.isReconsentRequired &&
        mine.some((consent) => {
          const at = consent.agreementVersion.effectiveAt;
          return at !== null && at.getTime() < effectiveAt.getTime();
        }));
    if (consented) continue;
    pending.push({
      agreementKey: key,
      agreementVersionId: version.id,
      name: agreement.name,
      versionLabel: versionLabel(version),
      effectiveAt: effectiveAt.toISOString(),
      summary: version.summary,
    });
  }
  return pending;
}
