import { detach, uuidv7 } from "../kernel/index.js";
import { sendSystemAlert } from "../notify/index.js";
import type { AlertInput, Alerts, AlertSeverity, Clock, Tx, TxRunner } from "../kernel/index.js";
import type { ProviderLogger, ProviderResult, Providers } from "../providers/types.js";
import { ALERT_RULES, EVENT_QUIET_MS } from "./alert-rules.js";
import { withPrimaryLease, withProbeTimeout } from "./probe-support.js";

export interface AlertMessage {
  readonly id: string;
  readonly fingerprint: string;
  readonly severity: AlertSeverity;
  readonly recovered: boolean;
  readonly heartbeat?: boolean;
  readonly count?: number;
  readonly noticeNo?: number;
  readonly robotFailures?: number;
  readonly smsFailed?: boolean;
}
/** 通道不是成功回调：未配置/不支持必须返回 ProviderFailure。机器人、短信、铃铛各自独立。 */
interface AlertChannels {
  robot(message: AlertMessage): Promise<ProviderResult<void>>;
  sms(message: AlertMessage): Promise<ProviderResult<void>>;
  bell(message: AlertMessage, holder?: string): Promise<ProviderResult<void>>;
}
export interface AlertOptions {
  readonly tx: TxRunner;
  readonly clock: Clock;
  readonly logger: ProviderLogger;
  readonly providers: Pick<Providers, "wecom" | "sms">;
  readonly oncallPhones?: readonly string[];
  readonly p2Immediate?: readonly string[];
}
export interface OpsAlerts extends Alerts {
  breach(input: AlertInput, holder?: string): Promise<void>;
  normal(rule: string, dimension?: string, holder?: string): Promise<void>;
  recoverQuietEvents(holder?: string): Promise<number>;
  notify(
    signal?: AbortSignal,
    holder?: string,
  ): Promise<{ inspected: number; delivered: number; unconfigured: number }>;
}
const UNCONFIGURED = { ok: false, reason: "unconfigured", message: "告警通道尚未配置" } as const;

const RULE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const forbidden =
  /phone|openid|password|secret|token|cookie|authorization|license|idno|uscc|cipher|enc|rawbody|stack|message|error/i;
