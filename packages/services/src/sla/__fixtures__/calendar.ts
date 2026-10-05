// sla 连库用例的共用部分（W0-17）：2026、2027 两年的样例日历与带记录告警的 sla。只给本目录的测试用。
import type { PrismaClient } from "@liyoxi/db";

import {
  assembleForTest,
  createClock,
  createRecordingPorts,
  seedWorkCalendar,
} from "../../testing/index.js";
import type { AdjustableClock, RecordingPorts } from "../../testing/index.js";
import { createSla } from "../index.js";
import type { Sla, WorkHours } from "../index.js";

export const SLOW = 180_000;

/** 参数 work.start、work.end 的默认值 */
export const HOURS: WorkHours = { start: "09:00", end: "18:00" };

/** 北京时间的钟点写法 → 时刻 */
export const bj = (text: string): Date => new Date(`${text}:00+08:00`);

/** 2026 年国庆：10-01（周四）到 10-07 放假，10-10（周六）调休上班；另标元旦 */
export const HOLIDAYS_2026 = [
  "2026-01-01",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
];
export const ADJUSTED_2026 = ["2026-10-10"];

/** 铺 2026 全年（批次号 1） */
export const seed2026 = (prisma: PrismaClient): Promise<number> =>
  seedWorkCalendar(prisma, {
    from: "2026-01-01",
    to: "2026-12-31",
    holidays: HOLIDAYS_2026,
    adjustedWorkdays: ADJUSTED_2026,
  });

export interface SampleSla {
  sla: Sla;
  ports: RecordingPorts;
  clock: AdjustableClock;
}

/** 告警端口换成记录用的样例实现的 sla；时钟缺省停在 2026-09-01 10:00 */
export function sampleSla(): SampleSla {
  const ports = createRecordingPorts({ module: "lyxtest_sla_ports" });
  const clock = createClock(bj("2026-09-01T10:00"));
  const assembly = assembleForTest({ entry: "api", extra: [ports.registration] });
  return { sla: createSla({ assembly, clock }), ports, clock };
}
