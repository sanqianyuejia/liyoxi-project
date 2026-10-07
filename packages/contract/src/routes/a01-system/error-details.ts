// a01-system 定义的、带 details 的领域错误码的结构（docs/api/a01-system.md 第 5 节），按符号名关联。
// 纯常量一侧（errors/domain/a01-system.ts）只标“带不带 details”；这里放 Zod 结构，同一个码的 details 类型唯一（约定 C22）。
// 先到的包新建本文件，后到的只往对象末尾加自己的码（docs/plan/tasks/README.md 第 7.3 节）。
import type { DomainErrorSymbol } from "../../errors/index.js";
import { z } from "../../zod.js";
import { openEnum, InstantSchema } from "../../common/index.js";
import { FILE_OBJECT_STATUS } from "../../enums/index.js";

/** 口令规则的编码。same_as_current 只在本人修改密码时出现（3.9，M2） */
export const PASSWORD_POLICY_RULES = [
  "min_length",
  "letters_and_digits",
  "contains_phone",
  "weak_password",
  "same_as_current",
] as const;
export type PasswordPolicyRule = (typeof PASSWORD_POLICY_RULES)[number];

export const A01_ERROR_DETAILS = {
  /** 未满足的规则，至少一条 */
  PASSWORD_POLICY_VIOLATED: z.object({ rules: z.array(z.enum(PASSWORD_POLICY_RULES)).min(1) }),
  CHECKLIST_VERSION_STALE: z.object({
    code: z.string(),
    currentVersionNo: z.number().int().nullable(),
  }),
  CHECKLIST_NOT_PASSED: z.object({
    missingKeys: z.array(z.string()),
    failedKeys: z.array(z.string()),
    invalidNaKeys: z.array(z.string()),
  }),
  DICT_ITEM_IN_USE: z.object({ refCount: z.int().positive() }),
  DICT_ITEM_LOCKED: z.object({ rule: z.string().min(1) }),
  PARAM_WITHDRAW_TOO_LATE: z.object({ effectiveAt: InstantSchema }),
  FILE_NOT_AVAILABLE: z.object({ status: openEnum(FILE_OBJECT_STATUS.values) }),
  WECOM_USERID_TAKEN: z.object({
    staffId: z.string().uuid(),
    name: z.string(),
    status: z.enum(["pending", "active", "disabled"]),
  }),
} satisfies Partial<Record<DomainErrorSymbol, z.ZodType>>;

export type PasswordPolicyViolatedDetails = z.infer<
  (typeof A01_ERROR_DETAILS)["PASSWORD_POLICY_VIOLATED"]
>;
export type WecomUseridTakenDetails = z.infer<(typeof A01_ERROR_DETAILS)["WECOM_USERID_TAKEN"]>;
