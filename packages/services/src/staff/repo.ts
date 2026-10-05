// staff 凭据用例共用的几个库操作（W1-01a）。
import type { Staff } from "@liyoxi/db";

import { assertLockOrder } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { phoneBidx } from "../security/index.js";
import type { Keyring } from "../security/index.js";
import type { StaffDb } from "./types.js";

/**
 * 锁住员工行并读出它；不存在即 null。改凭据（口令、动态口令的时间步、恢复码、失败计数）之前都先调它：
 * 并发的两次校验逐个来，后到的看到的是前一个提交之后的样子。
 * 强度是 FOR NO KEY UPDATE（03 分组 第 2.3 节）：七十多个外键指着 staff.id，FOR UPDATE 会挡住别的事务
 * 插入带 *_by_staff_id 的行。lockRows 只有 FOR UPDATE，所以这里自己写加锁语句，先过锁序断言。
 */
export async function lockStaff(tx: Tx, staffId: string): Promise<Staff | null> {
  assertLockOrder(tx, "staff", [staffId]);
  await tx.$queryRawUnsafe("SELECT 1 FROM staff WHERE id = $1::uuid FOR NO KEY UPDATE", staffId);
  return tx.staff.findUnique({ where: { id: staffId } });
}

/** 按登录手机号取员工（盲索引，uq_staff_phone_bidx） */
export const findStaffByPhone = (
  db: StaffDb,
  keyring: Keyring,
  phone: string,
): Promise<Staff | null> =>
  db.staff.findUnique({ where: { phoneBidx: phoneBidx(keyring, phone) } });

/** 库里有没有启用的超级管理员（可以不算某一位） */
export async function hasActiveSuperAdmin(db: StaffDb, exceptStaffId?: string): Promise<boolean> {
  const found = await db.staff.findFirst({
    where: {
      staffRoleKey: "super_admin",
      status: "active",
      ...(exceptStaffId ? { id: { not: exceptStaffId } } : {}),
    },
    select: { id: true },
  });
  return found !== null;
}
