import { performance } from "node:perf_hooks";
import type { AlertInput, Clock, TxRunner } from "../kernel/index.js";
import type { ProviderLogger } from "../providers/types.js";
import type { OpsAlerts } from "./alerts.js";
import { safeAlertDetail } from "./alerts.js";
import { withPrimaryLease, withProbeTimeout } from "./probe-support.js";
import type { SqlRunner } from "./binding.js";
import type { ProbeRule } from "./probe-rules.js";

export const PROBE_INTERVAL_MS = 60_000;
export const PROBE_BUDGET_MS = 20_000;
export const PROBE_QUERY_MS = 2_000;
export const PROBE_CONCURRENCY = 3;
export interface ProbeResult {
  readonly completed: boolean;
  readonly samples: number;
  readonly failed: number;
  readonly leaseLost: boolean;
  readonly elapsedMs: number;
}
export interface ProbeOptions {
  readonly db: SqlRunner;
  readonly tx: TxRunner;
  readonly clock: Clock;
  readonly alerts: OpsAlerts;
  readonly holder: () => string | undefined;
  readonly rules: readonly ProbeRule[];
  readonly logger: ProviderLogger;
  readonly ensureRecurring: (holder: string, signal: AbortSignal) => Promise<unknown>;
  /** Tests may shorten budgets; production never raises them. */
  readonly budgetMs?: number;
  readonly queryMs?: number;
}
export function createProbe(options: ProbeOptions): (beat?: () => void) => Promise<ProbeResult> {
  const failures = new Map<string, number>();
  let running: Promise<ProbeResult> | undefined;
  const round = async (beat?: () => void): Promise<ProbeResult> => {
    const started = performance.now(),
      controller = new AbortController();
    const holder = options.holder();
    let samples = 0,
      failed = 0,
      leaseLost = false,
      completed = false;
    const budget = Math.min(PROBE_BUDGET_MS, options.budgetMs ?? PROBE_BUDGET_MS);
    const queryMs = Math.min(PROBE_QUERY_MS, options.queryMs ?? PROBE_QUERY_MS);
    const held = async () => {
      if (controller.signal.aborted || holder === undefined) return false;
      const rows = await withProbeTimeout(
        options.db.$queryRawUnsafe<{ holder: string }[]>(
          `SELECT holder FROM worker_lease WHERE name='primary' AND holder=$1 AND heartbeat_at >= clock_timestamp()-interval '30 second'`,
          holder,
        ),
        queryMs,
        controller.signal,
      );
      return rows.length === 1;
    };
    const execute = async () => {
      if (!(await held())) {
        leaseLost = true;
        return;
      }
      let next = 0;
      const work = async () => {
        for (;;) {
          if (controller.signal.aborted) return;
          const rule = options.rules[next++];
          if (rule === undefined) return;
          let value: Readonly<Record<string, unknown>>, breaches: readonly AlertInput[];
          try {
            value = await withProbeTimeout(rule.sample(), queryMs, controller.signal);
            breaches = rule.evaluate(value);
            failures.delete(rule.key);
          } catch {
            if (controller.signal.aborted) return;
            failed++;
            const streak = (failures.get(rule.key) ?? 0) + 1;
            failures.set(rule.key, streak);
            breaches =
              streak >= 3
                ? [
                    {
                      rule: "probe.failed",
                      dimension: rule.key.replaceAll(":", "."),
                      severity: "P2",
                      detail: { streak },
                    },
                  ]
                : [];
            value = { failed: true, streak };
          }
          if (!(await held())) {
            leaseLost = true;
            controller.abort();
            return;
          }
          samples++;
          beat?.();
          // Only successful samples can restore domain alerts; failed SQL cannot imply healthy zero.
          for (const input of breaches) {
            if (controller.signal.aborted) return;
            await options.alerts.breach(input, holder);
          }
          if (value["failed"] !== true) {
            await options.alerts.normal("probe.failed", rule.key.replaceAll(":", "."), holder);
            for (const target of rule.fingerprints) {
              if (
                !breaches.some(
                  (item) => item.rule === target.rule && item.dimension === target.dimension,
                )
              )
                await options.alerts.normal(target.rule, target.dimension, holder);
            }
          }
          options.logger.info(
            {
              evt: "probe.sample",
              probe: rule.key,
              failed: value["failed"] === true,
              breaches: breaches.length,
              metrics: safeAlertDetail(
                Object.fromEntries(
                  Object.entries(value).map(([key, metric]) =>
                    metric instanceof Date
                      ? [
                          `${key}AgeSec`,
                          Math.max(0, (options.clock.now().getTime() - metric.getTime()) / 1000),
                        ]
                      : [key, metric],
                  ),
                ),
              ),
            },
            "探针样本完成",
          );
        }
      };
      await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, work));
      if (controller.signal.aborted || !(await held())) {
        leaseLost = true;
        return;
      }
      await options.alerts.recoverQuietEvents(holder);
      await options.ensureRecurring(holder!, controller.signal);
      await options.alerts.notify(controller.signal, holder);
      if (controller.signal.aborted) return;
      const touched = await withPrimaryLease<number>(options.tx, holder!, async (handle) => {
        if (controller.signal.aborted || performance.now() - started >= budget) return 0;
        return handle.$executeRawUnsafe(
          `UPDATE worker_lease SET probe_at=$2,updated_at=$2 WHERE name='primary' AND holder=$1`,
          holder,
          options.clock.now(),
        );
      });
      completed = touched === 1;
      leaseLost = !completed;
    };
    try {
      await withProbeTimeout(execute(), budget, controller.signal);
    } catch {
      controller.abort();
      options.logger.error(
        { evt: "ops.probe_incomplete", samples, failed },
        "探针轮次未完成，不更新 probe_at",
      );
    } finally {
      controller.abort();
    }
    return { completed, samples, failed, leaseLost, elapsedMs: performance.now() - started };
  };
  return (beat) =>
    (running ??= round(beat).finally(() => {
      running = undefined;
    }));
}
