// events 连库用例的共用部分（W0-15）：只给本目录的测试用。
// “业务写”用 biz_sequence 充当（内核自己的表，没有外键，应用角色可增可查）：一行一个前缀。
import { createPrismaClient } from "@liyoxi/db";
import type { PrismaClient } from "@liyoxi/db";

import type { Tx } from "../../kernel/index.js";
import type { TestDatabase } from "../../testing/index.js";

/** 连库的用例与钩子的时限：机器忙的时候建库、删库都慢 */
export const SLOW = 120_000;

/** 一次业务写：插入一行。前缀是两到四个大写字母（库里有 CHECK） */
export const put = (db: PrismaClient | Tx, prefix: string): Promise<unknown> =>
  db.bizSequence.create({ data: { prefix, bizDate: new Date("2026-01-05"), nextVal: 1 } });

/** 库里现有的业务行的前缀 */
export async function prefixes(db: PrismaClient): Promise<string[]> {
  const found = await db.bizSequence.findMany({ orderBy: { prefix: "asc" } });
  return found.map((row) => row.prefix);
}

/** 另开一个连到本文件测试库的客户端：一个客户端就是一条独立的连接。用完自己 $disconnect() */
export async function openClient(db: TestDatabase): Promise<PrismaClient> {
  return createPrismaClient({ connectionString: await db.url(), max: 1 });
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
