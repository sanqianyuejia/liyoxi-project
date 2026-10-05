// 服务层的业务错误（W0-07）。只带契约里的错误符号名：数值码、HTTP 状态、可否重试由接口层按符号名查契约的表。
// 形状借自参考工程 packages/services/src/errors.ts 的 AppError，错误码改用契约的符号名。
import { ERRORS } from "@liyoxi/contract/errors";
import type { ErrorSymbol as ContractErrorSymbol } from "@liyoxi/contract/errors";

/** 契约里的错误符号名：通用码加各接口文档定义的领域码（W1-03 起放宽；原先只有通用码） */
export type ErrorSymbol = ContractErrorSymbol;

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
    super(options.message ?? ERRORS[error].message, { cause: options.cause });
    this.name = "AppError";
    this.error = error;
    this.details = options.details;
  }
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;
