// ops 的三个周期任务的处理器（W0-24）：invariant.full、invariant.quick、ops.retention。登记在 register.ts。
// 依据：x01 第 4.2 节；D7 第 7.6 节。处理器是薄壳：从运行时绑定取连接、时钟与装配结果，调用例函数。
import { alertsOf } from "../kernel/index.js";
import type { InvariantMode, RecurringRunContext } from "../kernel/index.js";
import { requireOps } from "./binding.js";
import { runInvariants } from "./invariants/run.js";
import { runRetention } from "./retention.js";

/**
 * 定时的不变量运行（job 模式：事务外执行，检查项各开各的事务）。
 * 运行记了 failed 就抛错：定时器按登记的次数重试，耗尽即 failed 并由 timers 报 timer.failed。
 */
export async function runScheduledInvariants(
  mode: InvariantMode,
  ctx: RecurringRunContext,
): Promise<Readonly<Record<string, unknown>>> {
  const ops = requireOps(`invariant.${mode}`);
  const result = await runInvariants(ops, {
    mode,
    trigger: "schedule",
    scheduledFor: ctx.scheduledFor,
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
  });
  if (result.status === "failed") {
    const reasons = result.errors.map((item) => `${item.code}：${item.message}`).join("；");
    throw new Error(`不变量运行 ${result.runId} 出错：${reasons}`);
  }
  return {
    runId: result.runId,
    checksRun: result.checksRun,
    violationsFound: result.violationsFound,
    created: result.created,
    autoClosed: result.autoClosed,
  };
}

/** 定时的清理（tx 模式：与“已触发”同一个事务） */
export async function runScheduledRetention(
  ctx: RecurringRunContext,
): Promise<Readonly<Record<string, unknown>>> {
  const ops = requireOps("ops.retention");
  if (ctx.tx === undefined) throw new Error("ops.retention 要登记成 tx 模式：处理器没有拿到事务");
  const result = await runRetention(
    ctx.tx,
    { assembly: ops.assembly, clock: ops.clock, alerts: alertsOf(ops.assembly) },
    { scheduledFor: ctx.scheduledFor },
  );
  return { ...result };
}
