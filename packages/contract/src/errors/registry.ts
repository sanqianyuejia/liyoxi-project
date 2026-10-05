// 全部错误码的查找表：通用码（common.ts）加各文档定义的领域码（domain/）。
// 端上逻辑只按符号名判断（约定 C22）；数值只用于日志与排障。纯常量：本文件不引任何包。
import { COMMON_ERRORS, type CommonErrorSymbol } from "./common.js";
import type { DomainErrorGroup } from "./define.js";
import { DOMAIN_ERROR_GROUPS } from "./domain/index.js";
import type { ErrorCodeDef } from "./types.js";

/** 逐个文件取符号名再并起来（写成带类型参数的条件类型才会对联合类型逐个分配） */
type SymbolOf<G> = G extends DomainErrorGroup<infer S> ? S : never;

/** 领域错误码的符号名 */
export type DomainErrorSymbol = SymbolOf<(typeof DOMAIN_ERROR_GROUPS)[number]>;
/** 全部错误码的符号名：通用码加领域码 */
export type ErrorSymbol = CommonErrorSymbol | DomainErrorSymbol;

/** 领域错误码：符号名 → 定义。符号全仓唯一，重名由契约自测与 pnpm api-registries:check 拦 */
export const DOMAIN_ERRORS = Object.assign(
  {},
  ...DOMAIN_ERROR_GROUPS.map((group) => group.errors),
) as Readonly<Record<DomainErrorSymbol, ErrorCodeDef>>;

/** 领域错误码的符号名，按定义方文档、文档内按登记的先后 */
export const DOMAIN_ERROR_SYMBOLS = Object.keys(DOMAIN_ERRORS) as DomainErrorSymbol[];

/** 全部错误码：符号名 → 定义 */
export const ERRORS: Readonly<Record<ErrorSymbol, ErrorCodeDef>> = {
  ...COMMON_ERRORS,
  ...DOMAIN_ERRORS,
};

export function isDomainErrorSymbol(value: unknown): value is DomainErrorSymbol {
  return typeof value === "string" && Object.hasOwn(DOMAIN_ERRORS, value);
}

export function isErrorSymbol(value: unknown): value is ErrorSymbol {
  return typeof value === "string" && Object.hasOwn(ERRORS, value);
}

/** 领域错误码的定义方文档名；不是领域码时返回 undefined */
export function domainErrorSource(symbol: string): string | undefined {
  return DOMAIN_ERROR_GROUPS.find((group) => Object.hasOwn(group.errors, symbol))?.source;
}
