import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  alertsOf,
  alertsPort,
  createTxRunner,
  defineRegistration,
  implement,
  setPortLogger,
  uuidv7,
} from "../kernel/index.js";
import type { TxRunner } from "../kernel/index.js";
import {
  assembleForTest,
  createClock,
  createRecordingPorts,
  useTestDatabase,
} from "../testing/index.js";
import {
  alertRepeatedStaffLocks,
  AUTH_EVENT_RETENTION_DAYS,
  countLocksToday,
  purgeAuthEvents,
  recordAuthEvent,
  STAFF_LOCK_ALERT_RULE,
} from "./auth-event.js";
import type { AuthEventInput } from "./auth-event.js";

// 任务书 W1-01a 第 7 节验收 7 里归 audit 的一半：写函数、12 个月清理、锁定告警。
// 登录用例各写哪一行，在 staff 的用例里验。连接是支架给的缺省身份（应用角色 lyx_app）。

const db = useTestDatabase("services");
const DAY = 24 * 60 * 60 * 1000;
let prisma: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = createTxRunner({ prisma, appEnv: "test" });
}, 120_000);
afterAll(() => setPortLogger());

const write = (input: AuthEventInput): Promise<string> =>
  tx.run((handle) => recordAuthEvent(handle, input));
const locked = (staffId: string, at: Date, bucket: "trusted" | "untrusted" = "untrusted") =>
  write({
    space: "staff",
    subjectId: staffId,
    event: "locked",
    method: "password",
    at,
    detail: { bucket },
  });

describe("recordAuthEvent", () => {
  it("五种事件各写一行，列照原样；UA 截到 512；账号没认出来时 subject_id 为空", async () => {
    const staffId = uuidv7();
    const at = new Date("2026-01-05T04:00:00.000Z");
    const events = ["login_success", "login_fail", "locked", "step_up", "logout"] as const;
    for (const event of events) {
      await write({
        space: "staff",
        subjectId: staffId,
        event,
        method: "password+totp",
        ip: "10.0.0.8",
        userAgent: "U".repeat(600),
        detail: { bucket: "untrusted", reason: "bad_password" },
        at,
      });
    }
    const rows = await prisma.authEvent.findMany({
      where: { subjectId: staffId },
      orderBy: { seq: "asc" },
    });
    expect(rows.map((row) => row.event)).toEqual([...events]);
    expect(rows[0]).toMatchObject({
      space: "staff",
      method: "password+totp",
      ip: "10.0.0.8",
      createdAt: at,
      detail: { bucket: "untrusted", reason: "bad_password" },
    });
    expect(rows[0]?.userAgent).toHaveLength(512);

    const anonymous = await write({ space: "staff", subjectId: null, event: "login_fail", at });
    const row = await prisma.authEvent.findUniqueOrThrow({ where: { id: anonymous } });
    expect(row).toMatchObject({ subjectId: null, method: null, ip: null, detail: null });
  });

  it("事件、身份空间不在契约的枚举里，账号 id 不是 UUID：抛 TypeError，不落库", async () => {
    const before = await prisma.authEvent.count();
    const at = new Date("2026-01-05T04:00:00.000Z");
    const bad = [
      { space: "staff", subjectId: null, event: "unlock", at },
      { space: "admin", subjectId: null, event: "logout", at },
      { space: "staff", subjectId: "1001", event: "logout", at },
    ] as unknown as AuthEventInput[];
    for (const input of bad) await expect(write(input)).rejects.toBeInstanceOf(TypeError);
    expect(await prisma.authEvent.count()).toBe(before);
  });

  it("事务回滚，事件不留", async () => {
    const staffId = uuidv7();
    await expect(
      tx.run(async (handle) => {
        await recordAuthEvent(handle, {
          space: "staff",
          subjectId: staffId,
          event: "logout",
          at: new Date(),
        });
        throw new Error("回滚");
      }),
    ).rejects.toThrow("回滚");
    expect(await prisma.authEvent.count({ where: { subjectId: staffId } })).toBe(0);
  });
});

describe("清理：早于 12 个月才删", () => {
  it("保留期之外的删掉，之内的留着；再跑一遍删 0 行", async () => {
    const staffId = uuidv7();
    const now = new Date();
    const ages = [AUTH_EVENT_RETENTION_DAYS + 30, AUTH_EVENT_RETENTION_DAYS + 1, 364, 30, 0];
    for (const days of ages) {
      await write({
        space: "staff",
        subjectId: staffId,
        event: "login_success",
        at: new Date(now.getTime() - days * DAY),
        detail: { reason: `d${days}` },
      });
    }
    expect(await tx.run((handle) => purgeAuthEvents(handle, { now }))).toBe(2);
    const left = await prisma.authEvent.findMany({
      where: { subjectId: staffId },
      orderBy: { createdAt: "asc" },
    });
    expect(left.map((row) => (row.detail as { reason: string }).reason)).toEqual([
      "d364",
      "d30",
      "d0",
    ]);
    expect(await tx.run((handle) => purgeAuthEvents(handle, { now }))).toBe(0);
  });

  it("清理项已登记：audit.auth_event，每日", () => {
    const cleanup = assembleForTest({ entry: "worker" }).cleanup("audit.auth_event");
    expect(cleanup).toMatchObject({ module: "audit", every: "day", run: purgeAuthEvents });
  });
});

describe("锁定告警：同一员工当天陌生来源桶被锁满 3 次", () => {
  const clock = createClock(); // 2026-01-05 12:00（北京时间）

  it("第 3 次才报，报一次；可信设备桶、昨天的、别人的都不算", async () => {
    const ports = createRecordingPorts();
    const alerts = alertsOf(assembleForTest({ entry: "api", extra: [ports.registration] }));
    const staffId = uuidv7();
    const now = clock.now();
    const check = () => alertRepeatedStaffLocks(prisma, alerts, { staffId, now });

    await locked(staffId, new Date(now.getTime() - DAY)); // 昨天
    await locked(staffId, now, "trusted");
    await locked(uuidv7(), now);
    await locked(staffId, now);
    expect(await check()).toBe(false);
    await locked(staffId, new Date("2026-01-04T16:00:00.000Z")); // 北京时间当天零点整
    expect(await check()).toBe(false);
    expect(ports.alerts).toEqual([]);

    await locked(staffId, now);
    expect(
      await countLocksToday(prisma, {
        space: "staff",
        subjectId: staffId,
        bucket: "untrusted",
        now,
      }),
    ).toBe(3);
    expect(await check()).toBe(true);
    expect(ports.alerts).toEqual([
      {
        rule: STAFF_LOCK_ALERT_RULE,
        dimension: staffId,
        severity: "P2",
        detail: { staffId, bucket: "untrusted", locksToday: 3 },
      },
    ]);
  });

  it("端口的实现抛错：不抛给调用方", async () => {
    const errors: string[] = [];
    setPortLogger({
      debug: () => undefined,
      error: (_fields, message) => void errors.push(message),
    });
    const failing = defineRegistration("lyxtest_alerts_down", {
      portImplementations: [
        implement(alertsPort, { raise: () => Promise.reject(new Error("ops 不可用")) }),
      ],
    });
    const alerts = alertsOf(assembleForTest({ entry: "api", extra: [failing] }));
    const staffId = uuidv7();
    const now = clock.now();
    for (let index = 0; index < 3; index += 1) await locked(staffId, now);
    await expect(alertRepeatedStaffLocks(prisma, alerts, { staffId, now })).resolves.toBe(true);
    expect(errors).toHaveLength(1);
  });
});
