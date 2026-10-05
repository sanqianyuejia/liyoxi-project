import { beforeAll, describe, it } from "vitest";

import { connectTestDatabase } from "../database.js";
import { useTestDatabase } from "../worker.js";

// 文件顶层的用例全过，里层一个 describe 的 beforeAll 失败：库同样应当改名留着（worker.test.ts 在外面核对）
const db = useTestDatabase("db", { label: "snested" });

it("建库并写一行", async () => {
  await db.url();
  // 建表是属主的事（应用角色没有模式的 CREATE）：role: null 不切角色，用 DATABASE_URL 的账号
  const client = await connectTestDatabase(db.name, { role: null });
  try {
    await client.query("create table lyx_hooks_probe as select 'nested'::text as outcome");
  } finally {
    await client.end();
  }
});

describe("里层", () => {
  beforeAll(() => {
    throw new Error("夹具：里层的 beforeAll 就是要失败");
  });

  it("跑不到的一条", () => {});
});
