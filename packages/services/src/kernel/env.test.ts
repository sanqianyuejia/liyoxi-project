import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { ENV_GROUPS, ENV_KEYS, EnvError, groupIssues, loadEnv } from "./env.js";
import type { EnvGroup, EnvSource } from "./env.js";

// 连接串在这里拼出来：口令是随机的标记串，用来断言“报错里不出现任何值”
const PG_MARK = "pgmark7f3a";
const REDIS_MARK = "rdmark91c2";
const DATABASE_URL = `postgresql://lyx:${PG_MARK}@localhost:5442/liyoxi`;
const REDIS_URL = `redis://:${REDIS_MARK}@localhost:6389/0`;

const temp = mkdtempSync(join(tmpdir(), "lyx-env-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function fileWith(name: string, content: string): string {
  const path = join(temp, name);
  writeFileSync(path, content);
  return path;
}

/** 跑 loadEnv，必须抛 EnvError；返回它 */
function failure(source: EnvSource, groups?: readonly EnvGroup[]): EnvError {
  try {
    loadEnv(source, groups ? { groups } : {});
  } catch (error) {
    if (error instanceof EnvError) return error;
    throw error;
  }
  throw new Error("loadEnv 没有抛错");
}

const keysOf = (error: EnvError) => error.issues.map((issue) => issue.key);

describe("合格的配置", () => {
  it("local 下给明文连接串：通过，LOG_LEVEL 不填按 info", () => {
    const env = loadEnv({ APP_ENV: "local", DATABASE_URL, REDIS_URL });
    expect(env).toEqual({ APP_ENV: "local", LOG_LEVEL: "info", DATABASE_URL, REDIS_URL });
    expect(Object.isFrozen(env)).toBe(true);
  });

  it("test 下同样可以给明文", () => {
    expect(loadEnv({ APP_ENV: "test", DATABASE_URL, REDIS_URL }).APP_ENV).toBe("test");
  });

  it.each(["stg", "prod"])("%s 下用 *_FILE：读文件内容，去掉末尾换行", (appEnv) => {
    const env = loadEnv({
      APP_ENV: appEnv,
      LOG_LEVEL: "warn",
      DATABASE_URL_FILE: fileWith(`${appEnv}-pg`, `${DATABASE_URL}\n`),
      REDIS_URL_FILE: fileWith(`${appEnv}-redis`, `${REDIS_URL}\n`),
    });
    expect(env).toEqual({ APP_ENV: appEnv, LOG_LEVEL: "warn", DATABASE_URL, REDIS_URL });
  });

  it("local 下也可以用 *_FILE", () => {
    const env = loadEnv({
      APP_ENV: "local",
      DATABASE_URL_FILE: fileWith("local-pg", DATABASE_URL),
      REDIS_URL,
    });
    expect(env.DATABASE_URL).toBe(DATABASE_URL);
  });

  it("空串与只有空白的值当没填；首尾空白去掉", () => {
    const env = loadEnv({
      APP_ENV: " local ",
      LOG_LEVEL: "  ",
      DATABASE_URL: ` ${DATABASE_URL} `,
      DATABASE_URL_FILE: "",
      REDIS_URL,
      REDIS_URL_FILE: "   ",
    });
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DATABASE_URL).toBe(DATABASE_URL);
  });

  it("不带参数时读 process.env", () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { APP_ENV: "test", DATABASE_URL, REDIS_URL });
      delete process.env.DATABASE_URL_FILE;
      delete process.env.REDIS_URL_FILE;
      delete process.env.LOG_LEVEL;
      expect(loadEnv().DATABASE_URL).toBe(DATABASE_URL);
    } finally {
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});

describe("缺必填变量即失败", () => {
  it("loadEnv({}) 抛错，列出缺的三个键名", () => {
    const error = failure({});
    expect(keysOf(error)).toEqual(["APP_ENV", "DATABASE_URL", "REDIS_URL"]);
    expect(error.message).toContain("环境变量校验失败");
    expect(error.message).toContain("  - APP_ENV: 必填");
    expect(error.message).toContain("  - DATABASE_URL: 必填，未配置");
    expect(error.message).toContain("  - REDIS_URL: 必填，未配置");
  });

  it("只缺一个连接串：只报它", () => {
    expect(keysOf(failure({ APP_ENV: "local", DATABASE_URL }))).toEqual(["REDIS_URL"]);
  });

  it("值是空串等于没填", () => {
    const error = failure({ APP_ENV: "local", DATABASE_URL: "", REDIS_URL });
    expect(keysOf(error)).toEqual(["DATABASE_URL"]);
  });
});

