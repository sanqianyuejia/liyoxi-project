import { expect, it } from "vitest";

import { connectTestDatabase } from "../database.js";
import { useTestDatabase } from "../worker.js";

// 用例全过的文件：跑完之后它的库应当已经删掉（worker.test.ts 在外面核对）
const db = useTestDatabase("db", { label: "hookpass" });

it("建库并写一行", async () => {
  await db.url();
  // 建表是属主的事（应用角色没有模式的 CREATE）：role: null 不切角色，用 DATABASE_URL 的账号
  const client = await connectTestDatabase(db.name, { role: null });
  try {
    await client.query("create table lyx_hooks_probe as select 'pass'::text as outcome");
    expect((await client.query("select outcome from lyx_hooks_probe")).rows).toEqual([
      { outcome: "pass" },
    ]);
  } finally {
    await client.end();
  }
});
