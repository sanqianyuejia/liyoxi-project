// 定时器的登记、改期与取消（W0-17）。依据：01 分组 第 2.5 节状态机；D3 第 21.2 节；x01 第 4.1 节。
//
//   1. 都在业务事务里调，调用方已持有定时器主体业务行的锁；arm、cancel 自己不锁业务行。
//      timer 不在加锁顺序表里（lock_rank = null）：这里对 timer 行的加锁一次一行（arm），或按主键升序（cancel）。
//   2. 同一语义目标只有一行未取消：靠部分唯一索引 uq_timer_dedupe_key_live。arm 先锁同键未取消的行再决定怎么办；
//      没有就插入，插入时被并发的同键登记抢了先（ON CONFLICT DO NOTHING 影响 0 行）就回头再看一遍。
//   3. 改期没有单独的接口：同键再 arm 一次。目标日期变了是新键，旧键由调用方按 keyPrefix 取消。
//   4. fire_at 是业务时间，由调用方按注入的时钟给；created_at、updated_at 是基础设施列，用库时间。
import { AsyncLocalStorage } from "node:async_hooks";

import type { EnumValue, TIMER_STATUS } from "@liyoxi/contract/enums";

import { isUuid, uuidv7 } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { timerKey } from "./keys.js";
import type { TimerSubject } from "./keys.js";
import type { TimerRegistry } from "./registry.js";

export type TimerStatus = EnumValue<typeof TIMER_STATUS>;

export interface ArmInput {
  /** 契约里登记的 kind：有主体的定时器，或周期任务名（这时不给 subject） */
  readonly kind: string;
  /** 主体：表名与主键。周期任务行不给 */
  readonly subject?: TimerSubject;
  /** 到期时间，按注入的时钟算 */
  readonly fireAt: Date;
  /** 语义去重键：{kind}:{subject_type}:{id}[:后缀]，周期任务 {kind}:{栅格时刻}；用 keys.ts 拼 */
  readonly key: string;
  /** 登记时的参数快照；改期时整个换掉 */
  readonly payload?: Readonly<Record<string, unknown>>;
  /** 归属，只存 id；有门店必有主体 */
  readonly entityId?: string;
  readonly storeId?: string;
}

/** created 新建；rescheduled 改期；revived 复活（failed，或声明了跳过后可复活的 skipped）；unchanged 不动 */
export type ArmOutcome = "created" | "rescheduled" | "revived" | "unchanged";

export interface ArmResult {
  /** 同键未取消的那一行 */
  readonly id: string;
  /** 这次调用之后它的状态 */
  readonly status: TimerStatus;
  readonly outcome: ArmOutcome;
}

export interface CancelInput {
  readonly subject: TimerSubject;
  /** 只取消这些 kind；不给即不限 */
  readonly kinds?: readonly string[];
  /** 只取消去重键以它开头的 */
  readonly keyPrefix?: string;
}

/** 同键已有未取消的行时怎么办（01 分组 第 2.5 节状态机里 timers.arm 的那几行） */
const ON_SAME_KEY: Record<Exclude<TimerStatus, "cancelled">, "reschedule" | "revive" | "keep"> = {
  scheduled: "reschedule",
  dispatched: "keep", // 正在执行，不动
  fired: "keep", // 同一语义目标已处理过，不重复创建
  skipped: "keep", // 声明了 rearmAfterSkip 的 kind 例外，见 arm
  failed: "revive",
};

const ARM_ROUNDS = 10;

const current = new AsyncLocalStorage<string>();

/** 执行定时器处理器时包一层（W0-23 的 runTimer 调）：处理器里的 cancel 跳过正在执行的这一条 */
export function runAsCurrentTimer<T>(timerId: string, fn: () => Promise<T>): Promise<T> {
  return current.run(timerId, fn);
}

/** 正在执行的定时器；不在处理器里即 undefined */
export const currentTimerId = (): string | undefined => current.getStore();

/** 入参把关；返回这个 kind 是不是声明了“跳过后可复活” */
function checkArm(registry: TimerRegistry, input: ArmInput): boolean {
  const { kind, subject, key, fireAt, entityId, storeId } = input;
  if (!(fireAt instanceof Date) || Number.isNaN(fireAt.getTime())) {
    throw new TypeError("timers.arm：fireAt 不是合法的时刻");
  }
  for (const id of [subject?.id, entityId, storeId]) {
    if (id !== undefined && !isUuid(id)) throw new TypeError("timers.arm：id 要是小写的 UUID");
  }
  if (storeId !== undefined && entityId === undefined) {
    throw new TypeError("timers.arm：给了 storeId 就要给 entityId");
  }
  const known = subject === undefined ? undefined : registry.timer(kind);
  if (subject === undefined) {
    if (!registry.isJob(kind)) {
      throw new TypeError(
        `timers.arm：${kind} 不是契约里登记的周期任务；有主体的定时器要给 subject`,
      );
    }
  } else if (known === undefined) {
    throw new TypeError(`timers.arm：${kind} 不在契约的定时器登记里`);
  } else if (!known.subjects.includes(subject.type)) {
    throw new TypeError(
      `timers.arm：契约里 ${kind} 的主体是 ${known.subjects.join("、")}，收到 ${subject.type}`,
    );
  }
  // 键的形状：{kind}:{subject_type}:{id}[:后缀]；周期任务 {kind}:{栅格时刻}
  const head = subject === undefined ? kind : timerKey(kind, subject);
  if (
    subject === undefined
      ? !key.startsWith(`${head}:`)
      : key !== head && !key.startsWith(`${head}:`)
  ) {
    throw new TypeError(`timers.arm：去重键要以 "${head}" 开头，收到 ${JSON.stringify(key)}`);
  }
  return known?.rearmAfterSkip === true;
}