describe("写错的值", () => {
  it("APP_ENV、LOG_LEVEL 不在取值范围内", () => {
    const error = failure({ APP_ENV: "production", LOG_LEVEL: "verbose", DATABASE_URL, REDIS_URL });
    expect(keysOf(error)).toEqual(["APP_ENV", "LOG_LEVEL"]);
    expect(error.message).toContain("APP_ENV: 必填，只能是 local、test、stg、prod 之一");
  });

  it("连接串的协议不对", () => {
    const error = failure({
      APP_ENV: "local",
      DATABASE_URL: `mysql://lyx:${PG_MARK}@localhost:3306/liyoxi`,
      REDIS_URL: `http://${REDIS_MARK}.example.invalid`,
    });
    expect(keysOf(error)).toEqual(["DATABASE_URL", "REDIS_URL"]);
    expect(error.message).toContain("DATABASE_URL: 不是合法的 postgresql:// 连接串");
  });

  it("连接串不是 URL", () => {
    const error = failure({ APP_ENV: "local", DATABASE_URL: PG_MARK, REDIS_URL });
    expect(keysOf(error)).toEqual(["DATABASE_URL"]);
  });

  it("*_FILE 里的内容同样要过校验", () => {
    const error = failure({
      APP_ENV: "prod",
      DATABASE_URL_FILE: fileWith("bad-pg", `mysql://lyx:${PG_MARK}@db/liyoxi`),
      REDIS_URL_FILE: fileWith("ok-redis", REDIS_URL),
    });
    expect(keysOf(error)).toEqual(["DATABASE_URL"]);
  });
});

describe("stg、prod 只认 *_FILE", () => {
  it.each(["stg", "prod"])("%s 下连接串给明文即抛错", (appEnv) => {
    const error = failure({ APP_ENV: appEnv, DATABASE_URL, REDIS_URL });
    expect(keysOf(error)).toEqual(["DATABASE_URL", "REDIS_URL"]);
    expect(error.message).toContain(
      `DATABASE_URL: ${appEnv} 环境只认 DATABASE_URL_FILE，不接受明文`,
    );
    expect(error.message).toContain(`REDIS_URL: ${appEnv} 环境只认 REDIS_URL_FILE，不接受明文`);
  });

  it("明文与 *_FILE 同时给：任何环境都抛错", () => {
    const error = failure({
      APP_ENV: "local",
      DATABASE_URL,
      DATABASE_URL_FILE: fileWith("both-pg", DATABASE_URL),
      REDIS_URL,
    });
    expect(keysOf(error)).toEqual(["DATABASE_URL"]);
    expect(error.message).toContain("DATABASE_URL: 与 DATABASE_URL_FILE 只能给一个");
  });

  it("*_FILE 指的文件不存在或是空的", () => {
    const error = failure({
      APP_ENV: "prod",
      DATABASE_URL_FILE: join(temp, "no-such-file"),
      REDIS_URL_FILE: fileWith("empty-redis", "\n"),
    });
    expect(error.issues).toEqual([
      { key: "DATABASE_URL_FILE", reason: "所指的文件读不了" },
      { key: "REDIS_URL_FILE", reason: "所指的文件是空的" },
    ]);
  });
});

describe("报错不含任何值", () => {
  const secretFile = fileWith("secret-pg", `mysql://lyx:${PG_MARK}@db/liyoxi`);
  const cases: Array<[string, EnvSource]> = [
    ["写错的值", { APP_ENV: "wrongenv", LOG_LEVEL: "wronglevel", DATABASE_URL: PG_MARK }],
    [
      "协议不对的连接串",
      { APP_ENV: "local", DATABASE_URL: `x://${PG_MARK}`, REDIS_URL: `y://${REDIS_MARK}` },
    ],
    ["prod 下的明文", { APP_ENV: "prod", DATABASE_URL, REDIS_URL }],
    ["明文与文件都给", { APP_ENV: "test", DATABASE_URL, DATABASE_URL_FILE: secretFile, REDIS_URL }],
    [
      "文件内容不合格",
      { APP_ENV: "prod", DATABASE_URL_FILE: secretFile, REDIS_URL_FILE: secretFile },
    ],
    ["文件不存在", { APP_ENV: "prod", DATABASE_URL_FILE: join(temp, "missing-marker") }],
  ];

  it.each(cases)("%s", (_label, source) => {
    const error = failure(source);
    const text = `${error.message}\n${JSON.stringify(error.issues)}`;
    for (const value of Object.values(source)) {
      if (value === undefined || value === "") continue;
      // local、test、stg、prod 这些取值本身会出现在“只能是 … 之一”的说明里，不算泄露
      if (["local", "test", "stg", "prod"].includes(value)) continue;
      expect(text).not.toContain(value);
    }
    for (const mark of [PG_MARK, REDIS_MARK, "wrongenv", "wronglevel", "missing-marker", temp]) {
      expect(text).not.toContain(mark);
    }
  });
});

