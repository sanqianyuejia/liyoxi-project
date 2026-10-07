import { createPrismaClient } from "@liyoxi/db";
import type { PrismaClient } from "@liyoxi/db";
import type { Assembly, Clock, Env, TxRunner } from "../kernel/index.js";
import type { ProviderLogger, Providers } from "../providers/types.js";
import type { Timers } from "../timers/index.js";
import { createAlerts } from "./alerts.js";
import { createBackup } from "./backup.js";
import { createCertChecker } from "./cert.js";
import { createProbe } from "./probe.js";
import { withPrimaryLease } from "./probe-support.js";
import { CONFIGURABLE_PROBE_RULES, sqlProbeRules } from "./probe-rules.js";
import { createQueueProbes } from "./queue-probes.js";

/** 两进程的必要端口。探针另用至多3连接、每语句2秒的读侧池；API只持久化事件事实。 */
export function createOpsRuntime(options: {
  readonly db: PrismaClient;
  readonly tx: TxRunner;
  readonly clock: Clock;
  readonly assembly: Assembly;
  readonly providers: Providers;
  readonly logger: ProviderLogger;
  readonly env?: Pick<
    Env,
    "BACKUP" | "CERT_DOMAINS" | "ALERT_ONCALL_PHONES" | "ALERT_P2_IMMEDIATE" | "PROBE_THRESHOLDS"
  >;
  readonly probeConnectionString?: string;
  readonly probeRedis?: { readonly url: string; readonly prefix: string };
  readonly timers: Timers;
}) {
  let holder: string | undefined;
  const { tx, clock, logger, assembly, providers, timers } = options;
  const thresholds = options.env?.PROBE_THRESHOLDS ?? {};
  if (
    Object.keys(thresholds).some(
      (key) => !CONFIGURABLE_PROBE_RULES.some((registered) => registered === key),
    )
  )
    throw new Error("探针阈值包含未登记规则键");
  const alerts = createAlerts({
    tx,
    clock,
    logger,
    providers,
    oncallPhones: options.env?.ALERT_ONCALL_PHONES,
    p2Immediate: options.env?.ALERT_P2_IMMEDIATE ?? [
      "billing.unfulfilled",
      "billing.expired_order",
      "billing.refund_stuck",
      "invariant.unresolved",
      "recurring.missed",
      "webhook.backlog",
      "billing.advance_failed",
      "order.start_capture_failed",
    ],
  });
  const backup = createBackup({
    storage: providers.storage,
    clock,
    logger,
    config: options.env?.BACKUP,
  });
  const cert = createCertChecker({ clock, domains: options.env?.CERT_DOMAINS ?? [] });
  const reader =
    options.probeConnectionString === undefined
      ? undefined
      : createPrismaClient({
          connectionString: options.probeConnectionString,
          max: 3,
          statementTimeoutMs: 2_000,
          lockTimeoutMs: 1_000,
          idleInTransactionSessionTimeoutMs: 5_000,
        });
  const queues =
    options.probeRedis === undefined
      ? undefined
      : createQueueProbes({
          redisUrl: options.probeRedis.url,
          prefix: options.probeRedis.prefix,
          clock,
          thresholds,
        });
  const probe = createProbe({
    db: reader ?? options.db,
    tx,
    clock,
    logger,
    alerts,
    rules: [
      ...sqlProbeRules(reader ?? options.db, clock, assembly, thresholds),
      ...(queues?.rules ?? []),
    ],
    holder: () => holder,
    ensureRecurring: (currentHolder, signal) =>
      withPrimaryLease(tx, currentHolder, async (handle) => {
        if (signal.aborted) return;
        await timers.ensureRecurring(handle, clock.now());
      }),
  });
  return {
    alerts,
    backup,
    cert,
    probe,
    setHolder: (value: string | undefined) => {
      holder = value;
    },
    close: async () => {
      await queues?.close();
      await reader?.$disconnect();
    },
  };
}
export type OpsRuntime = ReturnType<typeof createOpsRuntime>;
