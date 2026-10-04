import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("第一版没有成组变量", () => {
    expect(ENV_GROUPS).toEqual([]);
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
    ]);
  });
});
