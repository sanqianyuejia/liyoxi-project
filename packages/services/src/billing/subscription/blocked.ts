// 履约受阻（W1-11a）：保存点里抛出来的错怎么归成原因码。依据：D1 第 6.4 节的受阻原因表；ADR-0046。
// 原则：收了钱必须有去处——保存点里的失败（业务前提不成立、约束冲突、自检失败、推进失败、别的非预期错误）
// 一律回滚到保存点并返回 blocked，由入账函数开差异单；只有“该整个重试”的基础设施错误原样抛出，不算受阻。
import type { FulfillBlocked, FulfillBlockReason } from "@liyoxi/contract";

import { isAppError, isRetryableDbError, KernelViolation, sqlStateOf } from "../../kernel/index.js";
import { LedgerError } from "../ledger/types.js";

/** 履约里已知的受阻：带原因码与排查信息 */
export class FulfillBlockedError extends Error {
  readonly reason: FulfillBlockReason;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(reason: FulfillBlockReason, detail: Record<string, unknown> = {}) {
    super(`履约受阻：${reason}`);
    this.name = "FulfillBlockedError";
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * 不算受阻、要原样抛出去的错：整个入账事务回滚，由调用方稍后重试。
 *   死锁、序列化失败、锁等待超时（tx.run 会整个重试）；等账户锁超时 ACCOUNT_BUSY；
 *   连接断开、资源不足、语句被取消（SQLSTATE 08、53、57 类）；Prisma 报的连接与事务超时（P1xxx、P2024、P2028）；
 *   内核的违规断言（锁序、事务内外呼）：那是代码缺陷，要在本地与 CI 里红出来，不能被当成一次受阻吞掉。
 */
export function isNotBlockage(error: unknown): boolean {
  if (isRetryableDbError(error) || error instanceof KernelViolation) return true;
  if (isAppError(error) && error.error === "ACCOUNT_BUSY") return true;
  if (/^(08|53|57)/.test(sqlStateOf(error) ?? "")) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^P(1\d{3}|2024|2028)$/.test(code);
}

/** 排查信息要能存进 jsonb：日期转成字符串，转不了的整个丢掉 */
function jsonSafe(value: unknown): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 把保存点里接住的错归成受阻结果。stage：错出在推进那一段，还是之后的履约 */
export function blockedResult(stage: "advance" | "fulfill", error: unknown): FulfillBlocked {
  if (error instanceof FulfillBlockedError) {
    return { status: "blocked", reasonCode: error.reason, detail: jsonSafe(error.detail) };
  }
  const sqlState = sqlStateOf(error);
  const detail = jsonSafe({
    error: error instanceof Error ? error.name : typeof error,
    message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    ...(sqlState === undefined ? {} : { sqlState }),
    ...(error instanceof LedgerError ? { reason: error.reason, details: error.details } : {}),
  });
  const reasonCode: FulfillBlockReason =
    stage === "advance"
      ? "ADVANCE_FAILED"
      : error instanceof LedgerError && error.reason === "self_check"
        ? "SELF_CHECK_FAILED"
        : sqlState?.startsWith("23") === true
          ? "CONSTRAINT_VIOLATION"
          : "UNEXPECTED";
  return { status: "blocked", reasonCode, detail };
}
