// kernel 连库用例的共用部分（W0-07）：只给本目录的测试用。
// 写的是 biz_sequence（内核自己的表，没有外键，应用角色有增删改查）：一行一个前缀，next_val 当计数用。
// 连接不写 role：用支架给的缺省身份（W0-06a 合并后是应用角色 lyx_app），不假定自己是超级用户或表的属主。
import { createPrismaClient } from "@liyoxi/db";
import type { PrismaClient } from "@liyoxi/db";

import type { TestDatabase } from "../../testing/index.js";
import type { Tx } from "../tx.js";

export const BIZ_DATE = new Date("2026-01-05");

type Db = PrismaClient | Tx;

/** 插入一行。前缀是两到四个大写字母（库里有 CHECK） */
export const put = (db: Db, prefix: string): Promise<unknown> =>
  db.bizSequence.create({ data: { prefix, bizDate: BIZ_DATE, nextVal: 1 } });

/** 计数加一：一条 UPDATE，拿这一行的行锁到事务结束 */
export const bump = (db: Db, prefix: string): Promise<number> =>
  db.$executeRawUnsafe("UPDATE biz_sequence SET next_val = next_val + 1 WHERE prefix = $1", prefix);

/** 库里现有的行：前缀 → next_val */
export async function rows(db: Db): Promise<Record<string, number>> {
  const found = await db.bizSequence.findMany({ orderBy: { prefix: "asc" } });
  return Object.fromEntries(found.map((row) => [row.prefix, row.nextVal]));
}

export interface OpenClientOptions {
  /** 连接数上限，缺省 1：一个客户端就是一条独立的连接 */
  max?: number;
  lockTimeoutMs?: number;
  /**
   * 把死锁检测的等待时间（服务器缺省 1 秒）调短，重复造死锁时省时间。它是超级用户才能改的参数，
   * 随连接的启动参数下发：登录账号是超级用户（本地与 CI）时生效；不是时连不上，退回服务器的缺省值，用例照样成立，只是慢。
   */
  deadlockTimeoutMs?: number;
}

/** 另开一个连到本文件测试库的客户端。用完自己 $disconnect() */
export async function openClient(
  db: TestDatabase,
  options: OpenClientOptions = {},
): Promise<PrismaClient> {
  const base = await db.url();
  const open = (connectionString: string): PrismaClient =>
    createPrismaClient({
      connectionString,
      max: options.max ?? 1,
      lockTimeoutMs: options.lockTimeoutMs,
    });
  if (options.deadlockTimeoutMs === undefined) return open(base);
  const url = new URL(base);
  // 支架可能已经在 options 里写了 -c role=…：接在后面，不覆盖
  const startup = [
    url.searchParams.get("options"),
    `-c deadlock_timeout=${options.deadlockTimeoutMs}ms`,
  ];
  url.searchParams.set("options", startup.filter(Boolean).join(" "));
  const tuned = open(url.toString());
  try {
    await tuned.$queryRawUnsafe("SELECT 1");
    return tuned;
  } catch {
    await tuned.$disconnect();
    return open(base);
  }
}

/** 栅栏：n 方都到了才一起放行 */
export function barrier(n: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return () => {
    arrived += 1;
    if (arrived >= n) open();
    return opened;
  };
}

/** 一个可以从外面放行的门 */
export function gate(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}
