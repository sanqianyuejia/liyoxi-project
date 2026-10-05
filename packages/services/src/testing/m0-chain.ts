// M0 的样例链路（W0-30）：把 M0 各包交的内核件拼成一条走得通的链路。只给测试与 pnpm demo:m0 用，不进生产装配。
// 依据：计划 第 6.3 节“退出：演示”；01 第 7.1 节（写操作的统一形态）。
//
//   测试装配 → 带幂等键的写用例（开事务 → 登记幂等键 → flow.transition：加锁、守卫、改状态、状态历史、审计、出站事件
//   → 登记定时器 → 提交）→ 同键重放 → 中继展开 → 派发入队 → 订阅者执行 → 等定时器到点 → 扫描入队 → 定时器处理器执行
//   → 全量不变量
//
// 不新造业务：迁移的是真实的状态机表 staff（停用一名工厂造的样例员工），事件、订阅者、定时器用 lyxtest 的样例名字。
// 订阅者与定时器处理器的业务副作用是 biz_sequence 里的一行计数（内核自己的表），据此看“各执行一次”。
// 这里不注入故障：重复投递、进程中断、Redis 不可用下的“恰好一次”由 apps/worker/test/fault/ 的用例管。
// 定时器到没到点，扫描按数据库时间判（timers/scan.ts）：所以业务时钟从“现在”起步，定时器只晚几秒，真等到它到点。
// 本文件不引 Vitest：演示脚本在一轮测试之外加载它。
import { isDeepStrictEqual } from "node:util";

import type { PrismaClient } from "@liyoxi/db";

import { createFlow } from "../flow/index.js";
import type { Flow } from "../flow/index.js";
import {
  createIdempotencyContext,
  createIdentityContext,
  createQueueChannel,
  createTxRunner,
  defineRegistration,
} from "../kernel/index.js";
import type {
  Assembly,
  IdempotencyContext,
  IdentityContext,
  ModuleRegistration,
  QueueChannel,
  QueueConsumer,
  Tx,
  TxRunner,
} from "../kernel/index.js";
import { buildWorkerServices, runInvariants } from "../ops/index.js";
import type { InvariantRunResult, WorkerServices } from "../ops/index.js";
import type { DeliveryRef } from "../events/index.js";
import { timerKey } from "../timers/index.js";
import type { TimerRef } from "../timers/index.js";
import { assembleForTest } from "./assembly.js";
import { createClock } from "./clock.js";
import type { AdjustableClock } from "./clock.js";
import { createFactories } from "./data/factories/index.js";
import { SAMPLE_FLOW_EVENT, SAMPLE_FLOW_EVENTS, sampleFlowRegistration } from "./flow.js";
import { SAMPLE_TIMER_CATALOG, SAMPLE_TIMER_KINDS, SAMPLE_TIMER_SUBJECT } from "./timers.js";

/** 链路里用到的样例名字 */
export const M0_CHAIN = {
  /** 幂等记录的 scope：样例用例当作这条路由 */
  scope: "admin.lyxtestStaff.disable",
  /** 随迁移发的出站事件 */
  event: SAMPLE_FLOW_EVENT,
  /** 订阅它的样例订阅者 */
  subscriber: "lyxtest.onStaffDisabled",
  /** 用例登记的样例定时器 */
  timerKind: SAMPLE_TIMER_KINDS.plain,
  /** 定时器在停用之后多久到点（缺省） */
  timerDelayMs: 2_000,
} as const;

/** 两个样例处理器的计数行（biz_sequence.prefix） */
const COUNTERS = { subscriber: "MZS", timer: "MZT" } as const;

const bump = (tx: Tx, prefix: string): Promise<number> =>
  tx.$executeRawUnsafe(
    `INSERT INTO biz_sequence (prefix, biz_date, next_val) VALUES ($1::text, DATE '2026-01-05', 1)
     ON CONFLICT (prefix, biz_date) DO UPDATE SET next_val = biz_sequence.next_val + 1, updated_at = now()`,
    prefix,
  );

