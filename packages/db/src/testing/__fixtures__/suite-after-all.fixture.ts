import { afterAll, it } from "vitest";

import { connectTestDatabase } from "../database.js";
import { useTestDatabase } from "../worker.js";

// 用例全过，但后登记的一个 afterAll 失败：库同样应当改名留着（worker.test.ts 在外面核对）
const db = useTestDatabase("db", { label: "safter" });

afterAll(() => {
  throw new Error("夹具：afterAll 就是要失败");
});

it("建库并写一行", async () => {
  await db.url();
  // 建表是属主的事（应用角色没有模式的 CREATE）：role: null 不切角色，用 DATABASE_URL 的账号
  const client = await connectTestDatabase(db.name, { role: null });
  try {
    await client.query("create table lyx_hooks_probe as select 'after-all'::text as outcome");
  } finally {
    await client.end();
  }
});
