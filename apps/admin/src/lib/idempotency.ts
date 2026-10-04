// 幂等键（约定 C48；D7 第 3.1 节）：键属于操作人的一次意图，不属于一次 HTTP 请求。
// 打开确认弹层或进入确认页时生成 <动作名>:<uuid>；这次意图下的重试（双击、超时重发、再验证后重放）复用同一个键；
// 成功、改了表单内容、离开页面时丢弃，改了内容必须换键。
import { useCallback, useState } from "react";

const KEY_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const ACTION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 生成一个幂等键：<动作名>:<uuid>。动作名只许字母、数字、下划线、短横线 */
export function newIdempotencyKey(action: string): string {
  if (!ACTION_PATTERN.test(action)) {
    throw new Error(`幂等键的动作名只许字母、数字、下划线、短横线，且不超过 64 个字符：${action}`);
  }
  return `${action}:${crypto.randomUUID()}`;
}

/** 键长不超过 128，字符集 [A-Za-z0-9:_-] */
export function isValidIdempotencyKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/**
 * 一次意图一个键：组件挂载（弹层打开）时生成，重试复用；提交成功或内容改动后调 renew 换键。
 * 用法：const intent = useIntentKey("refund-execute"); 请求时带 headers: { "Idempotency-Key": intent.key }
 */
export function useIntentKey(action: string): { key: string; renew: () => void } {
  const [key, setKey] = useState(() => newIdempotencyKey(action));
  const renew = useCallback(() => setKey(newIdempotencyKey(action)), [action]);
  return { key, renew };
}