/** 样例处理器被调到的记录（不论事务后来提交没有） */
export interface M0ChainCalls {
  /** 订阅者收到的事件 id */
  readonly subscriber: string[];
  /** 定时器处理器收到的定时器 id */
  readonly timer: string[];
}

/** 样例登记：一个订阅者、一个定时器处理器，各把自己的计数加一 */
export function m0ChainRegistration(calls: M0ChainCalls): ModuleRegistration {
  return defineRegistration("lyxtest_m0", {
    subscribers: [
      {
        name: M0_CHAIN.subscriber,
        events: [M0_CHAIN.event],
        handle: async (tx, event) => {
          calls.subscriber.push(event.id);
          await bump(tx, COUNTERS.subscriber);
        },
      },
    ],
    timerHandlers: [
      {
        kind: M0_CHAIN.timerKind,
        handle: async (tx, timer) => {
          calls.timer.push(timer.id);
          await bump(tx, COUNTERS.timer);
          return "fired";
        },
      },
    ],
  });
}

export interface DisableStaffInput {
  readonly staffId: string;
}

/** 样例用例的返回值：进幂等记录，重放时原样返回 */
export interface DisableStaffResult {
  readonly staffId: string;
  readonly from: string | null;
  readonly to: string;
  readonly transitionId: string;
  readonly auditId: string | null;
  readonly eventId: string | null;
  readonly timerId: string;
  readonly timerFireAt: string;
}

export interface M0ChainOptions {
  /** 连到一个跑完迁移、播过种子的库 */
  readonly prisma: PrismaClient;
  readonly channel: Pick<QueueChannel, "enqueue" | "downForMs">;
  /** 不给即新建一只从“现在”起步的可拨时钟 */
  readonly clock?: AdjustableClock;
  /** 定时器在停用之后多久到点，毫秒；缺省 M0_CHAIN.timerDelayMs */
  readonly timerDelayMs?: number;
}

export interface M0Chain {
  readonly assembly: Assembly;
  /** 任务进程那一侧的用例函数：中继、派发、消费、扫描、执行 */
  readonly worker: WorkerServices;
  readonly flow: Flow;
  readonly tx: TxRunner;
  readonly clock: AdjustableClock;
  readonly calls: M0ChainCalls;
  /** 样例用例函数体被执行了几次（重放不执行） */
  readonly executions: () => number;
  /** 建这次请求的幂等上下文：同一个键、同一个操作人、同一份入参即同一次请求 */
  idemFor(ctx: IdentityContext, key: string, input: DisableStaffInput): IdempotencyContext;
  /** 样例写用例：停用一名员工，并登记一个到点回看的定时器 */
  disableStaff(
    ctx: IdentityContext,
    idem: IdempotencyContext,
    input: DisableStaffInput,
  ): Promise<DisableStaffResult>;
  /** 跑一次全量不变量 */
  runFullInvariants(): Promise<InvariantRunResult>;
}

