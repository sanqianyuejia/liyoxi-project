// 领域错误码的声明形态（约定 C25、C28；裁决 A70）。纯常量：本文件不引任何包。
import type { ErrorCodeDef } from "./types.js";

/** 取号区间，两端都含（裁决 A70：各文档在自己的区间内取号，避免撞号） */
export type CodeRange = readonly [from: number, to: number];

/** 一份分组接口文档定义的领域错误码 */
export interface DomainErrorGroup<S extends string = string> {
  /** 定义方：分组接口文档名（如 m01-account），与文件名相同 */
  readonly source: string;
  /** 该文档的取号区间 */
  readonly ranges: readonly CodeRange[];
  /** 符号名 → 定义 */
  readonly errors: Readonly<Record<S, ErrorCodeDef>>;
}

/** 一个定义方文档一个文件，各调一次 */
export function defineDomainErrors<const S extends string>(
  source: string,
  ranges: readonly CodeRange[],
  errors: Readonly<Record<S, ErrorCodeDef>>,
): DomainErrorGroup<S> {
  return { source, ranges, errors };
}

/**
 * 一行一个码：数值、HTTP、可重试、默认文案；第五个参数写 "details" 即带 details。
 * details 的结构（Zod）不在这里，随用到它的域的第一个后端 PR 登记。
 */
export function def(
  code: number,
  http: ErrorCodeDef["http"],
  retryable: boolean,
  message: string,
  details?: "details",
): ErrorCodeDef {
  return { code, http, retryable, message, hasDetails: details === "details" };
}
