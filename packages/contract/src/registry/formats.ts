// 名字的写法：库里对应列的 CHECK 正则，照抄 01 分组的手写约束。
// pnpm enums:check 拿这里的 pattern 与库里的定义逐字比对；pnpm registry:check 用它们校验登记的每个名字。
// 纯常量：本文件不引任何包。

/** 一种名字的写法，对应库里一条“列匹配正则”的 CHECK */
export interface NameFormat {
  /** 库列，写成“表.列” */
  readonly column: string;
  /** 正则的原文，与库里 CHECK 的写法逐字相同 */
  readonly pattern: string;
  /** 长度上限：库里 CHECK 另写了 char_length(列) <= N 的才有 */
  readonly maxLength?: number;
}

export const NAME_FORMATS = {
  /** 事件名（ck_outbox_event_event_type）：小写点分，至少两段 */
  eventType: {
    column: "outbox_event.event_type",
    pattern: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$",
  },
  /** 聚合（ck_outbox_event_aggregate_type）：最终表名 */
  aggregateType: { column: "outbox_event.aggregate_type", pattern: "^[a-z][a-z0-9_]*$" },
  /** 订阅者名（ck_outbox_delivery_subscriber） */
  subscriber: { column: "outbox_delivery.subscriber", pattern: "^[A-Za-z][A-Za-z0-9_.]{0,63}$" },
  /** 定时器与周期任务的 kind（ck_timer_kind） */
  timerKind: { column: "timer.kind", pattern: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$" },
  /** 定时器主体（ck_timer_subject_type）：最终表名 */
  timerSubjectType: { column: "timer.subject_type", pattern: "^[a-z][a-z0-9_]*$" },
} as const satisfies Record<string, NameFormat>;

/** 事件名另有两条库里不查的规矩（x01 第 2.1 节 N1）：点分 2–3 段，全长不超过 64 个字符 */
export const EVENT_NAME_MAX_LENGTH = 64;
export const EVENT_NAME_MIN_SEGMENTS = 2;
export const EVENT_NAME_MAX_SEGMENTS = 3;

/** 一个值是否合这种写法 */
export function matchesFormat(format: NameFormat, value: string): boolean {
  if (format.maxLength !== undefined && value.length > format.maxLength) return false;
  return new RegExp(format.pattern).test(value);
}