describe("成组变量成对校验", () => {
  const pay: EnvGroup = {
    name: "微信支付",
    keys: ["WXPAY_MCH_ID", "WXPAY_CERT_SERIAL", "WXPAY_PRIVATE_KEY_FILE"],
  };
  const base = { APP_ENV: "local", DATABASE_URL, REDIS_URL };

  it("登记的组：两份密钥文件（W0-14）", () => {
    expect(ENV_GROUPS).toEqual([
      { name: "字段加密与盲索引密钥", keys: ["DATA_KEYS_FILE", "BIDX_KEYS_FILE"] },
    ]);
  });

  it("全不配：通过", () => {
    expect(groupIssues({}, [pay])).toEqual([]);
    expect(loadEnv(base, { groups: [pay] }).APP_ENV).toBe("local");
  });

  it("全配：通过", () => {
    const source = { WXPAY_MCH_ID: "m", WXPAY_CERT_SERIAL: "s", WXPAY_PRIVATE_KEY_FILE: "f" };
    expect(groupIssues(source, [pay])).toEqual([]);
  });

  it("半配即抛错：逐个报出缺的键，不带已配的值", () => {
    const error = failure({ ...base, WXPAY_MCH_ID: "mch-mark-551" }, [pay]);
    expect(keysOf(error)).toEqual(["WXPAY_CERT_SERIAL", "WXPAY_PRIVATE_KEY_FILE"]);
    expect(error.message).toContain(
      "WXPAY_CERT_SERIAL: 与 WXPAY_MCH_ID、WXPAY_PRIVATE_KEY_FILE 成组（微信支付），这一组只配了一部分，缺这一项",
    );
    expect(error.message).not.toContain("mch-mark-551");
  });

  it("组里的空串当没配", () => {
    const source = { WXPAY_MCH_ID: "m", WXPAY_CERT_SERIAL: " ", WXPAY_PRIVATE_KEY_FILE: "f" };
    expect(groupIssues(source, [pay]).map((issue) => issue.key)).toEqual(["WXPAY_CERT_SERIAL"]);
  });

  it("多个组各自判断；与别的问题一并列出", () => {
    const cos: EnvGroup = { name: "对象存储", keys: ["COS_BUCKET", "COS_REGION"] };
    const error = failure({ APP_ENV: "local", REDIS_URL, COS_REGION: "r" }, [pay, cos]);
    expect(keysOf(error)).toEqual(["DATABASE_URL", "COS_BUCKET"]);
  });
});

describe("键名清单", () => {
  it("ENV_KEYS 列全了 loadEnv 读的键", () => {
    expect(ENV_KEYS).toEqual([
      "APP_ENV",
      "LOG_LEVEL",
      "DATABASE_URL",
      "DATABASE_URL_FILE",
      "REDIS_URL",
      "REDIS_URL_FILE",
      "DATA_KEYS_FILE",
      "BIDX_KEYS_FILE",
      "AUTH_KEYS_FILE",
    ]);
  });
});

