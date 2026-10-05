// 成功体与错误映射（约定 C21–C27）。
//   业务错误 AppError         → 按符号名查契约的表：HTTP 状态、数值码、可否重试；文案与 details 取错误自己带的
//   入参不合结构              → 400 VALIDATION_FAILED，带 fieldErrors
//   没有这条路由              → 404 NOT_FOUND
//   其余（含内核断言、未预期） → 500 INTERNAL，用契约里的默认文案，不带内部信息；原始错误只进日志
//   限流超限 RateLimited       → 429 RATE_LIMITED
// 429 与 503 带 Retry-After（约定 C18）：限流给的是超限窗口的剩余秒数，其余是 1。端上只按符号名 error 判断。
import { ERRORS } from "@liyoxi/contract";
import type { ErrorBody, FieldError } from "@liyoxi/contract";
import { isAppError } from "@liyoxi/services";
import type { ErrorSymbol } from "@liyoxi/services";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ApiEnv } from "../context.js";

/** 入参不合结构：校验钩子与读请求体的地方抛它 */
export class ValidationFailure extends Error {
  readonly fieldErrors: readonly FieldError[];

  constructor(fieldErrors: readonly FieldError[]) {
    super("入参不合结构");
    this.name = "ValidationFailure";
    this.fieldErrors = fieldErrors;
  }
}

/** 限流超限：限流中间件抛它。retryAfterSec 进回包头 Retry-After */
export class RateLimited extends Error {
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number) {
    super("请求过于频繁");
    this.name = "RateLimited";
    this.retryAfterSec = retryAfterSec;
  }
}

/** 成功体 { code: 0, message: "ok", data }；没有返回内容的写接口 data 给 null */
export function ok<T>(c: Context<ApiEnv>, data: T) {
  return c.json({ code: 0 as const, message: "ok" as const, data }, 200);
}

interface Resolved {
  symbol: ErrorSymbol;
  message?: string;
  details?: unknown;
  fieldErrors?: readonly FieldError[];
  retryAfterSec?: number;
}

function resolve(error: unknown): Resolved {
  if (isAppError(error)) {
    return { symbol: error.error, message: error.message, details: error.details };
  }
  if (error instanceof ValidationFailure) {
    return { symbol: "VALIDATION_FAILED", fieldErrors: error.fieldErrors };
  }
  if (error instanceof RateLimited) {
    return { symbol: "RATE_LIMITED", retryAfterSec: error.retryAfterSec };
  }
  if (error instanceof HTTPException) {
    // 框架自己抛的：请求体不是合法 JSON（400）、内容类型不对（415）等都算入参不合；约定不用 415、422
    if (error.status === 404) return { symbol: "NOT_FOUND" };
    if (error.status >= 400 && error.status < 500) return { symbol: "VALIDATION_FAILED" };
  }
  return { symbol: "INTERNAL" };
}

function respond(c: Context<ApiEnv>, resolved: Resolved): Response {
  const def = ERRORS[resolved.symbol];
  const body: ErrorBody = {
    code: def.code,
    error: resolved.symbol,
    message: resolved.message ?? def.message,
    retryable: def.retryable,
    requestId: c.get("requestId"),
    ...(resolved.fieldErrors === undefined ? {} : { fieldErrors: [...resolved.fieldErrors] }),
    ...(resolved.details === undefined ? {} : { details: resolved.details }),
  };
  if (def.http === 429 || def.http === 503) {
    c.header("Retry-After", String(resolved.retryAfterSec ?? 1));
  }
  return c.json(body, def.http);
}

export const onError: ErrorHandler<ApiEnv> = (error, c) => {
  const resolved = resolve(error);
  if (ERRORS[resolved.symbol].http >= 500) {
    c.get("log").error({ evt: "http.error", error: resolved.symbol, err: error }, "请求出错");
  }
  return respond(c, resolved);
};

export const notFound: NotFoundHandler<ApiEnv> = (c) => respond(c, { symbol: "NOT_FOUND" });
