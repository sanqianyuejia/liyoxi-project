// 路由级中间件的清单（W0-22）。每一项按路由元数据决定要不要挂、怎么挂，并带一个名字：
// “声明即挂载”的核对（requirements.ts）认的就是这个名字。
//
// 约定 C7 的先后：请求编号 → 访问日志 → 版本门槛 → 鉴权 → 成员关系 → 协议同意 → 再验证 → 开关 → 限流
// → 幂等上下文 → 入参校验 → 处理器。前两件是全局的（app.ts）；入参校验由 app.openapi() 排在本清单之后。
// 本包只有“幂等上下文”一件。W0-22b 接手本文件，把它定成装配顺序的唯一定义；之后的包（两条鉴权链、限流等）
// 只各加自己的中间件文件，在这里各占一行。
import { idempotency } from "../http/idempotency.js";

import type { RouteMiddlewareFactory } from "./types.js";

export const ROUTE_PIPELINE: readonly RouteMiddlewareFactory[] = [idempotency];
