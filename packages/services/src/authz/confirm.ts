// 二次确认回显（W1-01a）：请求体带的 confirm 与库里当前值逐字段比，不一致即 409 CONFIRM_MISMATCH。
// 依据：约定 C54；D4 第 7.5 节 L1。防的是界面数据过期与误点。比哪几个字段由各接口自己列（current 的键）；
// 在事务内、锁住对象之后调，比的才是“当前值”。
import { AppError } from "../kernel/index.js";

/** 回显里能出现的值：编号、金额分、积分、日期串等 */
export type ConfirmValue = string | number | boolean | null;

/**
 * current 列出的每个字段，confirm 里都要有且严格相等（不做类型转换：金额分是数字就必须回数字）。
 * confirm 多带的字段不看；缺了、不是对象，都算不一致。
 */
export function assertConfirm<K extends string>(
  confirm: unknown,
  current: Readonly<Record<K, ConfirmValue>>,
): void {
  const echoed =
    typeof confirm === "object" && confirm !== null && !Array.isArray(confirm)
      ? (confirm as Record<string, unknown>)
      : null;
  const matches =
    echoed !== null &&
    (Object.keys(current) as K[]).every(
      (key) => Object.hasOwn(echoed, key) && echoed[key] === current[key],
    );
  if (!matches) throw new AppError("CONFIRM_MISMATCH");
}
