import { expect, it } from "vitest";

import { connectTestDatabase, recordTestUsage, resolveTestSession } from "../database.js";
import { useTestDatabase } from "../worker.js";

// 四个并行夹具共用的用例：每个 worker 连自己的库，等到四个 worker 同时在场，再核对各连各的。
// 互相看得见靠 pg_stat_activity 里的 application_name（同一个实例上所有库的连接都在这张视图里）。

const PEERS = 4;
const DEADLINE_MS = 60_000;

interface Peer {
  datname: string;
  app: string;
}

export function defineParallelCase(tag: string): void {
  const db = useTestDatabase("db", { label: "par" });

  it(`${tag}：四个 worker 同时在场，各连各的库`, { timeout: DEADLINE_MS + 30_000 }, async () => {
    await db.url();
    // 建表是属主的事（应用角色没有模式的 CREATE）：role: null 不切角色，用 DATABASE_URL 的账号
    const client = await connectTestDatabase(db.name, { role: null });
    try {
      const prefix = `lyx-par:${resolveTestSession()}:`;
      const rename = (app: string) =>
        client.query("select set_config('application_name', $1, false)", [app]);
      await rename(`${prefix}${tag}`);
      await client.query("create table lyx_parallel_probe (tag text not null)");
      await client.query("insert into lyx_parallel_probe values ($1)", [tag]);

      const peers = async (): Promise<Peer[]> => {
        const result = await client.query<Peer>(
          "select datname, application_name as app from pg_stat_activity where left(application_name, $1) = $2",
          [prefix.length, prefix],
        );
        return result.rows;
      };
      const until = async (done: (now: Peer[]) => boolean): Promise<Peer[]> => {
        const deadline = Date.now() + DEADLINE_MS;
        for (;;) {
          const now = await peers();
          if (done(now)) return now;
          if (Date.now() > deadline) {
            throw new Error(`等不齐 ${PEERS} 个 worker，现在在场的：${JSON.stringify(now)}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      };

      // 第一步：等四个都到。第二步：标记“我看见了”，等别人也都看见了再走，免得先到的先走、后到的等不齐
      const tags = (now: Peer[]) => new Set(now.map((peer) => peer.app.replace(/:seen$/, "")));
      const present = await until((now) => tags(now).size >= PEERS);
      await rename(`${prefix}${tag}:seen`);
      await until((now) => now.every((peer) => peer.app.endsWith(":seen")));

      const databases = [...new Set(present.map((peer) => peer.datname))].sort();
      expect(databases).toHaveLength(PEERS);
      expect(databases).toContain(db.name);
      for (const name of databases) expect(name).toMatch(/^lyx_test_db_[a-z0-9]+_\d+_par$/);
      // 自己的库里只有自己写的那一行
      const mine = await client.query<{ tag: string }>("select tag from lyx_parallel_probe");
      expect(mine.rows).toEqual([{ tag }]);
      recordTestUsage("parallel", { tag, worker: process.env.VITEST_POOL_ID, databases });
    } finally {
      await client.end();
    }
  });
}
