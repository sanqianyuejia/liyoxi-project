import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useTestDatabase } from "@liyoxi/services/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSeedCommand } from "../src/cli/seed-command.js";
import { runStaffBootstrapCommand } from "../src/cli/staff-bootstrap-command.js";
import { SLOW } from "./support/harness.js";

// W1-01a：引导命令 staff:bootstrap（dist/staff-bootstrap.js 的本体；任务书 第 7 节验收 10 的前半）。
// 连真库：测试支架给的库跑过全部迁移，先播种（角色与默认组）。三份密钥文件是用例现造的随机字节，放在临时目录，跑完删掉。
// 引导用例本身（守卫、并发、留痕）的用例在 packages/services 的 staff；这里只验薄壳：参数、退出码、输出、不打印敏感值。

const db = useTestDatabase("worker", { label: "bootstrap" });
const dir = mkdtempSync(join(tmpdir(), "lyx-bootstrap-"));
const key = (): string => randomBytes(32).toString("base64");
const file = (name: string, content: unknown): string => {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(content), { mode: 0o600 });
  return path;
};
const keyFiles = {
  DATA_KEYS_FILE: file("data.json", { current: "t1", keys: { t1: key() } }),
  BIDX_KEYS_FILE: file("bidx.json", { phone: key(), uscc: key() }),
  AUTH_KEYS_FILE: file("auth.json", {
    ticket: key(),
    device: key(),
    mfa: { current: "t1", keys: { t1: key() } },
  }),
};
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let base: Record<string, string | undefined>;
beforeAll(async () => {
  base = { APP_ENV: "test", DATABASE_URL: await db.url(), REDIS_URL: process.env.REDIS_URL };
  expect(await runSeedCommand({ source: base, out: () => undefined, err: () => undefined })).toBe(
    0,
  );
}, SLOW);

async function run(argv: string[], source: Record<string, string | undefined>) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runStaffBootstrapCommand({
    argv,
    source,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err, text: [...out, ...err].join("\n") };
}

const ARGS = ["--name", "首位管理员", "--phone", "13900020001"];

describe("引导命令 staff:bootstrap", () => {
  it(
    "缺参数：以 1 退出并给出用法；没配密钥：以 2 退出，只说缺哪一份",
    async () => {
      const usage = await run(["--name", "首位管理员"], { ...base, ...keyFiles });
      expect(usage.code).toBe(1);
      expect(usage.err).toEqual([expect.stringMatching(/^用法：staff:bootstrap --name/)]);

      const noKeys = await run(ARGS, base);
      expect(noKeys.code).toBe(2);
      expect(noKeys.out).toEqual([]);
      expect(noKeys.text).toMatch(/没有配置/);
      const prisma = await db.prisma();
      expect(await prisma.staff.count()).toBe(0);
    },
    SLOW,
  );

  it(
    "第一次建出待激活的超级管理员并输出一次激活码；第二次被拒绝，以 1 退出",
    async () => {
      const source = { ...base, ...keyFiles };
      const first = await run(ARGS, source);
      expect(first.err).toEqual([]);
      expect(first.code).toBe(0);
      const code = /^激活码：([A-Z0-9]{8})$/m.exec(first.text)?.[1];
      expect(code).toBeDefined();
      expect(first.text.split(code ?? "?")).toHaveLength(2);

      const prisma = await db.prisma();
      const staff = await prisma.staff.findMany({ include: { staffGroup: true } });
      expect(staff).toHaveLength(1);
      expect(staff[0]).toMatchObject({
        name: "首位管理员",
        staffRoleKey: "super_admin",
        status: "active",
        passwordHash: null,
        phoneMask: "139****0001",
        staffGroup: { isDefault: true },
      });
      expect(first.text).toContain(`工号 ${staff[0]?.staffNo}`);

      const second = await run(["--name", "另一位", "--phone", "13900020002"], source);
      expect(second.code).toBe(1);
      expect(second.out).toEqual([]);
      expect(second.text).toMatch(/^引导被拒绝：库里已经有启用的超级管理员/);
      expect(await prisma.staff.count()).toBe(1);

      // 输出里没有库的口令，也没有完整的手机号
      const password = new URL(base.DATABASE_URL ?? "").password;
      expect(password.length).toBeGreaterThan(0);
      for (const secret of [password, "13900020001"]) {
        expect(`${first.text}\n${second.text}`.replace(ARGS.join(" "), "")).not.toContain(secret);
      }
    },
    SLOW,
  );
});
