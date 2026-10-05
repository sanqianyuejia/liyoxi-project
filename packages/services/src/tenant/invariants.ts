// tenant 在 M1 登记的四条不变量（W1-03；02 分组 第 2.9、2.11 节与第 5 节“不变量登记”）。
// 都是 P2，只在 full 运行里查，不自愈；调度与落库由 ops（W0-24）。对象属于主体的带 entityId。
//   tenant.I1   每个 active 主体恰有 1 位有效老板
//   tenant.I7   已认证主体信用代码的唯一索引存在
//   tenant.I27  每个主体恰有一家首店
//   tenant.I29  老板没有 store_member 行
// I5、I17、I28、I30 的对象（店员、停用门店、已关闭主体、邀请）在 M1 不会出现，随 M2 登记。
import type { InvariantViolation, Tx } from "../kernel/index.js";

type Reader = Pick<Tx, "$queryRaw">;

/** 每条至多报多少个对象 */
export const TENANT_INVARIANT_LIMIT = 200;

export async function findI1Violations(db: Reader): Promise<InvariantViolation[]> {
  const rows = await db.$queryRaw<{ id: string; owners: number }[]>`
    SELECT e.id::text AS id, count(m.id)::int AS owners
      FROM entity e
      LEFT JOIN entity_member m
             ON m.entity_id = e.id AND m.status = 'active' AND m.role = 'owner'
     WHERE e.lifecycle = 'active'
     GROUP BY e.id
    HAVING count(m.id) <> 1
     ORDER BY e.id
     LIMIT ${TENANT_INVARIANT_LIMIT}`;
  return rows.map((row) => ({
    subject: { type: "entity", id: row.id },
    entityId: row.id,
    detail: { expected: 1, activeOwners: row.owners },
  }));
}

/** 唯一索引的名字（02 分组 第 2.9 节手写约束） */
export const USCC_UNIQUE_INDEX = "uq_entity_uscc_bidx_verified";

export async function findI7Violations(db: Reader): Promise<InvariantViolation[]> {
  const rows = await db.$queryRaw<{ found: number }[]>`
    SELECT count(*)::int AS found FROM pg_catalog.pg_indexes
     WHERE schemaname = current_schema() AND tablename = 'entity'
       AND indexname = ${USCC_UNIQUE_INDEX}`;
  return rows[0]?.found === 1
    ? []
    : [{ subject: { key: USCC_UNIQUE_INDEX }, detail: { problem: "unique_index_missing" } }];
}

export async function findI27Violations(db: Reader): Promise<InvariantViolation[]> {
  const rows = await db.$queryRaw<{ id: string; primaries: number }[]>`
    SELECT e.id::text AS id, count(s.id)::int AS primaries
      FROM entity e
      LEFT JOIN store s ON s.entity_id = e.id AND s.is_primary
     GROUP BY e.id
    HAVING count(s.id) <> 1
     ORDER BY e.id
     LIMIT ${TENANT_INVARIANT_LIMIT}`;
  return rows.map((row) => ({
    subject: { type: "entity", id: row.id },
    entityId: row.id,
    detail: { expected: 1, primaryStores: row.primaries },
  }));
}

export async function findI29Violations(db: Reader): Promise<InvariantViolation[]> {
  const rows = await db.$queryRaw<{ id: string; entityId: string; stores: number }[]>`
    SELECT m.id::text AS id, m.entity_id::text AS "entityId", count(*)::int AS stores
      FROM entity_member m
      JOIN store_member sm ON sm.entity_member_id = m.id
     WHERE m.status = 'active' AND m.role = 'owner'
     GROUP BY m.id, m.entity_id
     ORDER BY m.id
     LIMIT ${TENANT_INVARIANT_LIMIT}`;
  return rows.map((row) => ({
    subject: { type: "entity_member", id: row.id },
    entityId: row.entityId,
    detail: { expected: 0, storeMemberRows: row.stores },
  }));
}
