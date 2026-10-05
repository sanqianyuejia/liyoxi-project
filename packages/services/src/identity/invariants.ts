// identity 在 M1 登记的五条不变量（W1-04；02 分组 第 2.1–2.3 节与第 5 节“不变量登记”）。
// 都是 P2，只在 full 运行里查，不自愈；调度与落库由 ops（W0-24）。账号不属于主体：不带 entityId。
//   identity.I8   手机号唯一索引存在
//   identity.I9   (appid, openid) 唯一索引存在
//   identity.I22  deleted 账号没有未吊销的会话与下载页会话（disabled 靠每请求校验拦，不在这里报）
//   identity.I23  来源类型与命中的登记码一致
//   identity.I25  每个微信身份未吊销的会话不超过 5 条
// I24（注销后的清理）等的对象在 M1 不会出现，随 M2 登记。
import type { InvariantViolation, Tx } from "../kernel/index.js";
import { MAX_SESSIONS_PER_IDENTITY } from "./sessions.js";

type Reader = Pick<Tx, "$queryRaw">;

/** 每条至多报多少个对象 */
export const IDENTITY_INVARIANT_LIMIT = 200;

export const PHONE_UNIQUE_INDEX = "uq_merchant_user_phone_bidx";
export const OPENID_UNIQUE_INDEX = "uq_wechat_identity_appid_openid";

async function uniqueIndexViolations(
  db: Reader,
  table: string,
  index: string,
): Promise<InvariantViolation[]> {
  const rows = await db.$queryRaw<{ found: number }[]>`
    SELECT count(*)::int AS found
      FROM pg_catalog.pg_indexes i
      JOIN pg_catalog.pg_class c ON c.relname = i.indexname
      JOIN pg_catalog.pg_index x ON x.indexrelid = c.oid AND x.indisunique
     WHERE i.schemaname = current_schema() AND i.tablename = ${table} AND i.indexname = ${index}`;
  return rows[0]?.found === 1
    ? []
    : [{ subject: { key: index }, detail: { problem: "unique_index_missing" } }];
}

export const findI8Violations = (db: Reader): Promise<InvariantViolation[]> =>
  uniqueIndexViolations(db, "merchant_user", PHONE_UNIQUE_INDEX);

export const findI9Violations = (db: Reader): Promise<InvariantViolation[]> =>
  uniqueIndexViolations(db, "wechat_identity", OPENID_UNIQUE_INDEX);

export async function findI22Violations(db: Reader): Promise<InvariantViolation[]> {
  const rows = await db.$queryRaw<{ id: string; sessions: number; portal: number }[]>`
    SELECT u.id::text AS id,
           (SELECT count(*)::int FROM user_session s
             WHERE s.merchant_user_id = u.id AND s.revoked_at IS NULL) AS sessions,
           (SELECT count(*)::int FROM portal_session p
             WHERE p.approved_by_user_id = u.id AND p.revoked_at IS NULL) AS portal
      FROM merchant_user u
     WHERE u.status = 'deleted'
       AND (EXISTS (SELECT 1 FROM user_session s
                     WHERE s.merchant_user_id = u.id AND s.revoked_at IS NULL)
         OR EXISTS (SELECT 1 FROM portal_session p
                     WHERE p.approved_by_user_id = u.id AND p.revoked_at IS NULL))
     ORDER BY u.id
     LIMIT ${IDENTITY_INVARIANT_LIMIT}`;
  return rows.map((row) => ({
    subject: { type: "merchant_user", id: row.id },
    detail: { liveSessions: row.sessions, livePortalSessions: row.portal },
  }));
}

export async function findI23Violations(db: Reader): Promise<InvariantViolation[]> {
  const rows = await db.$queryRaw<{ id: string; sourceType: string; codeSourceType: string }[]>`
    SELECT u.id::text AS id, u.source_type AS "sourceType", r.source_type AS "codeSourceType"
      FROM merchant_user u
      JOIN referral_code r ON r.id = u.source_referral_code_id
     WHERE u.source_type <> r.source_type
     ORDER BY u.id
     LIMIT ${IDENTITY_INVARIANT_LIMIT}`;
  return rows.map((row) => ({
    subject: { type: "merchant_user", id: row.id },
    detail: { sourceType: row.sourceType, referralCodeSourceType: row.codeSourceType },
  }));
}

export async function findI25Violations(db: Reader): Promise<InvariantViolation[]> {
  const rows = await db.$queryRaw<{ id: string; live: number }[]>`
    SELECT s.wechat_identity_id::text AS id, count(*)::int AS live
      FROM user_session s
     WHERE s.revoked_at IS NULL AND s.wechat_identity_id IS NOT NULL
     GROUP BY s.wechat_identity_id
    HAVING count(*) > ${MAX_SESSIONS_PER_IDENTITY}
     ORDER BY s.wechat_identity_id
     LIMIT ${IDENTITY_INVARIANT_LIMIT}`;
  return rows.map((row) => ({
    subject: { type: "wechat_identity", id: row.id },
    detail: { limit: MAX_SESSIONS_PER_IDENTITY, liveSessions: row.live },
  }));
}
