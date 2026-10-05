// 角色与本组成员的加载与缓存（W1-01a；D4 第 6.5 节；约定 C4“权限刷新”）：每请求从库里取，进程内缓存 5 秒。
// 后台改了角色的权限、调了分组，最迟 5 秒后本进程生效。这里只管取与缓存：两个 jsonb 原样给出，规整归 authz。
import type { Prisma, StaffRole } from "@liyoxi/db";

import { AppError } from "../kernel/index.js";
import type { Clock } from "../kernel/index.js";

/** 只读的库句柄：会话校验、按手机号取员工这类不开事务的读。Prisma 客户端与事务句柄都满足它 */
export type StaffDb = Omit<Prisma.TransactionClient, "$transaction">;

export const ROLE_CACHE_TTL_MS = 5_000;

export type RoleRow = Pick<
  StaffRole,
  "key" | "name" | "moduleLevels" | "actions" | "dataScope" | "isLocked" | "lockVersion"
>;

export interface RoleCache {
  /** 取一个角色；库里没有即抛（员工行的外键指着它，没有就是库坏了） */
  role(key: string): Promise<RoleRow>;
  /** 一个分组里全部员工的 id，升序 */
  groupMemberIds(groupId: string): Promise<readonly string[]>;
  /** 丢掉手里的值：本进程刚改过角色或分组时调 */
  invalidate(): void;
}

export function createRoleCache(deps: { db: StaffDb; clock: Clock; ttlMs?: number }): RoleCache {
  const ttl = deps.ttlMs ?? ROLE_CACHE_TTL_MS;
  const entries = new Map<string, { at: number; value: Promise<unknown> }>();
  const cached = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const now = deps.clock.now().getTime();
    const hit = entries.get(key);
    if (hit !== undefined && now - hit.at < ttl && now >= hit.at) return hit.value as Promise<T>;
    const value = load();
    entries.set(key, { at: now, value });
    // 读库失败的不留：下一次再读
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    return value;
  };
  return {
    role: (key) =>
      cached(`role:${key}`, async () => {
        const row = await deps.db.staffRole.findUnique({
          where: { key },
          select: {
            key: true,
            name: true,
            moduleLevels: true,
            actions: true,
            dataScope: true,
            isLocked: true,
            lockVersion: true,
          },
        });
        if (row === null) throw new AppError("INTERNAL", { message: `角色 ${key} 不在库里` });
        return row;
      }),
    groupMemberIds: (groupId) =>
      cached(`group:${groupId}`, async () => {
        const rows = await deps.db.staff.findMany({
          where: { staffGroupId: groupId },
          select: { id: true },
          orderBy: { id: "asc" },
        });
        return rows.map((row) => row.id);
      }),
    invalidate: () => entries.clear(),
  };
}