/** 在测试装配（真实模块的登记加样例登记）之上，把两个进程要用的内核件建齐 */
export function createM0Chain(options: M0ChainOptions): M0Chain {
  const { prisma } = options;
  const clock = options.clock ?? createClock(new Date());
  const timerDelayMs = options.timerDelayMs ?? M0_CHAIN.timerDelayMs;
  const calls: M0ChainCalls = { subscriber: [], timer: [] };
  const assembly = assembleForTest({
    entry: "worker",
    extra: [sampleFlowRegistration(), m0ChainRegistration(calls)],
  });
  const worker = buildWorkerServices({
    appEnv: "test",
    prisma,
    assembly,
    channel: options.channel,
    clock,
    testEvents: SAMPLE_FLOW_EVENTS,
    timerCatalog: SAMPLE_TIMER_CATALOG,
  });
  const tx = createTxRunner({ prisma, appEnv: "test" });
  const flow = createFlow({ assembly, clock, events: worker.events });
  let executions = 0;

  return {
    assembly,
    worker,
    flow,
    tx,
    clock,
    calls,
    executions: () => executions,
    idemFor: (ctx, key, input) =>
      createIdempotencyContext({
        mode: "required",
        scope: M0_CHAIN.scope,
        actor: ctx.actor,
        key,
        request: { method: "POST", pathParams: { staffId: input.staffId } },
      }),
    disableStaff: (ctx, idem, input) =>
      tx.run(
        async (handle) => {
          executions += 1;
          const now = clock.now();
          // 加锁、守卫、改状态、状态历史、审计、出站事件都在这一步里，与本事务同成同败
          const moved = await flow.transition(handle, ctx, {
            machine: "staff",
            stateField: "status",
            id: input.staffId,
            event: "staff.disable",
            set: { disabled_at: now, disabled_reason: "other" },
            reasonCode: "other",
            audit: {
              stream: "ops",
              category: "staff_authz",
              action: "lyxtest.staff.disable",
              summary: "样例：停用员工",
              target: { type: "staff", id: input.staffId },
            },
            emit: { type: M0_CHAIN.event, payload: { v: 1 } },
          });
          // 调用方已持有主体行的锁（上一步锁的），再登记定时器
          const subject = { type: SAMPLE_TIMER_SUBJECT, id: input.staffId };
          const fireAt = new Date(now.getTime() + timerDelayMs);
          const timer = await worker.timers.arm(handle, {
            kind: M0_CHAIN.timerKind,
            subject,
            key: timerKey(M0_CHAIN.timerKind, subject),
            fireAt,
          });
          return {
            staffId: input.staffId,
            from: moved.from,
            to: moved.to,
            transitionId: moved.id,
            auditId: moved.auditId,
            eventId: moved.eventId,
            timerId: timer.id,
            timerFireAt: fireAt.toISOString(),
          };
        },
        { idem },
      ),
    runFullInvariants: () =>
      runInvariants({ tx, assembly, clock }, { mode: "full", trigger: "manual" }),
  };
}

// ---------- 走一遍 ----------

/** 链路走到某一步时库里的行数：五张表按全库数，另数这名员工自己的三样 */
export interface M0ChainTally {
  readonly history: number;
  readonly audit: number;
  readonly events: number;
  readonly deliveries: number;
  readonly timers: number;
  readonly idempotency: number;
}

/** 走完之后的结果：演示打印它，用例断言它 */
export interface M0ChainReport {
  readonly staffId: string;
  readonly first: DisableStaffResult;
  readonly replay: DisableStaffResult;
  /** 重放那一次：幂等上下文的 replayed */
  readonly replayed: boolean;
  /** 用例函数体执行的次数 */
  readonly executions: number;
  /** 这名员工名下：状态历史、审计、出站事件各几条 */
  readonly rows: { readonly history: number; readonly audit: number; readonly events: number };
  /** 订阅者、定时器处理器各提交了几次 */
  readonly runs: { readonly subscriber: number; readonly timer: number };
  readonly deliveryStatus: string;
  readonly timerStatus: string;
  readonly invariants: InvariantRunResult;
}

/** 一步的说明：标题与若干行细节 */
export type M0ChainSay = (title: string, lines: readonly string[]) => void;

/** 链路里有一步与预期不符 */
export class M0ChainError extends Error {
  constructor(step: string, detail: string) {
    super(`样例链路在“${step}”一步与预期不符：${detail}`);
    this.name = "M0ChainError";
  }
}

