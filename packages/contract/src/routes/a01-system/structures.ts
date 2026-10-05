// 后台：登录、员工、权限与系统 · 归 a01 的公共结构（docs/api/a01-system.md 第 2.1、2.2 节；约定 C43、C87；W1-01a）。
// AdminPage<T>、AdminCursorPage<T>、StaffBrief 由本文件定义，后台各文档引用员工、出页码分页时都取这里的，不另起同构结构。
// 各资源自己的结构写在同目录的 <资源>.schemas.ts。
import { IdSchema, openEnum } from "../../common/index.js";
import { STAFF_ROLE_KEY, STAFF_STATUS } from "../../enums/index.js";
import { z } from "../../zod.js";

/** AdminPage<T>：后台页码分页的响应（查询参数用通用的 PageQuerySchema） */
export function adminPage<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.int().min(1),
    pageSize: z.int().min(1),
    total: z.int().min(0),
  });
}
export type AdminPage<T> = { items: T[]; page: number; pageSize: number; total: number };

export const ADMIN_CURSOR_LIMIT_DEFAULT = 20;
export const ADMIN_CURSOR_LIMIT_MAX = 100;
/** totalApprox 的封顶值（A22） */
export const ADMIN_TOTAL_APPROX_CAP = 10_000;

/** 只增大表（audit_log、webhook_event）的查询参数：cursor 不透明，首页不传 */
export const AdminCursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN_CURSOR_LIMIT_MAX)
    .default(ADMIN_CURSOR_LIMIT_DEFAULT),
});

/** AdminCursorPage<T>：只增大表的响应，totalApprox 封顶 10,000 */
export function adminCursorPage<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.union([z.string(), z.null()]),
    hasMore: z.boolean(),
    totalApprox: z.int().min(0).max(ADMIN_TOTAL_APPROX_CAP),
  });
}
export type AdminCursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  totalApprox: number;
};

/** 员工摘要：列表、详情里引用员工的地方都用它（认领人、处理人、发起人、接收人等） */
export const StaffBriefSchema = z
  .object({
    staffId: IdSchema,
    /** 工号（1001 起） */
    staffNo: z.int(),
    name: z.string(),
    roleKey: openEnum(STAFF_ROLE_KEY.values),
    isLead: z.boolean(),
    status: openEnum(STAFF_STATUS.values),
  })
  .openapi("StaffBrief");
export type StaffBrief = z.infer<typeof StaffBriefSchema>;
