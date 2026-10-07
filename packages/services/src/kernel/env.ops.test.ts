import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, expect, it } from "vitest";
import { loadEnv } from "./env.js";
const root = mkdtempSync(join(tmpdir(), "lyx-ops-env-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const base = {
  APP_ENV: "test",
  DATABASE_URL: "postgresql://local:placeholder@localhost:5442/liyoxi",
  REDIS_URL: "redis://localhost:6389/0",
};
const file = (name: string, value: string) => {
  const path = join(root, name);
  writeFileSync(path, value);
  return path;
};
it("旧默认保持，空后台白名单/证书不隐含真实配置", () => {
  expect(loadEnv(base)).toEqual({ ...base, LOG_LEVEL: "info" });
  expect(loadEnv({ ...base, ADMIN_IP_ALLOWLIST: "  ", CERT_DOMAINS: " " })).toEqual({
    ...base,
    LOG_LEVEL: "info",
  });
});
it("IPv4/IPv6 CIDR与显式DNS校验，不把值/路径带进错误", () => {
  expect(
    loadEnv({
      ...base,
      ADMIN_IP_ALLOWLIST: "198.51.100.0/24,2001:db8::/32",
      CERT_DOMAINS: "api.example.invalid",
    }),
  ).toMatchObject({
    ADMIN_IP_ALLOWLIST: ["198.51.100.0/24", "2001:db8::/32"],
    CERT_DOMAINS: ["api.example.invalid"],
  });
  for (const source of [
    { ADMIN_IP_ALLOWLIST: "198.51.100.0/33" },
    { ADMIN_IP_ALLOWLIST: "10.0.0.0/1e1" },
    { CERT_DOMAINS: "https://SECRET.example/path" },
  ]) {
    try {
      loadEnv({ ...base, ...source });
      throw new Error("accepted");
    } catch (error) {
      expect(String(error)).not.toContain("SECRET");
      expect(String(error)).not.toContain("1e1");
      expect(String(error)).toContain("环境变量校验失败");
    }
  }
});
it("只读备份连接/公钥/目标桶成组，私钥拒绝，stg明文敏感URL拒绝", () => {
  const publicKey = file("public", "age1" + "q".repeat(58));
  expect(
    loadEnv({
      ...base,
      BACKUP_READONLY_URL: base.DATABASE_URL,
      BACKUP_RECIPIENTS_FILE: publicKey,
      BACKUP_BUCKET: "lyx-test-backup",
    }).BACKUP,
  ).toMatchObject({ bucket: "lyx-test-backup", prefix: "backups", maxBytes: 10 * 1024 ** 3 });
  expect(() => loadEnv({ ...base, BACKUP_BUCKET: "lyx-test-backup" })).toThrow("成组配置");
  expect(() =>
    loadEnv({
      ...base,
      BACKUP_READONLY_URL: base.DATABASE_URL,
      BACKUP_RECIPIENTS_FILE: file("private", "AGE-SECRET-KEY-FAKE"),
      BACKUP_BUCKET: "lyx-test-backup",
    }),
  ).toThrow("不接受私钥");
  expect(() =>
    loadEnv({
      ...base,
      APP_ENV: "stg",
      DATABASE_URL_FILE: file("db", base.DATABASE_URL),
      DATABASE_URL: undefined,
      REDIS_URL_FILE: file("redis", base.REDIS_URL),
      REDIS_URL: undefined,
      BACKUP_READONLY_URL: base.DATABASE_URL,
    }),
  ).toThrow("不接受明文");
});
it("值班人只读取测试现造文件，非法数量/手机号固定错误", () => {
  expect(
    loadEnv({ ...base, ALERT_ONCALL_PHONES_FILE: file("oncall", "13800138000,13900139000") })
      .ALERT_ONCALL_PHONES,
  ).toEqual(["13800138000", "13900139000"]);
  expect(() =>
    loadEnv({ ...base, ALERT_ONCALL_PHONES_FILE: file("badcall", "secret-number") }),
  ).toThrow("合法手机号");
});

it("探针部署阈值有界且错误不输出文件/内容", () => {
  expect(
    loadEnv({
      ...base,
      PROBE_THRESHOLDS_FILE: file(
        "thresholds",
        JSON.stringify({ "timer.lag": { p2: 120, p1: 600 } }),
      ),
    }).PROBE_THRESHOLDS,
  ).toEqual({ "timer.lag": { p2: 120, p1: 600 } });
  expect(() =>
    loadEnv({
      ...base,
      PROBE_THRESHOLDS_FILE: file(
        "badthresholds",
        JSON.stringify({ "timer.lag": { p2: 120, p1: 1 } }),
      ),
    }),
  ).toThrow("有界");
});
