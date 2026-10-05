// 协议类列表的游标（约定 C42：不透明）。协议至多七份，实际总是一页；游标只是把“从第几条起”包一层。
import { AppError } from "../kernel/index.js";

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

function offsetOf(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const offset = /^\d{1,9}$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(offset)) {
    throw new AppError("VALIDATION_FAILED", { message: "游标不合法" });
  }
  return offset;
}

/** 从已排好序的全量里切一页 */
export function pageOf<T>(all: readonly T[], cursor: string | undefined, limit: number): Page<T> {
  const offset = offsetOf(cursor);
  const end = offset + limit;
  const hasMore = end < all.length;
  return {
    items: all.slice(offset, end),
    nextCursor: hasMore ? Buffer.from(String(end), "utf8").toString("base64url") : null,
    hasMore,
  };
}
