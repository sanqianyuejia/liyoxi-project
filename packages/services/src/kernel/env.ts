// 环境变量的唯一入口（D7 第 2.5、7.5 节）：全部配置只经 loadEnv() 的 Zod 校验，缺项或写错即抛错。
//
// 规则（W0-03 任务书 第 11 节第 2、3 项）：
//   1. 空串、只有空白的值，当没填。
//   2. 连接串 DATABASE_URL、REDIS_URL 是敏感项、必填。APP_ENV 为 local、test 时可以给明文；
//      stg、prod 只认 *_FILE（值是文件路径，文件里放连接串），给了明文即失败。
//   3. 报错逐条是“键名: 原因”，不带任何值（值、文件路径、文件内容都不出现）。
//   4. 成组的变量成对校验：配了一部分即失败（groupIssues）。第一版没有成组变量，后续包往 ENV_GROUPS 里加。
// 后续包加变量：在这里加键与校验，同 PR 改 .env.example（node infra/ci/check-env-example.mjs 核对键集合）。
// 本文件不写相对导入：infra/ci/check-env-example.mjs 用 Node 自带的类型擦除直接加载它。

import { readFileSync } from "node:fs";

import { z } from "zod";

export const APP_ENVS = ["local", "test", "stg", "prod"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** 连接串可以给明文的环境；其余环境只认 *_FILE */
const PLAINTEXT_ENVS: readonly string[] = ["local", "test"];

/** 敏感的连接串：键名 → 允许的协议 */
const CONNECTION_KEYS = {
  DATABASE_URL: ["postgresql:", "postgres:"],
  REDIS_URL: ["redis:", "rediss:"],
} as const;
type ConnectionKey = keyof typeof CONNECTION_KEYS;

/** loadEnv 读的全部键名；.env.example 的键集合须与它相等 */
export const ENV_KEYS: readonly string[] = [
  "APP_ENV",
  "LOG_LEVEL",
  "DATABASE_URL",
  "DATABASE_URL_FILE",
  "REDIS_URL",
  "REDIS_URL_FILE",
];

export interface Env {
  readonly APP_ENV: AppEnv;
  readonly LOG_LEVEL: LogLevel;
  readonly DATABASE_URL: string;
  readonly REDIS_URL: string;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface EnvIssue {
  /** 环境变量的键名 */
  key: string;
  /** 原因；不含任何值 */
  reason: string;
}

/** 一组要么全配、要么全不配的变量（如微信支付的商户号、证书序列号、私钥、APIv3 密钥） */
export interface EnvGroup {
  name: string;
  keys: readonly string[];
}

/** 成组变量的登记处。第一版为空；后续包加变量时往这里加组 */
export const ENV_GROUPS: readonly EnvGroup[] = [];

export class EnvError extends Error {
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.key}: ${issue.reason}`);
    super(`环境变量校验失败：\n${lines.join("\n")}`);
    this.name = "EnvError";
    this.issues = issues;
  }
}

/** 取一个键的值：去掉首尾空白；空串当没填 */
function read(source: EnvSource, key: string): string | undefined {
  const value = source[key]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/**
 * 成组变量成对校验：一组里配了一部分、没配全，逐个报出缺的键。
 * 全配或全不配都不报。
 */
export function groupIssues(source: EnvSource, groups: readonly EnvGroup[]): EnvIssue[] {
  const issues: EnvIssue[] = [];
  for (const group of groups) {
    const missing = group.keys.filter((key) => read(source, key) === undefined);
    if (missing.length === 0 || missing.length === group.keys.length) continue;
    for (const key of missing) {
      const others = group.keys.filter((other) => other !== key).join("、");
      issues.push({
        key,
        reason: `与 ${others} 成组（${group.name}），这一组只配了一部分，缺这一项`,
      });
    }
  }
  return issues;
}

/** 按规则 2 取出一个连接串：明文或 *_FILE 二选一 */
function readConnection(
  source: EnvSource,
  key: ConnectionKey,
  appEnv: string | undefined,
  issues: EnvIssue[],
): string | undefined {
  const fileKey = `${key}_FILE`;
  const plain = read(source, key);
  const file = read(source, fileKey);

  if (plain !== undefined && file !== undefined) {
    issues.push({ key, reason: `与 ${fileKey} 只能给一个` });
    return undefined;
  }
  if (plain !== undefined) {
    // APP_ENV 缺失或写错时另有一条报错；这里只在确知不是 local、test 时拦明文
    if (appEnv !== undefined && (APP_ENVS as readonly string[]).includes(appEnv)) {
      if (!PLAINTEXT_ENVS.includes(appEnv)) {
        issues.push({ key, reason: `${appEnv} 环境只认 ${fileKey}，不接受明文` });
        return undefined;
      }
    }
    return plain;
  }
  if (file !== undefined) {
    let content: string;
    try {
      content = readFileSync(file, "utf8").trim();
    } catch {
      issues.push({ key: fileKey, reason: "所指的文件读不了" });
      return undefined;
    }
    if (content === "") {
      issues.push({ key: fileKey, reason: "所指的文件是空的" });
      return undefined;
    }
    return content;
  }
  issues.push({
    key,
    reason: `必填，未配置（local、test 可以直接给，其余环境给 ${fileKey}）`,
  });
  return undefined;
}

function hasProtocol(value: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const EnvSchema = z.object({
  APP_ENV: z.enum(APP_ENVS, { error: `必填，只能是 ${APP_ENVS.join("、")} 之一` }),
  LOG_LEVEL: z.enum(LOG_LEVELS, { error: `只能是 ${LOG_LEVELS.join("、")} 之一` }).default("info"),
  DATABASE_URL: z
    .string()
    .refine((value) => hasProtocol(value, CONNECTION_KEYS.DATABASE_URL), {
      error: "不是合法的 postgresql:// 连接串",
    })
    .optional(),
  REDIS_URL: z
    .string()
    .refine((value) => hasProtocol(value, CONNECTION_KEYS.REDIS_URL), {
      error: "不是合法的 redis:// 连接串",
    })
    .optional(),
});

/**
 * 读取并校验环境变量。任何一项不合格即抛 EnvError，一次列出全部问题。
 * @param source 缺省读 process.env；测试里传对象
 * @param options.groups 成组规则，缺省用 ENV_GROUPS
 */
export function loadEnv(
  source: EnvSource = process.env,
  options: { groups?: readonly EnvGroup[] } = {},
): Env {
  const issues: EnvIssue[] = [];
  const appEnv = read(source, "APP_ENV");

  const parsed = EnvSchema.safeParse({
    APP_ENV: appEnv,
    LOG_LEVEL: read(source, "LOG_LEVEL"),
    DATABASE_URL: readConnection(source, "DATABASE_URL", appEnv, issues),
    REDIS_URL: readConnection(source, "REDIS_URL", appEnv, issues),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ key: issue.path.join("."), reason: issue.message });
    }
  }
  issues.push(...groupIssues(source, options.groups ?? ENV_GROUPS));

  if (issues.length > 0 || !parsed.success) {
    const order = (issue: EnvIssue) => {
      const index = ENV_KEYS.indexOf(issue.key);
      return index === -1 ? ENV_KEYS.length : index;
    };
    throw new EnvError([...issues].sort((a, b) => order(a) - order(b)));
  }

  const { APP_ENV, LOG_LEVEL, DATABASE_URL, REDIS_URL } = parsed.data;
  // 连接串缺失时上面已经报过并抛出；到这里一定有值
  if (DATABASE_URL === undefined || REDIS_URL === undefined) {
    throw new EnvError([{ key: "DATABASE_URL", reason: "必填，未配置" }]);
  }
  return Object.freeze({ APP_ENV, LOG_LEVEL, DATABASE_URL, REDIS_URL });
}
