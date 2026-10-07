import type { PrismaClient } from "@liyoxi/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTxRunner, KernelViolation } from "../kernel/index.js";
import type { TxRunner } from "../kernel/index.js";
import {
  createClock,
  createFakeProviders,
  createFactories,
  useSeededDatabase,
} from "../testing/index.js";
import { createAlerts } from "./alerts.js";

const db = useSeededDatabase("services");
let prisma: PrismaClient, tx: TxRunner;
const clock = createClock();
const logs: Array<Record<string, unknown>> = [];
const logger = {
  info: (f: Record<string, unknown>) => {
    logs.push(f);
  },
  warn: (f: Record<string, unknown>) => {
    logs.push(f);
  },
  error: (f: Record<string, unknown>) => {
    logs.push(f);
  },
};
const input = {
  rule: "outbox.exhausted",
  dimension: "event.subscriber",
  severity: "P2" as const,
  detail: { attempts: 8, phone: "13800138000", rawBody: "private", reason: "exhausted" },
};
beforeEach(async () => {
  await db.reset();
  prisma = await db.prisma();
  tx = createTxRunner({ prisma, appEnv: "test" });
  clock.set(new Date("2026-01-05T04:00:00Z"));
  logs.length = 0;
}, 60_000);
function build() {
  const providers = createFakeProviders({ clock });
  return {
    providers,
    alerts: createAlerts({ tx, clock, logger, providers, oncallPhones: ["13800138000"] }),
  };
}
async function superStaff() {
  return createFactories({ db: prisma, clock }).staff({ staffRoleKey: "super_admin" });
}

