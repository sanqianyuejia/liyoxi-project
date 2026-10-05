import type { PrismaClient } from "@liyoxi/db";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { assembleForTest, createRecordingPorts, useTestDatabase } from "../../testing/index.js";
import { put, rows } from "../__fixtures__/db.js";
import { defineRegistration, implement, implementKeyed } from "../assembly/index.js";
import { createTxRunner } from "../tx.js";
import type { Tx, TxRunner } from "../tx.js";
import {
  alertsOf,
  alertsPort,
  invariantsOf,
  invariantsPort,
  noopAlerts,
  noopInvariants,
  noopTrack,
  notifyReadOf,
  remindersOf,
  remindersPort,
  setPortLogger,
  trackOf,
  trackPort,
} from "./index.js";
import type { AlertInput, InvariantReport, TrackEvent } from "./index.js";

// 任务书 第 7 节验收 8、9：五个端口各两条（没人实现时走空实现；登记样例实现后由它接管），
// 另验埋点的实现抛错时业务事务照常提交。

const SLOW = 120_000;
const db = useTestDatabase("services");
let prisma: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = createTxRunner({ prisma, appEnv: "test" });
}, SLOW);

/** 接住端口的日志：[级别, 端口名] */
const logged: [string, unknown][] = [];
const capture = (): void =>
  setPortLogger({
    debug: (fields) => void logged.push(["debug", fields["port"]]),
    error: (fields) => void logged.push(["error", fields["port"]]),
  });

afterEach(() => {
  setPortLogger();
  logged.length = 0;
});

const alert: AlertInput = { rule: "lyxtest.rule", severity: "P2", detail: { n: 1 } };
const report: InvariantReport = {
  code: "lyxtest.I1",
  module: "lyxtest",
  severity: "P2",
  subject: { type: "work_calendar_day", key: "2026-01-05" },
  detail: {},
};
const event: TrackEvent = { name: "lyxtest_event", props: { a: 1 } };

/** 这个事务到现在有没有写过库：没写过的事务还没有分配事务号 */
async function hasWritten(handle: Tx): Promise<boolean> {
  const [row] = await handle.$queryRawUnsafe<{ written: boolean }[]>(
    "SELECT txid_current_if_assigned() IS NOT NULL AS written",
  );
  return row?.written === true;
}

describe("没人实现：走空实现", () => {
  const assembly = assembleForTest({ entry: "api" });

  it("真实模块的装配里五个端口都已声明，三个单实现的端口拿到的就是空实现", () => {
    expect(assembly.ports.map((item) => item.port.name)).toEqual(
      expect.arrayContaining([
        "alerts.raise",
        "invariants.report",
        "notify.read",
        "notify.remind",
        "track.record",
      ]),
    );
    expect(assembly.port(alertsPort)).toBe(noopAlerts);
    expect(assembly.port(invariantsPort)).toBe(noopInvariants);
    expect(assembly.port(trackPort)).toBe(noopTrack);
  });

  it("告警、不变量上报：不抛错，各只记一条调试日志", async () => {
    capture();
    await expect(alertsOf(assembly).raise(alert)).resolves.toBeUndefined();
    await expect(invariantsOf(assembly).report(report)).resolves.toBeUndefined();
    expect(logged).toEqual([
      ["debug", "alerts.raise"],
      ["debug", "invariants.report"],
    ]);
  });

  it(
    "埋点：事务内外都不抛错、不写库，各只记一条调试日志",
    async () => {
      capture();
      const track = trackOf(assembly);
      await expect(track.record(null, event)).resolves.toBeUndefined();
      const written = await tx.run(async (handle) => {
        await track.record(handle, event);
        return hasWritten(handle);
      });
      expect(written).toBe(false);
      expect(logged).toEqual([
        ["debug", "track.record"],
        ["debug", "track.record"],
      ]);
    },
    SLOW,
  );

  it(
    "通知场景解析返回空；提醒查询返回空列表",
    async () => {
      const read = notifyReadOf(assembly);
      const reminders = remindersOf(assembly);
      await tx.run(async (handle) => {
        expect(read.has("sampleForNotify")).toBe(false);
        expect(await read.read(handle, "sampleForNotify", { sampleId: "s1" })).toBeNull();
        expect(reminders.has("R4")).toBe(false);
        expect(await reminders.targets(handle, "R4", { pushedFrom: "a", pushedTo: "b" })).toEqual(
          [],
        );
        expect(await reminders.revalidate(handle, "R4", { sampleId: "s1" })).toEqual({
          valid: false,
        });
      });
    },
    SLOW,
  );
});

