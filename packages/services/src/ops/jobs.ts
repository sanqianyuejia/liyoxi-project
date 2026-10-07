// ops 周期任务的处理器：既有 invariant.full/quick、ops.retention；W2-24 增备份与证书。登记在 register.ts。
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

/** job租约/续租/最多3次由 timers/job-mode 原机制负责；摘要由同机制写 timer.result。 */
export async function runScheduledBackup(
  ctx: RecurringRunContext,
): Promise<Readonly<Record<string, unknown>>> {
  const ops = requireOps("backup.pgdump");
  if (ops.operations === undefined) throw new Error("备份运行时未绑定");
  const previous = await ops.tx.run((handle) =>
    handle.timer.findFirst({
      where: { kind: "backup.pgdump", status: "fired" },
      orderBy: { firedAt: "desc" },
      select: { result: true },
    }),
  );
  const bytes =
    previous?.result !== null &&
    typeof previous?.result === "object" &&
    !Array.isArray(previous.result)
      ? (previous.result as Record<string, unknown>)["bytes"]
      : undefined;
  const result = await ops.operations.backup.run({
    signal: ctx.signal,
    ...(typeof bytes === "number" ? { previousSize: bytes } : {}),
  });
  if (!result.ok) {
    await ops.operations.alerts.raise({
      rule: "backup.failed",
      severity: "P1",
      detail: { reason: result.reason },
    });
    throw new Error(`逻辑备份失败：${result.reason}`);
  }
  return { status: "succeeded", ...result.value };
}
export async function runScheduledCert(
  ctx: RecurringRunContext,
): Promise<Readonly<Record<string, unknown>>> {
  const ops = requireOps("ops.cert_check");
  if (ops.operations === undefined) throw new Error("证书运行时未绑定");
  const result = await ops.operations.cert.run({ signal: ctx.signal });
  if (!result.configured) {
    await ops.operations.alerts.raise({
      rule: "cert.unconfigured",
      severity: "P3",
      detail: { configured: false },
    });
    return { status: "unconfigured", configured: false, domains: 0 };
  }
  for (const certificate of result.certificates) {
    if (certificate.priority !== undefined)
      await ops.operations.alerts.breach({
        rule: "cert.expiry",
        dimension: certificate.domain,
        severity: certificate.priority,
        detail: { remainingDays: certificate.remainingDays ?? null, status: certificate.status },
      });
    else if (certificate.status === "healthy")
      await ops.operations.alerts.normal("cert.expiry", certificate.domain);
    else
      await ops.operations.alerts.raise({
        rule: "cert.unconfigured",
        dimension: certificate.domain,
        severity: "P2",
        detail: { status: certificate.status },
      });
  }
  return {
    status: result.certificates.every((item) => item.status === "healthy") ? "healthy" : "degraded",
    configured: true,
    results: result.certificates,
  };
}