describe("告警事实与真实独立事务", () => {
  it("业务事务中raise，业务回滚后告警仍在；没有任何Provider外呼", async () => {
    const { alerts, providers } = build();
    await expect(
      tx.run(async (handle) => {
        await handle.bizSequence.create({
          data: { prefix: "OA", bizDate: new Date("2026-01-05"), nextVal: 1 },
        });
        await alerts.raise(input);
        throw new Error("business rollback");
      }),
    ).rejects.toThrow("business rollback");
    expect(await prisma.bizSequence.count({ where: { prefix: "OA" } })).toBe(0);
    const event = await prisma.alertEvent.findFirstOrThrow();
    expect(event).toMatchObject({
      fingerprint: "outbox.exhausted:event.subscriber",
      occurrences: 1,
      severity: "P2",
      status: "open",
      kind: "event",
      notifyCount: 0,
      lastNotifiedAt: null,
    });
    expect(event.lastValue).toEqual({ attempts: 8, reason: "exhausted" });
    expect(providers.wecom.calls).toHaveLength(0);
    expect(providers.sms.calls).toHaveLength(0);
  });
  it("20个并发同指纹只一行，occurrences无丢失，只升不降", async () => {
    const { alerts } = build();
    await Promise.all(
      Array.from({ length: 20 }, (_, n) =>
        alerts.raise({ ...input, severity: n === 12 ? "P1" : "P2" }),
      ),
    );
    expect(await prisma.alertEvent.count()).toBe(1);
    expect(await prisma.alertEvent.findFirstOrThrow()).toMatchObject({
      occurrences: 20,
      severity: "P1",
    });
    await alerts.raise({ ...input, severity: "P3" });
    expect((await prisma.alertEvent.findFirstOrThrow()).severity).toBe("P1");
  });
  it("独立写失败记录固定脱敏错误，业务提交和原异常不被改写", async () => {
    const { alerts } = build();
    const failure = vi.spyOn(tx, "run").mockRejectedValueOnce(new Error("SECRET_DATABASE"));
    await expect(alerts.raise(input)).resolves.toBeUndefined();
    failure.mockRestore();
    expect(logs).toContainEqual({ evt: "ops.alert_write_failed" });
    expect(JSON.stringify(logs)).not.toContain("SECRET_DATABASE");
    await tx.run((handle) =>
      handle.bizSequence.create({
        data: { prefix: "OB", bizDate: new Date("2026-01-05"), nextVal: 2 },
      }),
    );
    expect(await prisma.bizSequence.count({ where: { prefix: "OB" } })).toBe(1);
  });
  it("未知键可见且受控持久；非法维度不构造任意指纹", async () => {
    const { alerts } = build();
    await alerts.raise({ ...input, rule: "unknown.rule" });
    expect(await prisma.alertEvent.findFirstOrThrow()).toMatchObject({
      rule: "ops.unknown_rule",
      fingerprint: "ops.unknown_rule:unknown.rule",
    });
    expect(logs.some((l) => l["evt"] === "ops.alert_unknown_rule")).toBe(true);
    await alerts.raise({ ...input, dimension: "untrusted\nsecret" });
    expect(await prisma.alertEvent.count()).toBe(1);
  });
  it("短信未查询余量与固定模板suspect保持独立P3事实、去重及真实铃铛", async () => {
    const { alerts, providers } = build();
    const staff = await superStaff();
    const balance = {
      rule: "notify.sms_balance_unconfigured",
      severity: "P3" as const,
      detail: {
        outcome: "unsupported",
        reason: "complete_package_scope_and_threshold_unconfigured",
        queried: false,
      },
    };
    await alerts.raise(balance);
    await alerts.raise(balance);
    const templates = [
      "verify_code",
      "review_result",
      "sample_pending",
      "launch_remind",
      "plan_expiring",
      "offline_remind",
      "generic_todo",
      "account_notice",
      "ops_alert",
    ];
    for (const templateKey of templates) {
      const suspect = {
        rule: "notify.sms_suspect",
        dimension: templateKey,
        severity: "P3" as const,
        detail: { templateKey, criterion: "5_consecutive_or_recent_gt_half" },
      };
      await alerts.raise(suspect);
      await alerts.raise(suspect);
    }
    const rows = await prisma.alertEvent.findMany();
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.severity === "P3" && row.occurrences === 2)).toBe(true);
    expect(rows.find((row) => row.rule === balance.rule)).toMatchObject({
      fingerprint: balance.rule,
      lastValue: balance.detail,
    });
    expect(
      rows
        .filter((row) => row.rule === "notify.sms_suspect")
        .map((row) => row.fingerprint)
        .sort(),
    ).toEqual(templates.map((key) => `notify.sms_suspect:${key}`).sort());
    for (const row of rows.filter((row) => row.rule === "notify.sms_suspect"))
      expect(row.lastValue).toEqual({
        templateKey: row.fingerprint.split(":")[1],
        criterion: "5_consecutive_or_recent_gt_half",
      });
    expect(logs.some((log) => log["evt"] === "ops.alert_unknown_rule")).toBe(false);
    // 原循环每轮最多处理3条，完整排空10个独立事实后再验重入去重。
    for (let n = 0; n < 4; n++) await alerts.notify();
    await alerts.notify();
    expect(await prisma.staffMessage.count({ where: { staffId: staff.id } })).toBe(10);
    expect(
      await prisma.notificationDelivery.count({ where: { channel: "inbox", status: "sent" } }),
    ).toBe(10);
    expect(providers.wecom.robotMessages).toHaveLength(0);
    expect(providers.sms.sent).toHaveLength(0);
  });
  it("订阅ban/filter与匿名日上限保留独立P3事实，重复只增次数且真实铃铛去重", async () => {
    const { alerts, providers } = build();
    const staff = await superStaff();
    const configuredSlots = await prisma.wxTemplateSlot.findMany({
      where: { slotKey: { in: ["pay_result", "review_result", "ticket_reply"] } },
      select: { slotKey: true },
    });
    expect(configuredSlots).toHaveLength(3);
    const reports = configuredSlots.flatMap(({ slotKey }) =>
      (["ban", "filter"] as const).map((result) => ({
        rule: result === "ban" ? "notify.wx_banned" : "notify.wx_filtered",
        dimension: slotKey,
        severity: "P3" as const,
        detail: { point: "notify_settings", slotKey, result },
      })),
    );
    const dailyCap = {
      rule: "analytics.anon_daily_cap",
      severity: "P3" as const,
      detail: { dropped: 2 },
    };
    for (const report of [...reports, dailyCap]) {
      await alerts.raise(report);
      await alerts.raise(report);
    }
    const rows = await prisma.alertEvent.findMany();
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.severity === "P3" && row.occurrences === 2)).toBe(true);
    for (const report of reports) {
      expect(
        rows.find((row) => row.fingerprint === `${report.rule}:${report.dimension}`),
      ).toMatchObject({ rule: report.rule, lastValue: report.detail });
    }
    expect(rows.find((row) => row.rule === dailyCap.rule)).toMatchObject({
      fingerprint: dailyCap.rule,
      lastValue: dailyCap.detail,
    });
    expect(logs.some((log) => log["evt"] === "ops.alert_unknown_rule")).toBe(false);
    // 原通知循环每轮最多三条；排空7条真实事实，再重入检验三个通知表的去重。
    for (let n = 0; n < 3; n++) await alerts.notify();
    await alerts.notify();
    expect(await prisma.notification.count()).toBe(7);
    expect(await prisma.staffMessage.count({ where: { staffId: staff.id } })).toBe(7);
    expect(
      await prisma.notificationDelivery.count({ where: { channel: "inbox", status: "sent" } }),
    ).toBe(7);
    expect(providers.wecom.robotMessages).toHaveLength(0);
    expect(providers.sms.sent).toHaveLength(0);
  });
  it("探针连续3正常恢复，二次越限重置streak；事件静默6小时后恢复", async () => {
    const { alerts } = build();
    const breach = { rule: "timer.lag", severity: "P2" as const, detail: { value: 121 } };
    await alerts.breach(breach);
    await alerts.normal("timer.lag");
    await alerts.normal("timer.lag");
    expect((await prisma.alertEvent.findFirstOrThrow()).status).toBe("open");
    await alerts.breach(breach);
    expect((await prisma.alertEvent.findFirstOrThrow()).okStreak).toBe(0);
    for (let n = 0; n < 3; n++) await alerts.normal("timer.lag");
    expect(await prisma.alertEvent.findFirstOrThrow()).toMatchObject({
      status: "resolved",
      okStreak: 3,
      resolvedAt: clock.now(),
    });
    await alerts.breach(breach);
    expect(await prisma.alertEvent.count()).toBe(2);
    await alerts.raise(input);
    clock.advance(6 * 3_600_000);
    expect(await alerts.recoverQuietEvents()).toBe(0);
    clock.advance(1);
    expect(await alerts.recoverQuietEvents()).toBe(1);
  });
});