describe("登记了样例实现：由它接管", () => {
  const ports = createRecordingPorts({
    notifyReaders: {
      sampleForNotify: async (_tx, ref: { sampleId: string }) => ({ ...ref, dramaName: "巷口" }),
    },
    reminders: {
      R4: {
        targets: async (_tx, query) => [{ sampleId: "s1", query }],
        revalidate: async (_tx, target) => ({ valid: target["sampleId"] === "s1" }),
      },
      R7: { targets: async () => [{ dramaId: "d1" }] },
    },
  });
  const assembly = assembleForTest({ entry: "worker", extra: [ports.registration] });

  it("告警、不变量上报、埋点（事务外）交到了实现手里", async () => {
    await alertsOf(assembly).raise(alert);
    await invariantsOf(assembly).report(report);
    await trackOf(assembly).record(null, event);
    expect(ports.alerts).toEqual([alert]);
    expect(ports.reports).toEqual([report]);
    expect(ports.tracked).toEqual([event]);
  });

  it(
    "通知场景解析按函数名调到登记的函数；提醒查询按规则键调到登记的规则",
    async () => {
      const read = notifyReadOf(assembly);
      const reminders = remindersOf(assembly);
      await tx.run(async (handle) => {
        expect(await read.read(handle, "sampleForNotify", { sampleId: "s1" })).toEqual({
          sampleId: "s1",
          dramaName: "巷口",
        });
        // 同一个端口下没登记的函数名仍然解析为空
        expect(await read.read(handle, "isSamplePending", "s1", 2)).toBeNull();
        expect(await reminders.targets(handle, "R4", { pushedTo: "t" })).toEqual([
          { sampleId: "s1", query: { pushedTo: "t" } },
        ]);
        expect(await reminders.revalidate(handle, "R4", { sampleId: "s1" })).toEqual({
          valid: true,
        });
        expect(await reminders.revalidate(handle, "R4", { sampleId: "s9" })).toEqual({
          valid: false,
        });
        // 登记了规则、没给守卫：一律有效；没登记的规则仍是空列表
        expect(await reminders.revalidate(handle, "R7", { dramaId: "d1" })).toEqual({
          valid: true,
        });
        expect(await reminders.targets(handle, "R1", {})).toEqual([]);
      });
    },
    SLOW,
  );

  it("提醒端口登记了 R1–R7 之外的键：取用时报错", () => {
    const stray = defineRegistration("lyxtest_stray", {
      portImplementations: [implementKeyed(remindersPort, "R9", { targets: async () => [] })],
    });
    const bad = assembleForTest({ entry: "api", extra: [stray] });
    expect(() => remindersOf(bad)).toThrow(/R9/);
  });
});

describe("失败不抛：实现抛错不带坏调用方", () => {
  it("告警、不变量上报的实现抛错：调用方拿不到错，记一条错误日志", async () => {
    const boom = async (): Promise<void> => {
      throw new Error("写告警失败");
    };
    const failing = defineRegistration("lyxtest_failing", {
      portImplementations: [
        implement(alertsPort, { raise: boom }),
        implement(invariantsPort, { report: boom }),
      ],
    });
    const assembly = assembleForTest({ entry: "worker", extra: [failing] });
    capture();
    await expect(alertsOf(assembly).raise(alert)).resolves.toBeUndefined();
    await expect(invariantsOf(assembly).report(report)).resolves.toBeUndefined();
    expect(logged).toEqual([
      ["error", "alerts.raise"],
      ["error", "invariants.report"],
    ]);
  });

  it.each([
    { how: "写了一行之后抛普通的错", dbError: false, before: "PA", inside: "PB", after: "PC" },
    {
      how: "写了一行之后撞上数据库错误（主键冲突）",
      dbError: true,
      before: "PD",
      inside: "PE",
      after: "PF",
    },
  ])(
    "验收 9：埋点的实现$how，业务事务照常提交，埋点自己的写入不留",
    async ({ dbError, before, inside, after }) => {
      const ports = createRecordingPorts({
        track: async (handle) => {
          if (handle === null) throw new Error("事务外写埋点失败");
          await put(handle, inside);
          if (dbError) await put(handle, before); // 23505：没有保存点的话事务就此中止
          throw new Error("埋点写不进去");
        },
      });
      const assembly = assembleForTest({ entry: "api", extra: [ports.registration] });
      const track = trackOf(assembly);
      capture();
      await tx.run(async (handle) => {
        await put(handle, before);
        await expect(track.record(handle, event)).resolves.toBeUndefined();
        await put(handle, after);
      });
      // 事务外直记：实现抛错同样不抛给调用方
      await expect(track.record(null, event)).resolves.toBeUndefined();
      const saved = await rows(prisma);
      expect(saved).toMatchObject({ [before]: 1, [after]: 1 });
      expect(saved).not.toHaveProperty(inside);
      expect(logged).toEqual([
        ["error", "track.record"],
        ["error", "track.record"],
      ]);
    },
    SLOW,
  );
});