export interface RunM0ChainOptions {
  /** 连到一个跑完迁移、播过种子的库；身份照测试支架的缺省（应用角色） */
  readonly prisma: PrismaClient;
  readonly redisUrl: string;
  /** 本次运行自己的 Redis 键前缀（测试支架给的，或演示脚本自己定的）；队列的键落在它下面 */
  readonly redisPrefix: string;
  /** 每一步做了什么；不给即不出声 */
  readonly say?: M0ChainSay;
  /** 等一件事发生的上限，毫秒；缺省 60 秒 */
  readonly patienceMs?: number;
  /** 定时器在停用之后多久到点，毫秒；缺省 M0_CHAIN.timerDelayMs。用例里给短一些 */
  readonly timerDelayMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function tally(prisma: PrismaClient): Promise<M0ChainTally> {
  const [history, audit, events, deliveries, timers, idempotency] = await Promise.all([
    prisma.statusTransition.count(),
    prisma.auditLog.count(),
    prisma.outboxEvent.count(),
    prisma.outboxDelivery.count(),
    prisma.timer.count(),
    prisma.idempotencyRecord.count(),
  ]);
  return { history, audit, events, deliveries, timers, idempotency };
}

const delta = (before: M0ChainTally, after: M0ChainTally): string =>
  [
    `状态历史 ${after.history - before.history >= 0 ? "+" : ""}${after.history - before.history}`,
    `审计 ${after.audit - before.audit >= 0 ? "+" : ""}${after.audit - before.audit}`,
    `出站事件 ${after.events - before.events >= 0 ? "+" : ""}${after.events - before.events}`,
    `定时器 ${after.timers - before.timers >= 0 ? "+" : ""}${after.timers - before.timers}`,
    `幂等记录 ${after.idempotency - before.idempotency >= 0 ? "+" : ""}${after.idempotency - before.idempotency}`,
  ].join("、");

async function countersOf(prisma: PrismaClient): Promise<{ subscriber: number; timer: number }> {
  const rows = await prisma.$queryRawUnsafe<Array<{ prefix: string; n: number }>>(
    "SELECT prefix, next_val::int AS n FROM biz_sequence WHERE prefix = ANY($1::text[])",
    Object.values(COUNTERS),
  );
  const of = (prefix: string): number => rows.find((row) => row.prefix === prefix)?.n ?? 0;
  return { subscriber: of(COUNTERS.subscriber), timer: of(COUNTERS.timer) };
}

/**
 * 把样例链路从头到尾走一遍，每一步核对库里的结果；有一步不符即抛 M0ChainError。
 * 队列走真的 Redis（键都在 redisPrefix 之下）；跑完关掉自己建的队列连接，库与键由调用方收。
 * 同一个库上可以反复跑：每次造新的样例员工，核对只看这一次造的行与计数的增量。
 */
export async function runM0Chain(options: RunM0ChainOptions): Promise<M0ChainReport> {
  const { prisma } = options;
  const say: M0ChainSay = options.say ?? (() => undefined);
  const patienceMs = options.patienceMs ?? 60_000;
  const until = async (step: string, check: () => Promise<boolean>): Promise<void> => {
    const deadline = Date.now() + patienceMs;
    while (!(await check())) {
      if (Date.now() > deadline) throw new M0ChainError(step, `等了 ${patienceMs} 毫秒也没等到`);
      await sleep(50);
    }
  };
  const expect = (step: string, ok: boolean, detail: string): void => {
    if (!ok) throw new M0ChainError(step, detail);
  };

  const channel = createQueueChannel({
    redisUrl: options.redisUrl,
    prefix: `${options.redisPrefix}bull`,
  });
  const consumers: QueueConsumer[] = [];
  try {
    // ① 装配
    const chain = createM0Chain({ prisma, channel, timerDelayMs: options.timerDelayMs });
    const { worker, clock } = chain;
    await worker.selfCheck();
    say("① 装配", [
      `测试装配：真实模块的登记加两份样例登记，共 ${chain.assembly.modules.length} 个模块`,
      `订阅者 ${chain.assembly.subscribers.length} 个、定时器处理器 ${chain.assembly.timerHandlers.length} 个、不变量检查项 ${chain.assembly.invariants.length} 个`,
      "启动自检通过：契约登记的聚合类型都是库里存在的表",
    ]);

    // 样例数据：两名员工（操作人、被停用的人），工厂直接插行
    const make = createFactories({ db: prisma, clock });
    const operator = await make.staff({ staffRoleKey: "super_admin" });
    const target = await make.staff();
    const ctx = createIdentityContext({
      actor: { type: "staff", id: operator.id, client: "admin" },
      requestId: `req-m0-${target.id.slice(-8)}`,
    });
    const input = { staffId: target.id };
    const key = `m0-demo-${target.id}`;
    const counted = await countersOf(prisma);

    // ② 写用例
    const before = await tally(prisma);
    const firstIdem = chain.idemFor(ctx, key, input);
    const first = await chain.disableStaff(ctx, firstIdem, input);
    // 定时器还没到点：马上扫描一轮，不该认领到它（机器太慢、扫描回来时已经到点了，这一条就不算数）
    const early = await worker.scan();
    const scannedEarly = Date.now() < Date.parse(first.timerFireAt);
    const afterFirst = await tally(prisma);
    const staffRow = await prisma.staff.findUniqueOrThrow({ where: { id: target.id } });
    expect("② 写用例", first.from === "active" && first.to === "disabled", JSON.stringify(first));
    expect("② 写用例", staffRow.status === "disabled", `员工的状态是 ${staffRow.status}`);
    expect(
      "② 写用例",
      afterFirst.history - before.history === 1 &&
        afterFirst.audit - before.audit === 1 &&
        afterFirst.events - before.events === 1 &&
        afterFirst.timers - before.timers === 1 &&
        afterFirst.idempotency - before.idempotency === 1,
      delta(before, afterFirst),
    );
    say("② 写用例：停用一名样例员工（带幂等键）", [
      `一个事务里：登记幂等键 → 锁员工行 → 守卫 → 状态 ${first.from} → ${first.to} → 状态历史、审计、出站事件 → 登记定时器`,
      `库里多了：${delta(before, afterFirst)}`,
      `定时器 ${M0_CHAIN.timerKind} 待触发，到点时间 ${first.timerFireAt}（业务时钟现在是 ${clock.now().toISOString()}）`,
    ]);
    if (scannedEarly) {
      expect("② 写用例", early.claimed === 0, `定时器还没到点就被认领了 ${early.claimed} 个`);
    }

    // ③ 重放
    const replayIdem = chain.idemFor(ctx, key, input);
    const replay = await chain.disableStaff(ctx, replayIdem, input);
    const afterReplay = await tally(prisma);
    // 存下的结果过了一遍 jsonb，键的先后可能变：按内容比
    expect(
      "③ 重放",
      isDeepStrictEqual(replay, first),
      `重放的结果与第一次不同：${JSON.stringify(replay)}`,
    );
    expect("③ 重放", replayIdem.replayed && !firstIdem.replayed, "幂等上下文没有标成重放");
    expect("③ 重放", chain.executions() === 1, `用例函数体执行了 ${chain.executions()} 次`);
    expect("③ 重放", isDeepStrictEqual(afterReplay, afterFirst), delta(afterFirst, afterReplay));
    say("③ 同一个幂等键再提交一次", [
      "返回的结果与第一次相同，标记为重放",
      `用例函数体共执行 ${chain.executions()} 次；库里各表行数不变`,
    ]);

    // ④ 中继、派发、订阅者
    consumers.push(
      channel.consume<DeliveryRef>(
        "outbox_delivery",
        1,
        async (ref) => void (await worker.consume(ref)),
      ),
      channel.consume<TimerRef>("timer_run", 1, async (ref) => void (await worker.runTimer(ref))),
    );
    for (const consumer of consumers) consumer.start();
    await until("④ 队列连接就绪", () => channel.ping());
    const eventId = first.eventId ?? "";
    const expanded = await worker.relay();
    const deliveryOf = async (): Promise<string> =>
      (
        await prisma.outboxDelivery.findFirst({
          where: { outboxEventId: eventId, subscriber: M0_CHAIN.subscriber },
        })
      )?.status ?? "（没有投递行）";
    expect("④ 中继", expanded >= 1, `展开了 ${expanded} 条事件`);
    expect("④ 中继", (await deliveryOf()) === "pending", `投递行的状态是 ${await deliveryOf()}`);
    const dispatched = await worker.dispatch();
    expect("④ 派发", dispatched.claimed >= 1, JSON.stringify(dispatched));
    await until("④ 订阅者执行", async () => (await deliveryOf()) === "done");
    say("④ 任务进程：中继 → 派发 → 订阅者", [
      `中继把出站事件展开成投递行（订阅者 ${M0_CHAIN.subscriber}，待派发）`,
      `派发认领 ${dispatched.claimed} 行：入队 ${dispatched.enqueued}、进程内执行 ${dispatched.inProcess}`,
      "订阅者执行完，投递行的状态是 done",
    ]);

    // ⑤ 定时器
    const timerOf = async (): Promise<string> =>
      (await prisma.timer.findUniqueOrThrow({ where: { id: first.timerId } })).status;
    const waitMs = Math.max(0, Date.parse(first.timerFireAt) - Date.now()) + 200;
    await sleep(waitMs);
    clock.set(new Date());
    // 没赶在到点之前扫描的那一次若已经认领了它，这里就不会再认领到
    let claimed = scannedEarly ? 0 : early.claimed;
    await until("⑤ 定时器到点后被认领", async () => {
      if (claimed >= 1) return true;
      const round = await worker.scan();
      await round.background;
      claimed += round.claimed;
      return claimed >= 1;
    });
    expect("⑤ 定时器", claimed === 1, `认领了 ${claimed} 个`);
    await until("⑤ 定时器执行", async () => (await timerOf()) === "fired");
    say("⑤ 定时器：到点才执行", [
      scannedEarly
        ? "登记后马上扫描一轮：没到点，认领 0 个"
        : "（机器太慢，没赶在到点之前扫描，这一条没有核对）",
      `等它到点（约 ${(waitMs / 1000).toFixed(1)} 秒）再扫描：认领 ${claimed} 个，入队后由处理器执行`,
      "定时器行的状态是 fired",
    ]);

    // ⑥ 全量不变量
    const invariants = await chain.runFullInvariants();
    expect(
      "⑥ 不变量",
      invariants.status === "succeeded" && invariants.violationsFound === 0,
      `状态 ${invariants.status}，违规 ${invariants.violationsFound} 条，出错 ${invariants.errors
        .map((item) => `${item.code}：${item.message}`)
        .join("；")}`,
    );
    say("⑥ 全量不变量校验", [
      `跑了 ${invariants.checksRun} 个检查项，违规 ${invariants.violationsFound} 条`,
    ]);

    // ⑦ 汇总
    const [history, audit, events] = await Promise.all([
      prisma.statusTransition.count({ where: { subjectId: target.id } }),
      prisma.auditLog.count({ where: { targetId: target.id } }),
      prisma.outboxEvent.count({ where: { aggregateId: target.id } }),
    ]);
    const now = await countersOf(prisma);
    const runs = {
      subscriber: now.subscriber - counted.subscriber,
      timer: now.timer - counted.timer,
    };
    expect(
      "⑦ 汇总",
      history === 1 && audit === 1 && events === 1,
      `状态历史 ${history}、审计 ${audit}、出站事件 ${events}`,
    );
    expect(
      "⑦ 汇总",
      runs.subscriber === 1 && runs.timer === 1,
      `订阅者 ${runs.subscriber} 次、定时器 ${runs.timer} 次`,
    );
    expect(
      "⑦ 汇总",
      chain.calls.subscriber.length === 1 && chain.calls.timer.length === 1,
      `处理器被调到的次数：订阅者 ${chain.calls.subscriber.length}、定时器 ${chain.calls.timer.length}`,
    );
    say("⑦ 这名员工名下", [
      `状态历史 ${history} 条、审计 ${audit} 条、出站事件 ${events} 条`,
      `订阅者执行 ${runs.subscriber} 次、定时器执行 ${runs.timer} 次`,
    ]);

    return {
      staffId: target.id,
      first,
      replay,
      replayed: replayIdem.replayed,
      executions: chain.executions(),
      rows: { history, audit, events },
      runs,
      deliveryStatus: await deliveryOf(),
      timerStatus: await timerOf(),
      invariants,
    };
  } finally {
    await Promise.allSettled(consumers.map((consumer) => consumer.close(5_000)));
    await channel.close();
  }
}
