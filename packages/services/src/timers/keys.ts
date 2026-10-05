// 去重键的形状（W0-17）：有主体的定时器 {kind}:{subject_type}:{id}[:后缀]；周期任务 {kind}:{本期的栅格时刻}。
// 依据：x01 第 4.1、4.2 节；01 分组 第 2.5 节。这里只给形状，不替各域拼具体的键：
// 后缀里放什么（目标日期、轮次、用途）由登记方照 x01 第 4.1 节的表定。

export interface TimerSubject {
  /** 主体的表名（最终表名），即 timer.subject_type */
  readonly type: string;
  /** 主体行的主键，即 timer.subject_id */
  readonly id: string;
}

/** 有主体的定时器的去重键。后缀按顺序接在后面，各段不得为空 */
export function timerKey(
  kind: string,
  subject: TimerSubject,
  ...suffix: readonly (string | number)[]
): string {
  const parts = [kind, subject.type, subject.id, ...suffix.map(String)];
  if (parts.some((part) => part === "")) throw new TypeError("去重键的各段不得为空");
  return parts.join(":");
}

/** 一个主体上某个 kind 的全部键的公共前缀，带结尾的冒号：目标日期变了，按它取消旧键 */
export function timerKeyPrefix(kind: string, subject: TimerSubject): string {
  return `${timerKey(kind, subject)}:`;
}

/** 栅格时刻在键里的写法：UTC 的 ISO 8601，秒精度，YYYY-MM-DDTHH:mm:ssZ（任务书 第 11 节第 4 项） */
export function slotText(slot: Date): string {
  return `${slot.toISOString().slice(0, 19)}Z`;
}

/** 周期任务一期的去重键 */
export function recurringKey(kind: string, slot: Date): string {
  return `${kind}:${slotText(slot)}`;
}
