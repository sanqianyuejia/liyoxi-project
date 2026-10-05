// 全仓唯一的日志构造（W0-22；D7 第 9.1 节；01 第 12 节）：Pino，一行一条 JSON，写标准输出。
// 包级文件，与组合根并排：只给进程运行时（runtime.ts）与应用入口用，模块里要打日志的收一个 Logger 参数。
//
// 固定字段：ts、level、svc（api / worker）、env、ver（镜像标签）、node。别的字段由调用处给：
// reqId、actor、route、method、status、ms、evt、err。
// 脱敏：下面这些键不论出现在第几层（至多三层），值一律换成 ***。日志里不打印整段请求体。
// code（登录与手机号凭证）例外：只在顶层与装入参的几个容器里遮，免得把 err.code（数据库与系统错误码）也遮掉。
import { hostname } from "node:os";

import { destination, pino } from "pino";
import type { DestinationStream, Logger as PinoLogger } from "pino";

import type { AppEnv, AssemblyEntry, LogLevel } from "./kernel/index.js";

export type Logger = PinoLogger;

/** 值不进日志的键（D7 第 9.1 节“脱敏”）。键名按原样比，大小写两种常见写法都列上 */
export const LOG_REDACT_KEYS: readonly string[] = [
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  "set-cookie",
  "password",
  "phone",
  "idNo",
  "licenseNo",
  "paySign",
  "token",
  "secret",
  "apiKey",
  "privateKey",
];

/** code 只在这几个容器里遮 */
export const LOG_CODE_CONTAINERS: readonly string[] = [
  "query",
  "body",
  "params",
  "input",
  "payload",
];

const REDACT_PATHS = [
  ...LOG_REDACT_KEYS.flatMap((key) => {
    const leaf = /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `["${key}"]`;
    return [leaf.replace(/^\./, ""), `*${leaf}`, `*.*${leaf}`];
  }),
  "code",
  ...LOG_CODE_CONTAINERS.map((container) => `${container}.code`),
];

export interface LoggerOptions {
  /** 哪个进程 */
  svc: AssemblyEntry;
  env: AppEnv;
  level: LogLevel;
  /** 镜像标签 */
  version: string;
  /** 写到哪；不给即标准输出。用例里传一个收集流 */
  destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions): Logger {
  return pino(
    {
      level: options.level,
      base: { svc: options.svc, env: options.env, ver: options.version, node: hostname() },
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACT_PATHS, censor: "***" },
    },
    options.destination ?? destination({ dest: 1, sync: true }),
  );
}
