// 任务进程的样例（W0-23）：带业务副作用的样例订阅者、定时器处理器、周期任务。只给测试用，不进生产装配。
// 副作用是 biz_sequence 里的一行计数（内核自己的表，应用角色可写）：处理器在自己的事务里把计数加一，
// 用例据此断言“恰好一次”。订阅者本身不做幂等：重复执行就会多加，恰好一次要靠派发序号与行锁保证。
// 定时器与周期任务的处理器自己守（见 claimOnce）：定时器的恰好一次本来就靠处理器的业务守卫（D3 第 21.3 节）。
// 名字沿用 W0-15、W0-17 的样例事件与样例 kind（lyxtest 前缀）；与 sampleSubscriberRegistration、
// sampleTimerRegistration 的名字相同，不能同时装配。
import { defineRegistration, uuidv7 } from "../kernel/index.js";
import type { ModuleRegistration, RecurringRunContext, Tx } from "../kernel/index.js";
import { SAMPLE_JOB_KINDS, SAMPLE_TIMER_KINDS } from "./timers.js";

/** 样例处理器的名字 → 它的计数行的前缀（biz_sequence.prefix，两到四个大写字母） */
export const WORKER_SAMPLE_COUNTERS = {
  "lyxtest.onPlacedCritical": "WSC",
  "lyxtest.onPlacedPlain": "WSP",
  [SAMPLE_TIMER_KINDS.revivable]: "WTC",
  [SAMPLE_TIMER_KINDS.plain]: "WTP",
  [SAMPLE_JOB_KINDS.every5]: "WJT",
  [SAMPLE_JOB_KINDS.daily]: "WJL",
} as const;
export type WorkerSampleName = keyof typeof WORKER_SAMPLE_COUNTERS;

/** 两个样例订阅者：关键类与非关键类，都订阅 lyxtest.order.placed */
export const WORKER_SAMPLE_SUBSCRIBERS = {
  critical: "lyxtest.onPlacedCritical",
  plain: "lyxtest.onPlacedPlain",
} as const;

