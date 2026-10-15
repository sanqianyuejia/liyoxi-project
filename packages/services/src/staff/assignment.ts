import { ASSIGNMENT_POOL } from "@liyoxi/contract/enums";
import type { StaffBrief } from "@liyoxi/contract";
import { AppError, assertLockOrder, lockRows } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { staffBriefOf } from "./me.js";
export type AssignmentPool = (typeof ASSIGNMENT_POOL.values)[number];
const select = {
  id: true,
  staffNo: true,
  name: true,
  staffRoleKey: true,
  isLead: true,
  status: true,
} as const;
const prepared = new WeakMap<Tx, Set<string>>();
const scopeOf = (pool: AssignmentPool, scope: string) =>
  pool === "delivery_manager" && scope && scope !== "all" ? scope : "all";
const keyOf = (pool: AssignmentPool, scope: string) => `${pool}:${scopeOf(pool, scope)}`;
async function candidates(tx: Tx, pool: AssignmentPool, scope: string) {
  const scoped = scopeOf(pool, scope);
  const where = (cityCode: string) => ({
    status: "active",
    staffRoleKey: pool,
    assignmentPoolMembers: { some: { pool, cityCode, ...(pool === "cs" ? { onDuty: true } : {}) } },
  });
  if (pool === "delivery_manager" && scoped !== "all") {
    const exact = await tx.staff.findMany({ where: where(scoped), select, orderBy: { id: "asc" } });
    if (exact.length) return exact;
  }
  return tx.staff.findMany({ where: where(""), select, orderBy: { id: "asc" } });
}
/** GET never creates or locks a cursor. Missing/removed last recipient naturally wraps. */
export async function recommendedStaff(
  tx: Tx,
  pool: AssignmentPool,
  scope = "all",
): Promise<StaffBrief | null> {
  const rows = await candidates(tx, pool, scope);
  if (!rows.length) return null;
  const cursor = await tx.assignmentCursor.findUnique({
    where: { pool_scopeKey: { pool, scopeKey: scopeOf(pool, scope) } },
  });
  return staffBriefOf(
    rows.find((r) => cursor?.lastStaffId && r.id > cursor.lastStaffId) ?? rows[0]!,
  );
}
/** All cursor-10 locks precede the complete sorted staff-20 set, including current assignees. */
export async function prepareAssignmentPools(
  tx: Tx,
  requests: readonly { pool: AssignmentPool; scopeKey: string }[],
  extraStaffIds: readonly string[] = [],
) {
  const requestsByKey = new Map(
    requests.map((r) => [
      keyOf(r.pool, r.scopeKey),
      { pool: r.pool, scopeKey: scopeOf(r.pool, r.scopeKey) },
    ]),
  );
  const known = prepared.get(tx) ?? new Set<string>();
  // 与锁序断言使用同一码序，不能按 locale 排列大小写不同的 scope。
  for (const [key, r] of [...requestsByKey].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (known.has(key)) continue;
    assertLockOrder(tx, "assignment_cursor", [key]);
    await tx.$executeRawUnsafe(
      `INSERT INTO assignment_cursor(pool,scope_key,created_at,updated_at) VALUES($1,$2,clock_timestamp(),clock_timestamp()) ON CONFLICT(pool,scope_key) DO NOTHING`,
      r.pool,
      r.scopeKey,
    );
    await tx.$queryRawUnsafe(
      `SELECT 1 FROM assignment_cursor WHERE pool=$1 AND scope_key=$2 FOR UPDATE`,
      r.pool,
      r.scopeKey,
    );
    known.add(key);
  }
  const ids = new Set(extraStaffIds);
  for (const r of requestsByKey.values())
    for (const c of await candidates(tx, r.pool, r.scopeKey)) ids.add(c.id);
  await lockRows(tx, "staff", [...ids], "share");
  for (const r of requestsByKey.values())
    if ((await candidates(tx, r.pool, r.scopeKey)).some((c) => !ids.has(c.id)))
      throw new AppError("BUSY", { message: "分配池已变化，请重试" });
  prepared.set(tx, known);
}
export async function pickNext(
  tx: Tx,
  pool: AssignmentPool,
  scope: string,
): Promise<StaffBrief | null> {
  if (!(ASSIGNMENT_POOL.values as readonly string[]).includes(pool))
    throw new TypeError("分配池未登记");
  const scopeKey = scopeOf(pool, scope);
  if (!prepared.get(tx)?.has(keyOf(pool, scope)))
    await prepareAssignmentPools(tx, [{ pool, scopeKey }]);
  const selected = await recommendedStaff(tx, pool, scopeKey);
  if (!selected) return null;
  await lockRows(tx, "staff", [selected.staffId], "share");
  await tx.assignmentCursor.update({
    where: { pool_scopeKey: { pool, scopeKey } },
    data: { lastStaffId: selected.staffId },
  });
  await tx.$executeRawUnsafe(
    "UPDATE assignment_cursor SET updated_at=clock_timestamp() WHERE pool=$1 AND scope_key=$2",
    pool,
    scopeKey,
  );
  return selected;
}
/** Display facts contain no phone or credentials. */
export async function staffBriefs(tx: Tx, ids: readonly string[]): Promise<StaffBrief[]> {
  const rows = await tx.staff.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select,
    orderBy: [{ staffNo: "asc" }, { id: "asc" }],
  });
  return rows.map(staffBriefOf);
}
