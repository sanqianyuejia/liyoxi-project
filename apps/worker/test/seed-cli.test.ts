import { useTestDatabase } from "@liyoxi/services/testing";
import { describe, expect, it } from "vitest";

import { runSeedCommand } from "../src/cli/seed-command.js";
import { SLOW } from "./support/harness.js";

// W1-22：播种的镜像内入口（dist/seed.js 的本体）。连真库：测试支架给的库跑过全部迁移，连接是应用角色 lyx_app。
// 播种本身的用例在 packages/services（W0-21）；这里只验薄壳：退出码、可重复跑、不打印连接串。

const db = useTestDatabase("worker", { label: "seed" });

async function run(source: Record<string, string | undefined>) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSeedCommand({
    source,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err, text: [...out, ...err].join("\n") };
}

describe("播种命令", () => {
  it(
    "空库上播完以 0 退出、六条断言 0 违规；再跑一遍新增 0 行；输出里没有连接串",
    async () => {
      const url = await db.url();
      const source = { APP_ENV: "test", DATABASE_URL: url, REDIS_URL: process.env.REDIS_URL };

      const first = await run(source);
      expect(first.err).toEqual([]);
      expect(first.code).toBe(0);
      expect(first.out.at(-1)).toBe("断言：0 条违规");
      const inserted = Number(/^播种完成：新增 (\d+) 行$/m.exec(first.text)?.[1]);
      expect(inserted).toBeGreaterThan(0);

      const second = await run(source);
      expect(second.code).toBe(0);
      expect(second.text).toMatch(/^播种完成：新增 0 行$/m);

      const password = new URL(url).password;
      expect(password.length).toBeGreaterThan(0);
      expect(`${first.text}\n${second.text}`).not.toContain(password);
    },
    SLOW,
  );

  it("缺必填的环境变量：以 2 退出，只报键名与原因", async () => {
    const result = await run({ APP_ENV: "test" });
    expect(result.code).toBe(2);
    expect(result.out).toEqual([]);
    expect(result.text).toContain("DATABASE_URL: 必填，未配置");
  });
});
