// a01-system 定义的、带 details 的领域错误码的结构（docs/api/a01-system.md 第 5 节），按符号名关联。
// 纯常量一侧（errors/domain/a01-system.ts）只标“带不带 details”；这里放 Zod 结构，同一个码的 details 类型唯一（约定 C22）。
// 先到的包新建本文件，后到的只往对象末尾加自己的码（docs/plan/tasks/README.md 第 7.3 节）。
import type { DomainErrorSymbol } from "../../errors/index.js";
import { z } from "../../zod.js";

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
} satisfies Partial<Record<DomainErrorSymbol, z.ZodType>>;

export type PasswordPolicyViolatedDetails = z.infer<
  (typeof A01_ERROR_DETAILS)["PASSWORD_POLICY_VIOLATED"]
>;
