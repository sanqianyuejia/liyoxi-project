// 加锁函数（W0-07）：SELECT … FOR UPDATE、FOR SHARE，锁序断言挂在它上面（06 第 5 节；ADR-012）。
// 多行加锁只走这里：表限定在加锁顺序表之内，同一张表的多行按主键升序。
import { assertLockOrder } from "./lock-order.js";
import type { LockTable } from "./lock-order.js";
import type { Tx } from "./tx.js";

/** 主键列不叫 id 的表 */
const KEY_COLUMN: Partial<Record<LockTable, string>> = {
  store_profile: "store_id",
  production_record: "file_id",
  billing_account: "entity_id",
};

/** lockRows 管的表：主键是单列 uuid。assignment_cursor 是复合主键，取号的地方自己写 SQL，先调 assertLockOrder */
export type RowLockTable = Exclude<LockTable, "assignment_cursor">;

/** update：FOR UPDATE，要改这一行；share：FOR SHARE，只读它的状态做判断、不许别人同时改 */
export type RowLockMode = "update" | "share";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 锁住一张表的若干行，返回实际锁到的主键，升序。不存在的行不在返回值里，缺了哪一行由调用方判断。
 * 传进来的顺序不论，这里按主键升序排好再发；主键是 UUID，字符串的序与库里 uuid 的序一致。
 */
export async function lockRows(
  tx: Tx,
  table: RowLockTable,
  ids: readonly string[],
  mode: RowLockMode = "update",
): Promise<string[]> {
  const keys = [...new Set(ids.map((id) => id.toLowerCase()))].sort();
  const bad = keys.find((key) => !UUID.test(key));
  if (bad !== undefined) throw new TypeError(`lockRows 只接受 UUID，收到 ${JSON.stringify(bad)}`);
  if (keys.length === 0) return [];
  assertLockOrder(tx, table, keys);
  const column = KEY_COLUMN[table] ?? "id";
  const strength = mode === "share" ? "SHARE" : "UPDATE";
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "${column}"::text AS id FROM "${table}" WHERE "${column}" = ANY($1::uuid[]) ORDER BY "${column}" FOR ${strength}`,
    keys,
  );
  return rows.map((row) => row.id);
}