// W0-14 验收第 10 条：密钥只认文件。密钥是现造的固定字节，不是任何环境在用的密钥
describe("字段加密与盲索引的密钥文件", () => {
  const base = { APP_ENV: "local", DATABASE_URL, REDIS_URL };
  const key = (fill: number) => Buffer.alloc(32, fill).toString("base64");
  const dataKeys = { current: "k2", keys: { k1: key(1), k2: key(2) } };
  const bidxKeys = { phone: key(3), uscc: Buffer.alloc(32, 4).toString("base64url") };
  const dataFile = fileWith("data-keys.json", JSON.stringify(dataKeys));
  const bidxFile = fileWith("bidx-keys.json", `${JSON.stringify(bidxKeys)}\n`);

  it("两份文件都合法：通过，内容原样给出；都不配：通过，Env 里没有这两项", () => {
    const env = loadEnv({ ...base, DATA_KEYS_FILE: dataFile, BIDX_KEYS_FILE: bidxFile });
    expect(env.DATA_KEYS).toEqual(dataKeys);
    expect(env.BIDX_KEYS).toEqual(bidxKeys);
    expect(Object.keys(loadEnv(base))).toEqual([
      "APP_ENV",
      "LOG_LEVEL",
      "DATABASE_URL",
      "REDIS_URL",
    ]);
  });

  it.each(["local", "test", "prod"])("%s 下给明文变量 DATA_KEYS、BIDX_KEYS 即失败", (appEnv) => {
    const source = {
      APP_ENV: appEnv,
      DATABASE_URL_FILE: fileWith(`keys-${appEnv}-pg`, DATABASE_URL),
      REDIS_URL_FILE: fileWith(`keys-${appEnv}-redis`, REDIS_URL),
      DATA_KEYS: JSON.stringify(dataKeys),
      BIDX_KEYS: JSON.stringify(bidxKeys),
    };
    const error = failure(source);
    expect(error.issues).toEqual([
      { key: "DATA_KEYS", reason: "密钥只认 DATA_KEYS_FILE（值是文件路径），任何环境都不接受明文" },
      { key: "BIDX_KEYS", reason: "密钥只认 BIDX_KEYS_FILE（值是文件路径），任何环境都不接受明文" },
    ]);
    // 文件也给了，明文变量照样不收
    const both = failure({ ...source, DATA_KEYS_FILE: dataFile, BIDX_KEYS_FILE: bidxFile });
    expect(keysOf(both)).toEqual(["DATA_KEYS", "BIDX_KEYS"]);
  });

  it("只配一份：成组校验报出缺的那一项", () => {
    expect(keysOf(failure({ ...base, DATA_KEYS_FILE: dataFile }))).toEqual(["BIDX_KEYS_FILE"]);
    expect(keysOf(failure({ ...base, BIDX_KEYS_FILE: bidxFile }))).toEqual(["DATA_KEYS_FILE"]);
  });

  const KEY_MARK = Buffer.alloc(31, 9).toString("base64");
  const bad: Array<[string, string, string, string]> = [
    ["DATA_KEYS_FILE", "不是 JSON", `{ current: ${KEY_MARK}`, "文件内容不是合法的 JSON"],
    [
      "DATA_KEYS_FILE",
      "形状不对",
      JSON.stringify({ keys: dataKeys.keys }),
      "文件内容要是 { current, keys }",
    ],
    [
      "DATA_KEYS_FILE",
      "kid 带冒号",
      JSON.stringify({ current: "a:b", keys: { "a:b": key(1) } }),
      "kid 只能用字母、数字、下划线、连字符",
    ],
    [
      "DATA_KEYS_FILE",
      "密钥只有 31 字节",
      JSON.stringify({ current: "k1", keys: { k1: KEY_MARK } }),
      "每把密钥要是 base64 写的 32 字节",
    ],
    [
      "DATA_KEYS_FILE",
      "current 不在 keys 里",
      JSON.stringify({ current: "k9", keys: dataKeys.keys }),
      "current 指的 kid 不在 keys 里",
    ],
    ["BIDX_KEYS_FILE", "空对象", "{}", "文件内容要是“用途 → 密钥”的映射，至少一项"],
    ["BIDX_KEYS_FILE", "用途写法不对", JSON.stringify({ Phone: key(3) }), "用途只能是小写字母开头"],
    [
      "BIDX_KEYS_FILE",
      "密钥不是 base64",
      JSON.stringify({ phone: "x".repeat(40) }),
      "每把密钥要是",
    ],
  ];

  it.each(bad)("%s %s：失败，报错不带文件内容", (fileKey, label, content, reason) => {
    const source = { ...base, DATA_KEYS_FILE: dataFile, BIDX_KEYS_FILE: bidxFile };
    const error = failure({
      ...source,
      [fileKey]: fileWith(`bad-${fileKey}-${label}.json`, content),
    });
    expect(keysOf(error)).toEqual([fileKey]);
    expect(error.issues[0]?.reason).toContain(reason);
    for (const mark of [KEY_MARK, key(1), key(3), temp]) expect(error.message).not.toContain(mark);
  });

  it("文件不存在：只报键名", () => {
    const error = failure({
      ...base,
      DATA_KEYS_FILE: join(temp, "no-keys"),
      BIDX_KEYS_FILE: bidxFile,
    });
    expect(error.issues).toEqual([{ key: "DATA_KEYS_FILE", reason: "所指的文件读不了" }]);
  });

  it(".env.example 里两项只有占位路径", () => {
    const example = readFileSync(new URL("../../../../.env.example", import.meta.url), "utf8");
    const lines = example.split("\n").filter((line) => /^(DATA|BIDX)_KEYS/.test(line));
    expect(lines).toEqual(["DATA_KEYS_FILE=<文件路径>", "BIDX_KEYS_FILE=<文件路径>"]);
  });
});

