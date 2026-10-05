// 已签署协议的读（W1-03；m01 第 2.10、3.15、3.16 节）。一行是一份协议，不是一条同意记录。
//
//   老板：本主体的主体级协议（含前任老板签的）与本人的用户级协议；
//   店员：只有本人的用户级协议，记录里没有 bizType、bizNo、bizTitle（不给店员任何交易单号，约定 C57）。
//
// 这里按观察者角色给出两种形状；接口层最后一道裁剪（respondByRole）在 W1-04。
// 只列有同意记录的协议；计数与老板视图的行数同口径。
import type {
  ConsentRecord,
  ConsentRecordForClerk,
  SignedAgreementItem,
  SignedAgreementItemForClerk,
  SignedAgreementList,
} from "@liyoxi/contract";

import { pageOf } from "./cursor.js";
import { currentVersions, versionLabel } from "./versions.js";
import type { DocsReader } from "./versions.js";

/** 谁在看。接口是 member：老板与店员都有主体 */
export interface SignedAgreementViewer {
  readonly role: "owner" | "clerk";
  readonly merchantUserId: string;
  readonly entityId: string;
}

export interface SignedAgreementFilter {
  readonly subjectKind?: "user" | "entity" | undefined;
  readonly agreementKey?: string | undefined;
}

export interface SignedAgreementQuery extends SignedAgreementFilter {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

const CONSENT_COLUMNS = {
  seq: true,
  consentedAt: true,
  scene: true,
  method: true,
  bizType: true,
  bizNo: true,
  agreementVersion: { select: { id: true, major: true, minor: true, effectiveAt: true } },
} as const;

/** 老板视图的各行，已按“主体级在前、用户级在后，同类内按 sort_no”排好 */
async function ownerItems(
  db: DocsReader,
  now: Date,
  viewer: Pick<SignedAgreementViewer, "merchantUserId"> & { entityId: string | null },
  filter: SignedAgreementFilter,
): Promise<SignedAgreementItem[]> {
  const agreements = await db.agreement.findMany({
    where: {
      subjectKind: filter.subjectKind ?? { in: ["user", "entity"] },
      ...(filter.agreementKey === undefined ? {} : { key: filter.agreementKey }),
    },
    orderBy: { sortNo: "asc" },
  });
  const current = await currentVersions(db, now);
  const items: SignedAgreementItem[] = [];
  for (const agreement of agreements) {
    // 主体级看主体（含前任老板签的），用户级看本人；没有主体的观察者（店员视图借用本函数时）看不到主体级
    const scope =
      agreement.subjectKind === "entity"
        ? viewer.entityId === null
          ? null
          : { entityId: viewer.entityId }
        : { merchantUserId: viewer.merchantUserId };
    if (scope === null) continue;
    const where = { agreementKey: agreement.key, ...scope };
    const latest = await db.agreementConsent.findFirst({
      where,
      orderBy: [{ consentedAt: "desc" }, { seq: "desc" }],
      select: CONSENT_COLUMNS,
    });
    if (latest === null) continue;
    const first =
      (await db.agreementConsent.findFirst({
        where,
        orderBy: [{ consentedAt: "asc" }, { seq: "asc" }],
        select: CONSENT_COLUMNS,
      })) ?? latest;
    const record = (row: typeof latest): ConsentRecord => ({
      consentNo: row.seq.toString(),
      consentedAt: row.consentedAt.toISOString(),
      scene: row.scene as ConsentRecord["scene"],
      method: row.method as ConsentRecord["method"],
      versionLabel: versionLabel(row.agreementVersion),
      bizType: row.bizType as ConsentRecord["bizType"],
      bizNo: row.bizNo,
      // 留桩：付款单的标题要经 billing 取（docs 在 L1 读不到付款单），随 G4-C 的合同页接上
      bizTitle: null,
    });
    const consented = latest.agreementVersion;
    const currentVersionId = current.get(agreement.key)?.id ?? null;
    items.push({
      agreementKey: agreement.key,
      name: agreement.name,
      subjectKind: agreement.subjectKind as SignedAgreementItem["subjectKind"],
      consentedVersion: {
        agreementVersionId: consented.id,
        versionLabel: versionLabel(consented),
        // 同意记录引用的版本都已生效（库的插入触发器保证），生效时间必有
        effectiveAt: (consented.effectiveAt ?? latest.consentedAt).toISOString(),
      },
      currentVersionId,
      isCurrentVersionConsented: currentVersionId === consented.id,
      latestConsent: record(latest),
      firstConsent: record(first),
    });
  }
  // 画板的次序：主体级在前、用户级在后；同类内保持 sort_no
  return [
    ...items.filter((item) => item.subjectKind === "entity"),
    ...items.filter((item) => item.subjectKind !== "entity"),
  ];
}

const forClerk = ({ consentNo, consentedAt, scene, method, versionLabel: label }: ConsentRecord): ConsentRecordForClerk => ({
  consentNo,
  consentedAt,
  scene,
  method,
  versionLabel: label,
});

/** 已签署协议：按观察者角色返回两种形状 */
export async function listSignedAgreements(
  db: DocsReader,
  now: Date,
  viewer: SignedAgreementViewer,
  query: SignedAgreementQuery,
): Promise<SignedAgreementList> {
  if (viewer.role === "owner") {
    const page = pageOf(await ownerItems(db, now, viewer, query), query.cursor, query.limit);
    return { viewerRole: "owner", ...page };
  }
  // 店员：只看本人的用户级协议（筛选给了 entity 即空）；每条记录去掉三个单据字段
  const own =
    query.subjectKind === "entity"
      ? []
      : await ownerItems(
          db,
          now,
          { merchantUserId: viewer.merchantUserId, entityId: null },
          { ...query, subjectKind: "user" },
        );
  const items = own.map(
    (item): SignedAgreementItemForClerk => ({
      ...item,
      latestConsent: forClerk(item.latestConsent),
      firstConsent: forClerk(item.firstConsent),
    }),
  );
  return { viewerRole: "clerk", ...pageOf(items, query.cursor, query.limit) };
}

/** 合同页“协议 · N”的计数：按协议计，与老板视图的行数一致 */
export async function countSignedAgreements(
  db: DocsReader,
  now: Date,
  viewer: Pick<SignedAgreementViewer, "merchantUserId" | "entityId">,
  filter: SignedAgreementFilter,
): Promise<{ all: number }> {
  return { all: (await ownerItems(db, now, viewer, filter)).length };
}