interface RawDb {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

/**
 * 定时器与周期任务的样例处理器照真实处理器的规矩写：重复执行时自己守住“只做一次”。
 * 做法是文档里提醒类处理器的那一种——带去重键发一条事件（这里直接插一行 lyxtest.pinged），键已存在即已做过。
 * 两次并发执行时，后到的那次在唯一索引上等前一次提交，然后什么都不插。
 */
async function claimOnce(tx: Tx, key: string): Promise<boolean> {
  const inserted = await tx.$executeRawUnsafe(
    `INSERT INTO outbox_event (id, event_type, payload, actor_type, occurred_at, dedupe_key)
     VALUES ($1::uuid, 'lyxtest.pinged', '{"v":1,"n":1}'::jsonb, 'system', now(), $2::text)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    uuidv7(),
    key,
  );
  return inserted === 1;
}

/** 样例的业务写：把这个处理器的计数加一 */
export const bumpWorkerSample = (tx: Tx, name: WorkerSampleName): Promise<number> =>
  tx.$executeRawUnsafe(
    `INSERT INTO biz_sequence (prefix, biz_date, next_val) VALUES ($1::text, DATE '2026-01-05', 1)
     ON CONFLICT (prefix, biz_date) DO UPDATE SET next_val = biz_sequence.next_val + 1, updated_at = now()`,
    WORKER_SAMPLE_COUNTERS[name],
  );

/** 各样例处理器已提交的执行次数；没执行过的是 0 */
export async function workerSampleCounts(db: RawDb): Promise<Record<WorkerSampleName, number>> {
  const rows = await db.$queryRawUnsafe<Array<{ prefix: string; n: number }>>(
    "SELECT prefix, next_val::int AS n FROM biz_sequence WHERE prefix = ANY($1::text[])",
    Object.values(WORKER_SAMPLE_COUNTERS),
  );
  const byPrefix = new Map(rows.map((row) => [row.prefix, row.n]));
  return Object.fromEntries(
    Object.entries(WORKER_SAMPLE_COUNTERS).map(([name, prefix]) => [
      name,
      byPrefix.get(prefix) ?? 0,
    ]),
  ) as Record<WorkerSampleName, number>;
}

/** 用例对样例处理器的遥控：让谁失败、在业务写的前后插一脚 */
export interface WorkerSampleControl {
  /** 名字在里面的处理器，被调到即抛错（业务写之前） */
  readonly failing: Set<string>;
  /** 名字在里面的定时器处理器返回 skipped，不做业务写 */
  readonly skipping: Set<string>;
  /** 每次被调到记一条“名字:事件或定时器 id”，不论成败、不论事务后来提交没有 */
  readonly calls: string[];
  /** 业务写之前、之后（提交之前）各调一次：用例拿它卡住处理器，或在这里安排进程中断 */
  before?: (name: string, id: string) => Promise<void>;
  after?: (name: string, id: string) => Promise<void>;
  /** 换掉长任务（daily）的函数体；不给即“自己开小事务把计数加一” */
  long?: (ctx: RecurringRunContext) => Promise<Readonly<Record<string, unknown>> | void>;
}

export interface WorkerSampleOptions {
  /** 长任务（daily，job 模式）的租期与次数上限 */
  readonly longJob?: { readonly leaseSec?: number; readonly maxAttempts?: number };
}

export interface WorkerSample {
  /** 交给 assembleForTest 的 extra */
  readonly registration: ModuleRegistration;
  readonly control: WorkerSampleControl;
}

/**
 * 样例登记：两个订阅者（关键类、非关键类）；两个定时器处理器（revivable 关键类、plain 非关键类）；
 * 三个周期任务（every5 每 5 分钟、tx 模式、补最近一格；daily 每日 03:30、job 模式；stg_only 只在预发）。
 */
export function createWorkerSample(options: WorkerSampleOptions = {}): WorkerSample {
  const control: WorkerSampleControl = { failing: new Set(), skipping: new Set(), calls: [] };
  /** 样例处理器共同的骨架：记一笔 → 前插 → 按安排失败 → 业务写 → 后插 */
  const act = async (
    name: WorkerSampleName,
    id: string,
    write: (name: WorkerSampleName) => Promise<unknown>,
  ): Promise<void> => {
    control.calls.push(`${name}:${id}`);
    await control.before?.(name, id);
    if (control.failing.has(name)) throw new Error(`样例：${name} 按用例的安排失败`);
    await write(name);
    await control.after?.(name, id);
  };
  const inTx = (tx: Tx | undefined) => (name: WorkerSampleName) => {
    if (tx === undefined) throw new Error(`样例：${name} 没有拿到事务句柄`);
    return bumpWorkerSample(tx, name);
  };

  const registration = defineRegistration("lyxtest_worker", {
    subscribers: Object.values(WORKER_SAMPLE_SUBSCRIBERS).map((name) => ({
      name,
      events: ["lyxtest.order.placed"],
      critical: name === WORKER_SAMPLE_SUBSCRIBERS.critical,
      handle: (tx, event) => act(name, event.id, inTx(tx)),
    })),
    timerHandlers: [SAMPLE_TIMER_KINDS.revivable, SAMPLE_TIMER_KINDS.plain].map((kind) => ({
      kind,
      critical: kind === SAMPLE_TIMER_KINDS.revivable,
      rearmAfterSkip: kind === SAMPLE_TIMER_KINDS.revivable,
      handle: async (tx, timer) => {
        if (control.skipping.has(kind)) return "skipped" as const;
        let fresh = false;
        await act(kind, timer.id, async (name) => {
          fresh = await claimOnce(tx, `tmr:lyxtest:${timer.id}`);
          if (fresh) await bumpWorkerSample(tx, name);
        });
        return fresh ? ("fired" as const) : ("skipped" as const);
      },
    })),
    recurringJobs: [
      {
        kind: SAMPLE_JOB_KINDS.every5,
        schedule: { every: "minutes", minutes: 5 },
        catchUp: true,
        run: async (ctx) => {
          const slot = ctx.scheduledFor.toISOString();
          let bumped = 0;
          await act(SAMPLE_JOB_KINDS.every5, slot, async (name) => {
            const tx = ctx.tx;
            if (tx === undefined) throw new Error(`样例：${name} 没有拿到事务句柄`);
            if (await claimOnce(tx, `lyxtest:${name}:${slot}`))
              bumped = await bumpWorkerSample(tx, name);
          });
          return { bumped };
        },
      },
      {
        kind: SAMPLE_JOB_KINDS.daily,
        schedule: { every: "day", at: "03:30" },
        mode: "job",
        ...options.longJob,
        run: async (ctx) => {
          if (control.long !== undefined) return control.long(ctx);
          const slot = ctx.scheduledFor.toISOString();
          await act(SAMPLE_JOB_KINDS.daily, slot, (name) => {
            if (ctx.runTx === undefined) throw new Error("样例：长任务没有拿到开事务的入口");
            return ctx.runTx(async (tx) => {
              if (await claimOnce(tx, `lyxtest:${name}:${slot}`)) await bumpWorkerSample(tx, name);
            });
          });
          return { scheduledFor: slot };
        },
      },
      {
        kind: SAMPLE_JOB_KINDS.stgOnly,
        schedule: { every: "minutes", minutes: 5 },
        envs: ["stg"],
        run: async () => undefined,
      },
    ],
  });
  return { registration, control };
}