/** 仅存有界、无个人信息的诊断标量；不序列化未知对象或异常。 */
export function safeAlertDetail(
  detail: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(detail).slice(0, 32)) {
    if (forbidden.test(key) || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) continue;
    if (value === null || typeof value === "boolean") result[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else if (
      typeof value === "string" &&
      value.length <= 160 &&
      /^[a-zA-Z0-9_.:/@ -]*$/.test(value)
    )
      result[key] = value;
  }
  return result;
}
function fingerprint(input: AlertInput): string {
  if (!RULE.test(input.rule) || input.rule.length > 120) throw new TypeError("告警规则键不合法");
  if (
    input.dimension !== undefined &&
    (input.dimension.length === 0 ||
      input.dimension.length > 200 ||
      !/^[a-zA-Z0-9_.:/-]+$/.test(input.dimension))
  )
    throw new TypeError("告警维度不合法");
  return input.dimension === undefined ? input.rule : `${input.rule}:${input.dimension}`;
}
interface AlertRow {
  id: string;
  fingerprint: string;
  rule: string;
  severity: AlertSeverity;
  status: string;
  firstSeenAt: Date;
  resolvedAt: Date | null;
  lastNotifiedAt: Date | null;
  lastValue: unknown;
  notifyCount: number;
}
function sentSeverity(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const marker = (value as Record<string, unknown>)["_notifiedSeverity"];
  return typeof marker === "string" ? marker : undefined;
}
export function createAlerts(options: AlertOptions): OpsAlerts {
  const { tx, clock, logger, providers } = options;
  const text = (message: AlertMessage) =>
    message.heartbeat
      ? `每日通道心跳：昨日汇总告警 ${message.count ?? 0} 条`
      : `${message.recovered ? "已恢复" : "告警"} ${message.severity} ${message.fingerprint}${message.smsFailed ? "；值班短信失败，请人工联系值班人" : ""}`;
  const channels: AlertChannels = {
    robot: (message) =>
      providers.wecom.sendRobotMessage({
        title: "狸有戏运维",
        content: text(message),
        mentionAll: message.severity === "P1",
      }),
    sms: (message) =>
      options.oncallPhones?.length
        ? providers.sms.sendOncallAlert({
            phones: [...options.oncallPhones],
            title: "狸有戏运维告警",
            content: text(message),
          })
        : Promise.resolve(UNCONFIGURED),
    bell: async (message, holder) => {
      const writeBell = (handle: Tx) =>
        sendSystemAlert(handle, {
          alertId: message.id,
          fingerprint: message.fingerprint,
          severity: message.severity,
          recovered: message.recovered,
          noticeNo: message.noticeNo ?? 0,
          at: clock.now(),
        });
      const result = await (holder === undefined
        ? tx.run(writeBell)
        : withPrimaryLease(tx, holder, writeBell));
      if (result === undefined)
        return { ok: false, reason: "unavailable", message: "铃铛写入前已失去主租约" };
      if (result.status !== "sent")
        logger.info(
          { evt: "ops.alert_bell_suppressed", reason: result.status },
          "系统告警铃铛按场景和真实接收人降级",
        );
      return result.created > 0
        ? { ok: true, value: undefined }
        : { ok: false, reason: "rejected", message: "系统铃铛本轮未新增接收人消息" };
    },
  };
  if (options.p2Immediate?.some((key) => !ALERT_RULES.includes(key)))
    throw new Error("P2即时白名单含未登记规则键");
  const p2Immediate = options.p2Immediate === undefined ? undefined : new Set(options.p2Immediate);

  let heartbeatDay: string | undefined;
  const independent = <T>(fn: (handle: Tx) => Promise<T>, holder?: string) =>
    detach(() => (holder === undefined ? tx.run(fn) : withPrimaryLease<T>(tx, holder, fn)));
  const write = async (input: AlertInput, kind: "event" | "probe", holder?: string) => {
    try {
      fingerprint(input);
      const known = ALERT_RULES.includes(input.rule);
      if (!known)
        logger.error(
          { evt: "ops.alert_unknown_rule", rule: input.rule },
          "告警键未登记，已转为受控告警事实",
        );
      const actual: AlertInput = known
        ? input
        : {
            rule: "ops.unknown_rule",
            dimension: input.rule,
            severity: "P2",
            detail: { requestedRule: input.rule },
          };
      const key = fingerprint(actual);
      const now = clock.now();
      await independent(async (handle) => {
        await handle.$executeRawUnsafe(
          `INSERT INTO alert_event
          (id, fingerprint, rule, severity, kind, status, first_seen_at, last_seen_at, last_value, created_at, updated_at)
          VALUES ($1::uuid, $2, $3, $4, $5, 'open', $6, $6, $7::jsonb, $6, $6)
          ON CONFLICT (fingerprint) WHERE status IN ('open','acked') DO UPDATE
          SET severity = LEAST(alert_event.severity, EXCLUDED.severity),
              last_seen_at = EXCLUDED.last_seen_at, occurrences = alert_event.occurrences + 1,
              ok_streak = 0, updated_at = EXCLUDED.updated_at,
              last_value = EXCLUDED.last_value || CASE WHEN alert_event.last_value ? '_notifiedSeverity'
                THEN jsonb_build_object('_notifiedSeverity', alert_event.last_value->>'_notifiedSeverity') ELSE '{}'::jsonb END
              || CASE WHEN alert_event.last_value ? '_robotFailures' THEN jsonb_build_object('_robotFailures',alert_event.last_value->'_robotFailures') ELSE '{}'::jsonb END`,
          uuidv7(),
          key,
          actual.rule,
          actual.severity,
          kind,
          now,
          JSON.stringify(safeAlertDetail(actual.detail)),
        );
      }, holder);
    } catch {
      // 不带捕获异常、原参数或配置值；失败事实可见，业务原异常/提交不受影响。
      logger.error({ evt: "ops.alert_write_failed" }, "告警独立事务写入失败");
    }
  };
  const send = async (channel: keyof AlertChannels, message: AlertMessage, holder?: string) => {
    try {
      const result = await withProbeTimeout(
        channel === "bell" ? channels.bell(message, holder) : channels[channel](message),
        2_000,
      );
      if (!result.ok)
        (channel === "sms" && message.severity === "P1"
          ? logger.error.bind(logger)
          : logger.warn.bind(logger))(
          { evt: "ops.alert_channel_failed", channel, reason: result.reason, alertId: message.id },
          "告警通道未送达",
        );
      return result;
    } catch {
      logger.error(
        { evt: "ops.alert_channel_failed", channel, alertId: message.id },
        "告警通道失败",
      );
      return { ok: false, reason: "unavailable", message: "告警通道失败" } as const;
    }
  };
  const deliver = async (
    message: AlertMessage,
    holder?: string,
  ): Promise<{ sent: boolean; robotFailures: number }> => {
    const immediate =
      message.severity === "P1" ||
      (message.severity === "P2" &&
        (p2Immediate === undefined || p2Immediate.has(message.fingerprint.split(":")[0]!)));
    const names: Array<keyof AlertChannels> = message.heartbeat
      ? ["robot", "bell"]
      : message.severity === "P1"
        ? ["robot", "sms", "bell"]
        : immediate
          ? ["robot", "bell"]
          : ["bell"];
    const results = await Promise.all(names.map((name) => send(name, message, holder)));
    const robot = names.includes("robot") ? results[names.indexOf("robot")] : undefined;
    if (
      message.severity === "P2" &&
      robot?.ok === false &&
      robot.reason !== "unconfigured" &&
      robot.reason !== "unsupported"
    ) {
      const failures = Math.min(3, (message.robotFailures ?? 0) + 1);
      if (failures === 3)
        await send(
          "sms",
          { ...message, fingerprint: "ops.alert_channel_failed", severity: "P1" },
          holder,
        );
    }
    if (message.severity === "P1" && results[names.indexOf("sms")]?.ok === false)
      await send("robot", { ...message, smsFailed: true }, holder);
    return {
      sent: results.some((result) => result.ok),
      robotFailures:
        robot?.ok === true
          ? 0
          : robot?.ok === false && robot.reason !== "unconfigured" && robot.reason !== "unsupported"
            ? Math.min(3, (message.robotFailures ?? 0) + 1)
            : (message.robotFailures ?? 0),
    };
  };
  return {
    raise: (input) => write(input, "event"),
    breach: (input, holder) => write(input, "probe", holder),
    async normal(rule, dimension, holder) {
      const key = fingerprint({
        rule,
        ...(dimension === undefined ? {} : { dimension }),
        severity: "P3",
        detail: {},
      });
      await independent(async (handle) => {
        const now = clock.now();
        await handle.$executeRawUnsafe(
          `UPDATE alert_event SET ok_streak = ok_streak + 1,
          status = CASE WHEN ok_streak >= 2 THEN 'resolved' ELSE status END,
          resolved_at = CASE WHEN ok_streak >= 2 THEN $2::timestamptz ELSE NULL END,
          last_value=COALESCE(last_value,'{}'::jsonb)||CASE WHEN ok_streak>=2 THEN jsonb_build_object('_opsResolved',true) ELSE '{}'::jsonb END,
          updated_at = $2 WHERE fingerprint = $1 AND kind = 'probe' AND status IN ('open','acked')`,
          key,
          now,
        );
      }, holder);
    },
    async recoverQuietEvents(holder) {
      return (
        (await independent(async (handle) => {
          const now = clock.now();
          return handle.$executeRawUnsafe(
            `UPDATE alert_event SET status='resolved', resolved_at=$1, updated_at=$1,last_value=COALESCE(last_value,'{}'::jsonb)||jsonb_build_object('_opsResolved',true)
          WHERE kind='event' AND status IN ('open','acked') AND last_seen_at < $2`,
            now,
            new Date(now.getTime() - EVENT_QUIET_MS),
          );
        }, holder)) ?? 0
      );
    },
    async notify(signal, holder) {
      // 独立写事实完成后，由租约持有者在事务外的探针轮次发送；绝不在祖先业务 TX 链外呼。
      const now = clock.now();
      const rows = await tx.run((handle) =>
        handle.$queryRawUnsafe<AlertRow[]>(
          `SELECT id,fingerprint,rule,severity,status,
        first_seen_at AS "firstSeenAt", resolved_at AS "resolvedAt", last_notified_at AS "lastNotifiedAt", last_value AS "lastValue", notify_count AS "notifyCount"
        FROM alert_event WHERE
        (status='resolved' AND last_value->>'_opsResolved'='true' AND last_value->>'_recoveredNotified' IS DISTINCT FROM 'true')
        OR (status IN ('open','acked') AND rule<>'ops.channel_heartbeat'
          AND (last_notified_at IS NULL OR last_value->>'_notifiedSeverity' IS DISTINCT FROM severity
            OR ((severity='P1' OR (severity='P2' AND ($2::text[] IS NULL OR rule=ANY($2::text[])))) AND last_notified_at <= $1::timestamptz - (CASE WHEN severity='P1' THEN 15 ELSE 60 END * CASE WHEN status='acked' THEN 4 ELSE 1 END) * interval '1 minute')))
        ORDER BY severity,first_seen_at,id LIMIT 3`,
          now,
          p2Immediate === undefined ? null : [...p2Immediate],
        ),
      );
      let delivered = 0;
      let unconfigured = 0;
      for (const row of rows as AlertRow[]) {
        if (signal?.aborted) break;
        if (
          holder !== undefined &&
          (await withPrimaryLease<boolean>(tx, holder, async () => true)) !== true
        )
          break;
        const now = clock.now();
        const recovered = row.status === "resolved";
        const interval =
          (row.severity === "P1" ? 15 : 60) * 60_000 * (row.status === "acked" ? 4 : 1);
        const due = recovered
          ? row.resolvedAt !== null &&
            (row.lastValue as Record<string, unknown> | null)?.["_recoveredNotified"] !== true
          : row.lastNotifiedAt === null ||
            sentSeverity(row.lastValue) !== row.severity ||
            now.getTime() - row.lastNotifiedAt.getTime() >= interval;
        if (!due) continue;
        const sent = await deliver(
          {
            id: row.id,
            fingerprint: row.fingerprint,
            severity: row.severity,
            recovered,
            noticeNo: row.notifyCount,
            robotFailures: Number(
              (row.lastValue as Record<string, unknown> | null)?.["_robotFailures"] ?? 0,
            ),
          },
          holder,
        );
        await independent(
          (handle) =>
            handle.$executeRawUnsafe(
              "UPDATE alert_event SET last_value=COALESCE(last_value,'{}'::jsonb)||jsonb_build_object('_robotFailures',$2::int) WHERE id=$1::uuid",
              row.id,
              sent.robotFailures,
            ),
          holder,
        );
        if (!sent.sent) {
          unconfigured++;
          continue;
        }
        if (signal?.aborted) break;
        const marked = await independent(
          (handle: Tx) =>
            handle.$executeRawUnsafe(
              `UPDATE alert_event SET last_notified_at=$2, notify_count=notify_count+1,
          last_value=COALESCE(last_value,'{}'::jsonb)||jsonb_build_object('_notifiedSeverity',$3::text,'_recoveredNotified',$4::boolean), updated_at=$2 WHERE id=$1::uuid`,
              row.id,
              now,
              row.severity,
              recovered,
            ),
          holder,
        );
        if (marked === 1) delivered++;
      }
      const local = new Date(clock.now().getTime() + 8 * 3_600_000);
      const day = local.toISOString().slice(0, 10);
      if (
        !signal?.aborted &&
        local.getUTCHours() === 9 &&
        local.getUTCMinutes() >= 30 &&
        heartbeatDay !== day
      ) {
        await write(
          { rule: "ops.channel_heartbeat", dimension: day, severity: "P3", detail: {} },
          "event",
          holder,
        );
        const heartbeat = await tx.run((handle) =>
          handle.alertEvent.findFirstOrThrow({
            where: { fingerprint: `ops.channel_heartbeat:${day}` },
            orderBy: { firstSeenAt: "desc" },
          }),
        );
        if (heartbeat.lastNotifiedAt !== null) {
          heartbeatDay = day;
          return { inspected: rows.length, delivered, unconfigured };
        }
        const count = await tx.run((handle) =>
          handle.alertEvent.count({
            where: {
              OR: [
                { severity: "P3" },
                {
                  severity: "P2",
                  ...(p2Immediate === undefined
                    ? { rule: { in: [] } }
                    : { rule: { notIn: [...p2Immediate] } }),
                },
              ],
              NOT: { rule: "ops.channel_heartbeat" },
              lastSeenAt: { gte: new Date(clock.now().getTime() - 86_400_000) },
            },
          }),
        );
        const sent = await deliver(
          {
            id: heartbeat.id,
            fingerprint: "ops.channel_heartbeat",
            severity: "P3",
            recovered: false,
            heartbeat: true,
            count,
          },
          holder,
        );
        if (sent.sent && !signal?.aborted) {
          await independent(
            (handle) =>
              handle.alertEvent.update({
                where: { id: heartbeat.id },
                data: {
                  lastNotifiedAt: clock.now(),
                  notifyCount: { increment: 1 },
                  updatedAt: clock.now(),
                },
              }),
            holder,
          );
          heartbeatDay = day;
        } else unconfigured++;
      }
      return { inspected: rows.length, delivered, unconfigured };
    },
  };
}
