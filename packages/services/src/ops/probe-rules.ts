import { recurringKey, slotAtOrBefore } from "../timers/index.js";
import type { AlertInput, Assembly, Clock } from "../kernel/index.js";
import type { SqlRunner } from "./binding.js";

export interface ProbeRule {
  readonly key: string;
  sample(): Promise<Readonly<Record<string, unknown>>>;
  evaluate(value: Readonly<Record<string, unknown>>): readonly AlertInput[];
  readonly fingerprints: readonly { rule: string; dimension?: string }[];
}
const age = (now: Date, value: unknown) =>
  value instanceof Date ? Math.max(0, (now.getTime() - value.getTime()) / 1_000) : 0;
const breach = (
  rule: string,
  metric: number,
  p2: number,
  p1?: number,
  dimension?: string,
): AlertInput[] =>
  metric > p2
    ? [
        {
          rule,
          severity: p1 !== undefined && metric > p1 ? "P1" : "P2",
          detail: { value: metric },
          ...(dimension === undefined ? {} : { dimension }),
        },
      ]
    : [];
export const CONFIGURABLE_PROBE_RULES = [
  "outbox.unpublished",
  "outbox.delivery_lag",
  "outbox.dead",
  "timer.lag",
  "timer.failures",
  "timer.lost_dispatch",
  "invariant.unresolved",
  "webhook.backlog",
  "billing.unfulfilled",
  "billing.expired_order",
  "billing.refund_stuck",
  "db.long_transaction",
  "backup.stale",
  "queue.outbox_delivery",
  "queue.timer_run",
  "queue.promote",
] as const;
export function sqlProbeRules(
  db: SqlRunner,
  clock: Clock,
  assembly: Assembly,
  thresholds: Readonly<Record<string, { p2: number; p1?: number }>> = {},
): ProbeRule[] {
  const configuredBreach = (
    rule: string,
    metric: number,
    p2: number,
    p1?: number,
    dimension?: string,
  ) => breach(rule, metric, thresholds[rule]?.p2 ?? p2, thresholds[rule]?.p1 ?? p1, dimension);
  const query = async (sql: string) =>
    (await db.$queryRawUnsafe<Record<string, unknown>[]>(sql, clock.now()))[0] ?? {};
  return [
    {
      key: "outbox",
      fingerprints: [
        { rule: "outbox.unpublished" },
        { rule: "outbox.delivery_lag" },
        { rule: "outbox.dead" },
      ],
      sample: () =>
        query(`SELECT (SELECT min(occurred_at) FROM outbox_event WHERE published_at IS NULL) AS event,
        (SELECT min(next_attempt_at) FROM outbox_delivery WHERE status IN ('pending','retry','leased') AND next_attempt_at <= $1) AS delivery,
        (SELECT count(*)::int FROM outbox_delivery WHERE status='dead') AS dead`),
      evaluate: (v) => [
        ...configuredBreach("outbox.unpublished", age(clock.now(), v["event"]), 60, 300),
        ...configuredBreach("outbox.delivery_lag", age(clock.now(), v["delivery"]), 300, 900),
        ...configuredBreach("outbox.dead", Number(v["dead"]), 0, 0),
      ],
    },
    {
      key: "timer",
      fingerprints: [
        { rule: "timer.lag" },
        { rule: "timer.failures" },
        { rule: "timer.lost_dispatch" },
      ],
      sample: () =>
        query(`SELECT min(COALESCE(retry_at,fire_at)) FILTER (WHERE status='scheduled' AND COALESCE(retry_at,fire_at) < $1) AS oldest,
        count(*) FILTER (WHERE status='failed')::int AS failed,
        count(*) FILTER (WHERE status='dispatched' AND lease_until < $1 AND is_enqueued)::int AS lost FROM timer`),
      evaluate: (v) => [
        ...configuredBreach("timer.lag", age(clock.now(), v["oldest"]), 120, 600),
        ...configuredBreach("timer.failures", Number(v["failed"]), 0),
        ...configuredBreach("timer.lost_dispatch", Number(v["lost"]), 0),
      ],
    },
    {
      key: "invariant",
      fingerprints: [
        { rule: "invariant.unresolved", dimension: "P1" },
        { rule: "invariant.unresolved", dimension: "P2" },
      ],
      sample: () =>
        query(
          `SELECT count(*) FILTER (WHERE severity='P1')::int AS p1,count(*) FILTER (WHERE severity<>'P1')::int AS p2 FROM invariant_violation WHERE resolved_at IS NULL AND $1::timestamptz IS NOT NULL`,
        ),
      evaluate: (v) => [
        ...configuredBreach("invariant.unresolved", Number(v["p1"]), 0, 0, "P1"),
        ...configuredBreach("invariant.unresolved", Number(v["p2"]), 0, undefined, "P2"),
      ],
    },
    {
      key: "webhook",
      fingerprints: [{ rule: "webhook.backlog" }],
      sample: () =>
        query(
          `SELECT count(*) FILTER(WHERE process_state='dead')::int AS dead,count(*) FILTER(WHERE process_state='failed' OR (process_state='received' AND received_at < $1::timestamptz - interval '10 minute'))::int AS lag FROM webhook_event`,
        ),
      evaluate: (v) =>
        configuredBreach(
          "webhook.backlog",
          Number(v["dead"]) + Number(v["lag"]),
          0,
          Number(v["dead"]) > 0 ? 0 : undefined,
        ),
    },
    {
      key: "billing",
      fingerprints: [
        { rule: "billing.unfulfilled" },
        { rule: "billing.expired_order" },
        { rule: "billing.refund_stuck" },
      ],
      sample: () =>
        query(`SELECT (SELECT min(p.channel_success_at) FROM payment_txn p LEFT JOIN billing_order b ON b.paid_payment_txn_id=p.id WHERE p.status='succeeded' AND (b.id IS NULL OR b.fulfillment_status<>'done')) AS unfulfilled,
        (SELECT count(*)::int FROM billing_order WHERE status='pending_payment' AND expires_at < $1::timestamptz - interval '10 minute') AS expired,
        (SELECT count(*)::int FROM refund_txn WHERE status='processing' AND created_at < $1::timestamptz - interval '3 day') AS refunds,
        (SELECT count(*)::int FROM refund_txn WHERE status='abnormal') AS abnormal`),
      evaluate: (v) => [
        ...configuredBreach("billing.unfulfilled", age(clock.now(), v["unfulfilled"]), 120, 600),
        ...configuredBreach("billing.expired_order", Number(v["expired"]), 0),
        ...configuredBreach(
          "billing.refund_stuck",
          Number(v["refunds"]) + Number(v["abnormal"]),
          0,
          Number(v["abnormal"]) > 0 ? 0 : undefined,
        ),
      ],
    },
    {
      key: "database",
      fingerprints: [{ rule: "db.long_transaction" }],
      sample: () =>
        query(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND xact_start < clock_timestamp()-interval '60 second' AND pid <> pg_backend_pid() AND $1::timestamptz IS NOT NULL`,
        ),
      evaluate: (v) => configuredBreach("db.long_transaction", Number(v["n"]), 0),
    },
    {
      key: "backup",
      fingerprints: [{ rule: "backup.stale" }],
      sample: () =>
        query(
          `SELECT max(fired_at) FILTER(WHERE status='fired' AND result->>'status'='succeeded') AS last FROM timer WHERE kind='backup.pgdump' AND $1::timestamptz IS NOT NULL`,
        ),
      evaluate: (v) =>
        configuredBreach(
          "backup.stale",
          v["last"] === null ? Number.MAX_SAFE_INTEGER : age(clock.now(), v["last"]),
          26 * 3600,
          26 * 3600,
        ),
    },
    ...assembly.recurringJobs
      .filter(
        (job) =>
          job.schedule !== undefined &&
          job.deadlineMin !== undefined &&
          job.missSeverity !== undefined,
      )
      .map((job): ProbeRule => ({
        key: `recurring:${job.kind}`,
        fingerprints: [{ rule: "recurring.missed", dimension: job.kind }],
        async sample() {
          const now = clock.now(),
            slot = slotAtOrBefore(job.schedule!, now);
          const rows = await db.$queryRawUnsafe<{ status: string }[]>(
            "SELECT status FROM timer WHERE dedupe_key=$1",
            recurringKey(job.kind, slot),
          );
          return {
            overdue: now.getTime() - slot.getTime() > job.deadlineMin! * 60_000,
            status: rows[0]?.status ?? "missing",
          };
        },
        evaluate: (v) =>
          v["status"] === "failed" || (v["overdue"] === true && v["status"] !== "fired")
            ? [
                {
                  rule: "recurring.missed",
                  dimension: job.kind,
                  severity: job.missSeverity!,
                  detail: { kind: job.kind, status: v["status"] },
                },
              ]
            : [],
      })),
  ];
}
