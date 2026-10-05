// m01-account 定义的、带 details 的领域错误码的结构（docs/api/m01-account.md 第 5 节），按符号名关联。
// 纯常量一侧（errors/domain/m01-account.ts）只标“带不带 details”；这里放 Zod 结构，同一个码的 details 类型唯一（约定 C22）。
// 先到的包新建本文件，后到的只往对象末尾加自己的码（docs/plan/tasks/README.md 第 7.3 节）。
import { IdSchema, orNull } from "../../common/index.js";
import type { DomainErrorSymbol } from "../../errors/index.js";
import { z } from "../../zod.js";

import { AgreementKeySchema } from "./agreement.schemas.js";

export const M01_ERROR_DETAILS = {
  /** 当前版本按 m01 第 3.12 节的唯一口径判定；该协议此刻没有生效版本时为 null */
  AGREEMENT_VERSION_STALE: z.object({
    agreementKey: AgreementKeySchema,
    currentAgreementVersionId: orNull(IdSchema),
  }),
} satisfies Partial<Record<DomainErrorSymbol, z.ZodType>>;

export type AgreementVersionStaleDetails = z.infer<
  (typeof M01_ERROR_DETAILS)["AGREEMENT_VERSION_STALE"]
>;
