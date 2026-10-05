// 服务层的业务错误（W0-07）。只带契约里的错误符号名：数值码、HTTP 状态、可否重试由接口层按符号名查契约的表。
// 形状借自参考工程 packages/services/src/errors.ts 的 AppError，错误码改用契约的符号名。
import { COMMON_ERRORS } from "@liyoxi/contract/errors";
import type { CommonErrorSymbol } from "@liyoxi/contract/errors";

/** 契约里的错误符号名。现在只有通用码；域错误码进契约之后，把它放宽到那边的类型 */
export type ErrorSymbol = CommonErrorSymbol;

export interface AppErrorOptions {
  /** 不给即用契约里的默认文案 */
  message?: string;
  /** 该错误码在契约里声明的附加数据 */
  details?: unknown;
  /** 底下的原始错误：只进日志，不出接口 */
  cause?: unknown;
}

export class AppError extends Error {
  readonly error: ErrorSymbol;
  readonly details: unknown;

  constructor(error: ErrorSymbol, options: AppErrorOptions = {}) {
    super(options.message ?? COMMON_ERRORS[error].message, { cause: options.cause });
    this.name = "AppError";
    this.error = error;
    this.details = options.details;
  }
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;
