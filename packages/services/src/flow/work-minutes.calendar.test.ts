import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { uuidv7 } from "../kernel/index.js";
import { calendarWorkMinutes, seed as calendarSeed } from "../sla/index.js";
import { assembleForTest, createSampleFlow, useTestDatabase } from "../testing/index.js";
import type { SampleFlow } from "../testing/index.js";
import {
  changed,
  historyOf,
  insertApproval,
  seedStaffRole,
  SLOW,
  staffContext,
} from "./__fixtures__/db.js";
import { workMinutesPort } from "./index.js";
import type { TransitionInput } from "./transition.js";

// 任务书 W0-30a 第 7 节第 1 条：工作分钟端口接上了真实实现（sla 登记的，读库里的工作日历与工作时段）。
// 库是支架给的（迁移建好），这里播上工作日历的种子（W0-21：2026 年带放假安排），审批单做带停留时长的迁移，
// elapsed_work_min 与手算相等。工作时段缺省是参数定义的默认值 09:00–18:00，不扣午休（01 分组 第 2.7 节）。
// 2026 年的几个日子：10-01（周四）至 10-07 国庆放假，10-10（周六）调休上班；10-12 是周一。

const db = useTestDatabase("services");
let prisma: PrismaClient;
let sample: SampleFlow;

/** 北京时间的钟点写法 → 时刻 */
const bj = (text: string): Date => new Date(`${text}:00+08:00`);

beforeAll(async () => {
  prisma = await db.prisma();
  // 不传 workMinutes：用的就是真实模块登记的那个实现
  sample = createSampleFlow(prisma);
  await seedStaffRole(prisma);
  await sample.tx.run((tx) => calendarSeed.run(tx, { now: bj("2026-01-05T12:00") }));
}, SLOW);

const approval = (id: string, extra: object): TransitionInput =>
  ({
    machine: "approval_request",
    stateField: "status",
    id,
    emit: changed,
    audit: {
      stream: "ops",
      category: "approval",
      action: "lyxtest.approval.transition",
      summary: "样例：审批单迁移",
      target: { type: "approval_request", id },
    },
    ...extra,
  }) as unknown as TransitionInput;

/** 一张审批单：from 提交、to 撤回，返回撤回那一行记下的 [自然秒, 工作分钟] */
async function stay(from: string, to: string): Promise<[number | null, number | null]> {
  const { id, staffId } = await insertApproval(prisma);
  const ctx = staffContext(staffId);
  sample.clock.set(bj(from));
  await sample.tx.run((tx) =>
    sample.flow.transition(tx, ctx, approval(id, { event: "submit", created: true })),
  );
  sample.clock.set(bj(to));
  await sample.tx.run((tx) =>
    sample.flow.transition(
      tx,
      ctx,
      approval(id, { event: "withdraw", set: { decided_at: sample.clock.now() } }),
    ),
  );
  const history = await historyOf(prisma, id);
  expect(history.map((row) => row.toState)).toEqual(["pending", "withdrawn"]);
  expect(history[0]?.elapsedWorkMin).toBeNull();
  return [history[1]?.elapsedSeconds ?? null, history[1]?.elapsedWorkMin ?? null];
}

/** 写一行参数值：从 effectiveAt 起生效 */
async function saveParam(key: string, value: string, effectiveAt: Date): Promise<void> {
  await prisma.paramValue.create({
    data: {
      id: uuidv7(),
      key,
      value,
      effectiveAt,
      cancelledAt: null,
      createdByStaffId: uuidv7(),
      createdAt: effectiveAt,
    },
  });
}

describe("工作分钟端口的真实实现（W0-30a）", () => {
  it("只装真实模块的登记（与生产装配相同）：端口的实现是 sla 登记的那一个，四个环境都是", () => {
    for (const appEnv of ["local", "test", "stg", "prod"] as const) {
      const assembly = assembleForTest({ entry: "api", appEnv });
      expect(assembly.port(workMinutesPort)).toBe(calendarWorkMinutes);
    }
  });

  it(
    "跨午休：不扣午休，11:30 到 13:30 是 120 分钟",
    async () => {
      expect(await stay("2026-10-13T11:30", "2026-10-13T13:30")).toEqual([7_200, 120]);
    },
    SLOW,
  );

  it(
    "跨周末：周五 17:00 到下周一 10:00，只算周五的 60 分钟与周一的 60 分钟",
    async () => {
      expect(await stay("2026-10-16T17:00", "2026-10-19T10:00")).toEqual([234_000, 120]);
    },
    SLOW,
  );

  it(
    "跨节假日：9 月 30 日 17:30 到 10 月 8 日 09:45，国庆七天不算，30 + 45 分钟",
    async () => {
      expect(await stay("2026-09-30T17:30", "2026-10-08T09:45")).toEqual([663_300, 75]);
    },
    SLOW,
  );

  it(
    "调休上班日照算：周五 17:00 到下周一 10:00，中间的周六（10-10）上班，60 + 540 + 60 分钟",
    async () => {
      expect(await stay("2026-10-09T17:00", "2026-10-12T10:00")).toEqual([234_000, 660]);
    },
    SLOW,
  );

  it(
    "日历没铺到的日期按周一至周五算，不抛错（2030-01-04 是周五）",
    async () => {
      expect(await stay("2030-01-04T17:00", "2030-01-07T10:00")).toEqual([234_000, 120]);
    },
    SLOW,
  );

  it(
    "工作时段读参数：改成 10:00–17:00 之后，整段按写入那一刻生效的时段算；生效之前写的不受影响",
    async () => {
      await saveParam("work.start", "10:00", bj("2026-11-01T00:00"));
      await saveParam("work.end", "17:00", bj("2026-11-01T00:00"));
      // 写入时刻在生效之前：还是 09:00–18:00，两个整天 1080 分钟
      expect((await stay("2026-10-29T09:00", "2026-10-30T18:00"))[1]).toBe(1_080);
      // 写入时刻在生效之后：周一、周二各 420 分钟
      expect((await stay("2026-11-02T09:00", "2026-11-03T18:00"))[1]).toBe(840);
      // 跨过生效时刻的一段：整段按写入那一刻的时段，周五 16:00–17:00 加周一 10:00–11:00
      expect((await stay("2026-10-30T16:00", "2026-11-02T11:00"))[1]).toBe(120);
    },
    SLOW,
  );

  it(
    "工作时段配反了（上班不早于下班）：用代码默认值 09:00–18:00，迁移不失败",
    async () => {
      // 接着上一条：下班是 17:00，这里把上班改成 19:00
      await saveParam("work.start", "19:00", bj("2026-12-01T00:00"));
      expect((await stay("2026-12-01T08:00", "2026-12-01T20:00"))[1]).toBe(540);
    },
    SLOW,
  );
});
