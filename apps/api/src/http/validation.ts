// 入参校验（约定 C7、C22、C27）：请求的查询参数、路径参数、请求头、请求体按契约里的 Zod 结构校验，
// 由 app.openapi() 自带的校验器执行，排在幂等上下文之后、处理器之前。不合结构即 400 VALIDATION_FAILED，
// fieldErrors 的 path 是点分路径（数组下标写数字）。
import type { Hook } from "@hono/zod-openapi";

import type { ApiEnv } from "../context.js";

import { ValidationFailure } from "./errors.js";

export const validationHook: Hook<unknown, ApiEnv, string, void> = (result) => {
  if (result.success) return;
  throw new ValidationFailure(
    result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  );
};
