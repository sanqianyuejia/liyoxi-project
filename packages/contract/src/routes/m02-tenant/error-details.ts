// m02-tenant 定义的、带 details 的领域错误码的结构（docs/api/m02-tenant.md 第 5 节），按符号名关联。
// 纯常量一侧（errors/domain/m02-tenant.ts）只标“带不带 details”；这里放 Zod 结构，同一个码的 details 类型唯一（约定 C22）。
// 先到的包新建本文件，后到的只往对象末尾加自己的码（docs/plan/tasks/README.md 第 7.3 节）。
import { orNull } from "../../common/index.js";
import type { DomainErrorSymbol } from "../../errors/index.js";
import { z } from "../../zod.js";

export const M02_ERROR_DETAILS = {
  /** 调用者所在门店的名称（“您已是 XX 门店的店员”）；门店还没起名时为 null */
  ALREADY_IN_ENTITY: z.object({ storeName: orNull(z.string()) }),
} satisfies Partial<Record<DomainErrorSymbol, z.ZodType>>;

export type AlreadyInEntityDetails = z.infer<(typeof M02_ERROR_DETAILS)["ALREADY_IN_ENTITY"]>;