describe("真实三表铃铛与独立外部通道", () => {
  it("P1机器人失败不挡短信，真实super铃铛/投递写入，失败不丢alert", async () => {
    const { alerts, providers } = build();
    const staff = await superStaff();
    providers.wecom.failNext("sendRobotMessage");
    await alerts.raise({ ...input, severity: "P1" });
    const result = await alerts.notify();
    expect(result.delivered).toBe(1);
    expect(providers.wecom.robotMessages).toHaveLength(0);
    expect(providers.sms.sent).toHaveLength(1);
    expect(await prisma.staffMessage.count({ where: { staffId: staff.id } })).toBe(1);
    expect(await prisma.notificationDelivery.findFirstOrThrow()).toMatchObject({
      channel: "inbox",
      status: "sent",
      origin: "primary",
      isDirect: false,
    });
    expect(await prisma.alertEvent.count()).toBe(1);
    await alerts.notify();
    expect(await prisma.staffMessage.count()).toBe(1);
  });
  it("P2连续3次机器人真实失败才短信升级；两失败不升级", async () => {
    const { alerts, providers } = build();
    await superStaff();
    providers.wecom.failNext("sendRobotMessage", { times: 3 });
    await alerts.raise(input);
    await alerts.notify();
    clock.advance(61 * 60_000);
    await alerts.notify();
    expect(providers.sms.sent).toHaveLength(0);
    clock.advance(61 * 60_000);
    await createAlerts({ tx, clock, logger, providers, oncallPhones: ["13800138000"] }).notify();
    expect(providers.sms.sent).toHaveLength(1);
    expect(providers.sms.sent[0]).toMatchObject({
      kind: "oncall_alert",
      content: expect.stringContaining("ops.alert_channel_failed"),
    });
  });
  it("P1短信失败给机器人补充人工联系提示；已确认P1按4倍周期提醒", async () => {
    const { alerts, providers } = build();
    const staff = await superStaff();
    providers.sms.failNext("sendOncallAlert");
    await alerts.raise({ ...input, severity: "P1" });
    await alerts.notify();
    expect(providers.wecom.robotMessages).toHaveLength(2);
    expect(providers.wecom.robotMessages[1]?.content).toContain("值班短信失败，请人工联系值班人");
    expect(providers.sms.sent).toHaveLength(0);
    const event = await prisma.alertEvent.findFirstOrThrow();
    await prisma.alertEvent.update({
      where: { id: event.id },
      data: { status: "acked", ackedAt: clock.now(), ackedByStaffId: staff.id },
    });
    clock.advance(59 * 60_000);
    await alerts.notify();
    expect(providers.wecom.robotMessages).toHaveLength(2);
    clock.advance(60_000);
    await alerts.notify();
    expect(providers.wecom.robotMessages).toHaveLength(3);
    expect(providers.sms.sent).toHaveLength(1);
  });
  it("恢复后真实铃铛另命名空间仅一条；通知禁用不把inbox伪造为sent", async () => {
    const { alerts } = build();
    await superStaff();
    await alerts.breach({ rule: "timer.lag", severity: "P2", detail: {} });
    await alerts.notify();
    for (let n = 0; n < 3; n++) await alerts.normal("timer.lag");
    await alerts.notify();
    await alerts.notify();
    expect(await prisma.staffMessage.count()).toBe(2);
    expect(await prisma.notificationDelivery.count()).toBe(2);
    expect(
      await prisma.notification.count({ where: { dedupeKey: { contains: "recovered" } } }),
    ).toBe(1);
    await prisma.notifyScene.update({
      where: { sceneKey: "s.system_alert" },
      data: { sceneEnabled: false },
    });
    await alerts.raise({ ...input, dimension: "new" });
    await alerts.notify();
    expect(await prisma.staffMessage.count()).toBe(2);
    expect(
      logs.some((l) => l["evt"] === "ops.alert_bell_suppressed" && l["reason"] === "disabled"),
    ).toBe(true);
  });
  it("P3和汇总P2立即真实铃铛，外部仅每日汇总；铃铛缺场景不丢告警", async () => {
    const providers = createFakeProviders({ clock });
    const alerts = createAlerts({ tx, clock, logger, providers, p2Immediate: [] });
    await superStaff();
    await alerts.raise({ ...input, severity: "P3" });
    await alerts.raise({ ...input, dimension: "summary", severity: "P2" });
    await alerts.notify();
    await alerts.notify();
    expect(await prisma.staffMessage.count()).toBe(2);
    expect(providers.wecom.robotMessages).toHaveLength(0);
    expect(providers.sms.sent).toHaveLength(0);
    const original = tx.run.bind(tx);
    await alerts.raise({ ...input, dimension: "bellfails", severity: "P1" });
    const failBell = vi
      .spyOn(tx, "run")
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error("PRIVATE_BELL_FAILURE"));
    await alerts.notify();
    failBell.mockRestore();
    expect(await prisma.alertEvent.count()).toBe(3);
    expect(await prisma.staffMessage.count()).toBe(2);
    expect(
      logs.some((l) => l["evt"] === "ops.alert_channel_failed" && l["channel"] === "bell"),
    ).toBe(true);
  });
  it("notif只能从业务TX外执行，detach不是祖先Provider外呼逃逸", async () => {
    const { alerts } = build();
    await alerts.raise(input);
    await expect(tx.run(() => alerts.notify())).rejects.toBeInstanceOf(KernelViolation);
    expect(await prisma.notificationDelivery.count()).toBe(0);
  });
  it("09:30即使无P3也发每日心跳，实际UUID告警与铃铛，不复制第二次", async () => {
    const { alerts, providers } = build();
    await superStaff();
    clock.set(new Date("2026-01-06T01:30:00Z"));
    await alerts.notify();
    await alerts.notify();
    await createAlerts({ tx, clock, logger, providers }).notify();
    expect(providers.wecom.robotMessages).toHaveLength(1);
    expect(providers.wecom.robotMessages[0]?.content).toContain("昨日汇总告警 0 条");
    expect(await prisma.staffMessage.count()).toBe(1);
    expect(await prisma.alertEvent.count({ where: { rule: "ops.channel_heartbeat" } })).toBe(1);
  });
});
