// docs 的两条不变量（W1-03；13 分组 第 2.11、5.4 节）。都是 P2，只在 full 运行里查，不自愈；调度与落库由 ops（W0-24）。
//   docs.N4   每份协议任一时刻解析出的当前版本唯一；已发布版本的 content_sha256 与所挂 PDF 文件登记的哈希一致；
//             同意记录引用的版本都已发布且未撤回。
//   docs.N13  每条生效时间在未来的 pending 的 member、points 版本，其 site_notice_id 指向一条 announced 的公告。
// docs.N5（单据与同意记录对得上）不在这里：它要查付款单、订购单、广告三张上层表，docs 在 L1 读不到，归属随 G2-C 定。
import type { InvariantViolation, Tx } from "../kernel/index.js";

type Reader = Pick<Tx, "$queryRaw">;

interface Found {
  readonly id: string;
  readonly problem: string;
  readonly detail: Record<string, unknown>;
}

const toViolations = (rows: readonly Found[]): InvariantViolation[] =>
  rows.map((row) => ({
    subject: { type: "agreement_version", id: row.id },
    detail: { problem: row.problem, ...row.detail },
  }));

/** 每类至多报多少条 */
export const DOCS_INVARIANT_LIMIT = 200;

export interface DocsInvariantOptions {
  /** “现在”：不给即取数据库时间（登记给框架的检查项拿不到注入的时钟；用例里传可拨时钟的时刻） */
  readonly now?: Date;
}

async function nowOf(db: Reader, options: DocsInvariantOptions): Promise<Date> {
  if (options.now !== undefined) return options.now;
  const [row] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  if (row === undefined) throw new Error("取不到数据库时间");
  return row.now;
}

export async function findN4Violations(
  db: Reader,
  options: DocsInvariantOptions = {},
): Promise<InvariantViolation[]> {
  const now = await nowOf(db, options);
  // ① 同一协议里有两条都能被解析为当前版本：生效时间相同的 pending、active 并列第一
  const ties = await db.$queryRaw<Found[]>`
    WITH live AS (
      SELECT id, agreement_key, effective_at,
             rank() OVER (PARTITION BY agreement_key ORDER BY effective_at DESC) AS position
        FROM agreement_version
       WHERE status IN ('pending', 'active') AND effective_at <= ${now}
    )
    SELECT id::text AS id, 'current_version_not_unique' AS problem,
           jsonb_build_object('agreementKey', agreement_key, 'effectiveAt', effective_at) AS detail
      FROM live
     WHERE position = 1
       AND agreement_key IN (SELECT agreement_key FROM live WHERE position = 1
                              GROUP BY agreement_key HAVING count(*) > 1)
     ORDER BY agreement_key, id
     LIMIT ${DOCS_INVARIANT_LIMIT}`;
  // ② 已发布版本的内容哈希与所挂 PDF 文件登记的哈希不一致（文件行上没有哈希的不比）
  const hashes = await db.$queryRaw<Found[]>`
    SELECT v.id::text AS id, 'content_sha256_mismatch' AS problem,
           jsonb_build_object('agreementKey', v.agreement_key, 'pdfFileId', v.pdf_file_id) AS detail
      FROM agreement_version v
      JOIN file_object f ON f.id = v.pdf_file_id
     WHERE v.status IN ('pending', 'active', 'superseded')
       AND f.sha256 IS NOT NULL AND f.sha256 <> v.content_sha256
     ORDER BY v.id
     LIMIT ${DOCS_INVARIANT_LIMIT}`;
  // ③ 同意记录引用了草稿或已撤回的版本（写入时触发器已拦，这里兜底）
  const stale = await db.$queryRaw<Found[]>`
    SELECT v.id::text AS id, 'consent_on_unpublished_version' AS problem,
           jsonb_build_object('agreementKey', v.agreement_key, 'status', v.status,
                              'consents', count(*)) AS detail
      FROM agreement_version v
      JOIN agreement_consent c ON c.agreement_version_id = v.id
     WHERE v.status IN ('draft', 'withdrawn')
     GROUP BY v.id, v.agreement_key, v.status
     ORDER BY v.id
     LIMIT ${DOCS_INVARIANT_LIMIT}`;
  return toViolations([...ties, ...hashes, ...stale]);
}

export async function findN13Violations(
  db: Reader,
  options: DocsInvariantOptions = {},
): Promise<InvariantViolation[]> {
  const now = await nowOf(db, options);
  const rows = await db.$queryRaw<Found[]>`
    SELECT v.id::text AS id, 'pending_version_without_announced_notice' AS problem,
           jsonb_build_object('agreementKey', v.agreement_key, 'siteNoticeId', v.site_notice_id,
                              'noticeStatus', n.status) AS detail
      FROM agreement_version v
      LEFT JOIN site_notice n ON n.id = v.site_notice_id
     WHERE v.status = 'pending' AND v.effective_at > ${now}
       AND v.agreement_key IN ('member', 'points')
       AND (n.id IS NULL OR n.status <> 'announced')
     ORDER BY v.id
     LIMIT ${DOCS_INVARIANT_LIMIT}`;
  return toViolations(rows);
}
