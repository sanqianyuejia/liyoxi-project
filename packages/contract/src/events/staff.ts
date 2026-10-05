// staff 模块发出的事件的载荷（docs/api/x01-events-jobs.md 第 3.3 节；03 分组 第 2.3 节状态机）。
// 载荷规则见 x01 第 2.3 节 P1–P7：只放 id 与枚举；状态迁移事件另带三个迁移键（P4），由 flow 补上。
import { IdSchema } from "../common/scalars.js";
import { STAFF_ROLE_KEY, STAFF_STATUS } from "../enums/staff.js";
import { zodEnum } from "../enums/zod.js";
import { z } from "../zod.js";

/** staff.created：新增员工、命令行引导（03:217–219） */
export const staffCreatedPayload = z.strictObject({
  v: z.literal(1),
  staffId: IdSchema,
  /** staff_role.key */
  roleKey: zodEnum(STAFF_ROLE_KEY),
  /** 新建：没有上一个状态 */
  fromState: z.null(),
  toState: zodEnum(STAFF_STATUS),
  /** 状态历史的事件码：staff.bootstrap、staff.create */
  transition: z.string().min(1),
});

export const payloads = {
  "staff.created": staffCreatedPayload,
} as const;
