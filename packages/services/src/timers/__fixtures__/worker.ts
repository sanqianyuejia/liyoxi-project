// 扫描、执行、长任务三份用例的共用部分（W0-23）：只给本目录的测试用。
import type { PrismaClient } from "@liyoxi/db";

import { alertsOf } from "../../kernel/index.js";
import type { ModuleRegistration } from "../../kernel/index.js";
import {
  assembleForTest,
  createClock,
  createRecordingPorts,
  createWorkerSample,
  SAMPLE_TIMER_CATALOG,
} from "../../testing/index.js";
import type { WorkerSampleOptions } from "../../testing/index.js";
import { claimTimers, createTimers, timerKey } from "../index.js";
import type { ScanDeps, TimerRef } from "../index.js";
import { newSubject, runner } from "./db.js";

/** 假的执行通道：只记下入队的任务，或按用例的安排报“不可用” */
export const fakeChannel = () => ({
  down: false,
  downMs: 0,
  jobs: [] as Array<{ queue: string; jobId: string; data: unknown }>,
  async enqueue(queue: string, jobId: string, data: unknown): Promise<void> {
    if (this.down) throw new Error("样例：Redis 不可用");
    this.jobs.push({ queue, jobId, data });
  },
  downForMs(): number {
    return this.downMs;
  },
});

export interface TimerState {
  status: string;
  attempts: number;
  dispatchNo: number;
  isEnqueued: boolean;
  fired: boolean;
  /** 最近一次更新把重试时间、租约后移了多少秒；没有即 null */
  retrySec: number | null;
  leaseSec: number | null;
  lastError: string | null;
  result: Record<string, unknown> | null;
}

/** 测试装配（样例处理器 + 记录告警的端口）之上的扫描与执行。extra 可以换掉样例处理器 */
export function workerTimers(options: WorkerSampleOptions & { extra?: ModuleRegistration[] } = {}) {
  const workers = createWorkerSample(options);
  const ports = createRecordingPorts();
  const assembly = assembleForTest({
    entry: "worker",
    extra: [...(options.extra ?? [workers.registration]), ports.registration],
    // 真实模块的周期任务（不变量、清理）不带：这里的用例只跑样例的
    omitReal: ["recurringJobs"],
  });
  const timers = createTimers({ assembly, catalog: SAMPLE_TIMER_CATALOG });
  const clock = createClock();
  const channel = fakeChannel();
  let prisma: PrismaClient;
  let deps: ScanDeps;

  return {
    workers,
    ports,
    timers,
    clock,
    channel,
    get deps(): ScanDeps {
      return deps;
    },
    attach(client: PrismaClient): void {
      prisma = client;
      deps = {
        tx: runner(client),
        assembly,
        registry: timers.registry,
        clock,
        alerts: alertsOf(assembly),
        channel,
      };
    },
    /** 每条用例开头：遥控复位，上一条留下的未完成的行一律取消 */
    async reset(): Promise<void> {
      workers.control.failing.clear();
      workers.control.skipping.clear();
      workers.control.calls.length = 0;
      delete workers.control.before;
      delete workers.control.after;
      delete workers.control.long;
      ports.alerts.length = 0;
      Object.assign(channel, { down: false, downMs: 0, jobs: [] });
      await prisma.$executeRawUnsafe(
        "UPDATE timer SET status = 'cancelled', lease_until = NULL WHERE status IN ('scheduled', 'dispatched')",
      );
    },
    /** 登记一个立刻到点的样例定时器，返回它的 id 与主体 */
    async arm(kind: string) {
      const subject = newSubject();
      const armed = await deps.tx.run((tx) =>
        timers.arm(tx, { kind, subject, key: timerKey(kind, subject), fireAt: clock.now() }),
      );
      return { id: armed.id, subject };
    },
    /** 认领一轮，取出这一行的那一次认领 */
    async claim(id: string): Promise<TimerRef> {
      const { claimed } = await deps.tx.run((tx) => claimTimers(tx, timers.registry, clock.now()));
      return claimed.find((one) => one.timerId === id) as TimerRef;
    },
    /** 让这一行立刻到点（等重试的）或立刻过期（租约中的） */
    hasten: (id: string): Promise<number> =>
      prisma.$executeRawUnsafe(
        `UPDATE timer SET retry_at = CASE WHEN retry_at IS NOT NULL THEN now() - interval '1 second' END,
                lease_until = CASE WHEN status = 'dispatched' THEN now() - interval '1 second' END
          WHERE id = $1::uuid`,
        id,
      ),
    async state(id: string): Promise<TimerState> {
      const rows = await prisma.$queryRawUnsafe<TimerState[]>(
        `SELECT status, attempts::int AS attempts, dispatch_no::int AS "dispatchNo", is_enqueued AS "isEnqueued",
                fired_at IS NOT NULL AS fired, last_error AS "lastError", result,
                EXTRACT(EPOCH FROM retry_at - updated_at)::int AS "retrySec",
                EXTRACT(EPOCH FROM lease_until - updated_at)::int AS "leaseSec"
           FROM timer WHERE id = $1::uuid`,
        id,
      );
      return rows[0] as TimerState;
    },
  };
}