/** 登记一个定时器；同键已有未取消的行时按状态改期、复活或不动 */
export async function arm(tx: Tx, registry: TimerRegistry, input: ArmInput): Promise<ArmResult> {
  const rearmAfterSkip = checkArm(registry, input);
  const { kind, subject, key, fireAt } = input;
  const payload = input.payload === undefined ? null : JSON.stringify(input.payload);

  // 回头再看的情形：插入被并发的同键登记抢了先，而再看时那一行又刚好被并发的取消拿掉。
  // 调用方持有主体行锁时不会发生；没锁时每回头一次都要再凑齐这两样，给足次数即可
  for (let round = 0; round < ARM_ROUNDS; round += 1) {
    const [live] = await tx.$queryRawUnsafe<
      { id: string; status: Exclude<TimerStatus, "cancelled"> }[]
    >(
      "SELECT id::text AS id, status FROM timer WHERE dedupe_key = $1::text AND status <> 'cancelled' FOR UPDATE",
      key,
    );
    if (live === undefined) {
      const id = uuidv7();
      const inserted = await tx.$executeRawUnsafe(
        `INSERT INTO timer (id, kind, subject_type, subject_id, entity_id, store_id, fire_at, dedupe_key, payload)
         VALUES ($1::uuid, $2::text, $3::text, $4::uuid, $5::uuid, $6::uuid, $7::timestamptz, $8::text, $9::jsonb)
         ON CONFLICT (dedupe_key) WHERE status <> 'cancelled' DO NOTHING`,
        id,
        kind,
        subject?.type ?? null,
        subject?.id ?? null,
        input.entityId ?? null,
        input.storeId ?? null,
        fireAt,
        key,
        payload,
      );
      if (inserted === 1) return { id, status: "scheduled", outcome: "created" };
      continue;
    }
    const action =
      live.status === "skipped" && rearmAfterSkip ? "revive" : ON_SAME_KEY[live.status];
    if (action === "keep") return { id: live.id, status: live.status, outcome: "unchanged" };
    if (action === "reschedule") {
      await tx.$executeRawUnsafe(
        "UPDATE timer SET fire_at = $2::timestamptz, payload = $3::jsonb, updated_at = now() WHERE id = $1::uuid",
        live.id,
        fireAt,
        payload,
      );
      return { id: live.id, status: "scheduled", outcome: "rescheduled" };
    }
    await tx.$executeRawUnsafe(
      `UPDATE timer SET status = 'scheduled', fire_at = $2::timestamptz, payload = $3::jsonb, attempts = 0,
              retry_at = NULL, fired_at = NULL, updated_at = now()
        WHERE id = $1::uuid`,
      live.id,
      fireAt,
      payload,
    );
    return { id: live.id, status: "scheduled", outcome: "revived" };
  }
  throw new Error(`timers.arm：同键 ${key} 的行一直在被并发地登记与取消，没有登记上`);
}

/**
 * 取消一个主体上未完成的定时器（scheduled、dispatched → cancelled），返回被取消的行的 id。
 * 跳过正在执行的这一条（处理器里调到时）。已取消的行不占键：同键之后可以重新登记。
 */
export async function cancel(tx: Tx, input: CancelInput): Promise<string[]> {
  const { subject, kinds, keyPrefix } = input;
  if (!isUuid(subject.id)) throw new TypeError("timers.cancel：subject.id 要是小写的 UUID");
  if (kinds?.length === 0) return [];
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `WITH target AS (
       SELECT id FROM timer
        WHERE subject_type = $1::text AND subject_id = $2::uuid AND status IN ('scheduled', 'dispatched')
          AND ($3::text[] IS NULL OR kind = ANY($3::text[]))
          AND ($4::text IS NULL OR starts_with(dedupe_key, $4::text))
          AND ($5::uuid IS NULL OR id <> $5::uuid)
        ORDER BY id
          FOR UPDATE
     )
     UPDATE timer SET status = 'cancelled', updated_at = now()
       FROM target WHERE timer.id = target.id
     RETURNING timer.id::text AS id`,
    subject.type,
    subject.id,
    kinds ?? null,
    keyPrefix ?? null,
    currentTimerId() ?? null,
  );
  return rows.map((row) => row.id).sort();
}