// W1-01a：后台登录的三把密钥放一份文件，只认文件路径。密钥是现造的固定字节，不是任何环境在用的密钥
describe("后台登录的密钥文件", () => {
  const base = { APP_ENV: "local", DATABASE_URL, REDIS_URL };
  const key = (fill: number) => Buffer.alloc(32, fill).toString("base64");
  const authKeys = {
    ticket: key(11),
    device: key(12),
    mfa: { current: "m1", keys: { m1: key(13) } },
  };
  const authFile = fileWith("auth-keys.json", JSON.stringify(authKeys));

  it("文件合法：通过，内容原样给出；不配：Env 里没有这一项，也不要求与别的密钥成组", () => {
    expect(loadEnv({ ...base, AUTH_KEYS_FILE: authFile }).AUTH_KEYS).toEqual(authKeys);
    expect(loadEnv(base).AUTH_KEYS).toBeUndefined();
  });

  it.each(["local", "test", "prod"])("%s 下给明文变量 AUTH_KEYS 即失败", (appEnv) => {
    const error = failure({
      APP_ENV: appEnv,
      DATABASE_URL_FILE: fileWith(`auth-${appEnv}-pg`, DATABASE_URL),
      REDIS_URL_FILE: fileWith(`auth-${appEnv}-redis`, REDIS_URL),
      AUTH_KEYS: JSON.stringify(authKeys),
      AUTH_KEYS_FILE: authFile,
    });
    expect(error.issues).toEqual([
      { key: "AUTH_KEYS", reason: "密钥只认 AUTH_KEYS_FILE（值是文件路径），任何环境都不接受明文" },
    ]);
  });

  const SHORT = Buffer.alloc(31, 9).toString("base64");
  const bad: Array<[string, string, string]> = [
    ["不是 JSON", `{ ticket: ${SHORT}`, "文件内容不是合法的 JSON"],
    [
      "缺 device",
      JSON.stringify({ ticket: key(11), mfa: authKeys.mfa }),
      "文件内容要是 { ticket, device, mfa }",
    ],
    [
      "ticket 只有 31 字节",
      JSON.stringify({ ...authKeys, ticket: SHORT }),
      "各是 base64 写的 32 字节",
    ],
    ["缺 mfa", JSON.stringify({ ticket: key(11), device: key(12) }), "mfa 一项不合格"],
    [
      "mfa 的 current 不在 keys 里",
      JSON.stringify({ ...authKeys, mfa: { current: "m9", keys: authKeys.mfa.keys } }),
      "current 指的 kid 不在 keys 里",
    ],
  ];

  it.each(bad)("%s：失败，报错不带文件内容", (label, content, reason) => {
    const error = failure({ ...base, AUTH_KEYS_FILE: fileWith(`bad-auth-${label}.json`, content) });
    expect(keysOf(error)).toEqual(["AUTH_KEYS_FILE"]);
    expect(error.issues[0]?.reason).toContain(reason);
    for (const mark of [SHORT, key(11), key(13), temp]) expect(error.message).not.toContain(mark);
  });

  it(".env.example 里这一项只有占位路径", () => {
    const example = readFileSync(new URL("../../../../.env.example", import.meta.url), "utf8");
    expect(example.split("\n").filter((line) => line.startsWith("AUTH_KEYS"))).toEqual([
      "AUTH_KEYS_FILE=<文件路径>",
    ]);
  });
});
