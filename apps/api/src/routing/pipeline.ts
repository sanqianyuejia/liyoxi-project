// 路由级中间件的装配：先后只在这里定（硬性规则 28；约定 C7；W0-22b 接手 W0-22 的 ROUTE_PIPELINE）。
//
// 两张表：
//   PIPELINE_ORDER    槽位的先后，一个槽位一种中间件。每条路由的链 = 按这个先后、取登记了又用得上的那几件。
//   ROUTE_MIDDLEWARES 登记表：哪个槽位、哪几组、由哪个工厂给。链的先后不看登记在第几行。
//
// 之后的包（两条鉴权链、下载页会话、回调验签、授权、再验证、开关……）：在 src/http/ 下写自己的中间件文件
//（一个 RouteMiddlewareFactory：按路由元数据决定挂不挂，用不着返回 null），在 ROUTE_MIDDLEWARES 末尾加一行。
// 不改 PIPELINE_ORDER，不在别处 app.use()。按组不同的（鉴权：商家、后台、下载页各一条链）各登记一行，写上 groups；
// 同一个槽位同一组只能登记一件，重了即启动失败。要加新的一种中间件：先在 PIPELINE_ORDER 里给它排位（改本文件的这一处）。
//
// 全局的四件（请求编号 → 访问日志 → 客户端 IP → Host 判断）在 app.ts，排在本表之前；
// 入参校验由 app.openapi() 排在本表之后、处理器之前。
import type { RouteGroup } from "@liyoxi/contract";

import { idempotency } from "../http/idempotency.js";
import { rateLimit } from "../http/rate-limit.js";

import type { RouteMiddlewareFactory } from "./types.js";

/**
 * 槽位的先后。约定 C7：版本门槛 → 鉴权 → 成员关系 → 协议同意 → 再验证 → 开关 → 限流 → 幂等上下文。
 * 约定没单列的三件照 D4 第 7.4 节插进去：后台访问面在鉴权之前；后台请求头检查在授权之前；授权在再验证之前。
 * 所以 401 / 403 / 426 / 428 / 429 都发生在幂等行落库之前。
 */
export const PIPELINE_ORDER = [
  /** 版本门槛：低于最低版本的小程序请求 426（约定 C71） */
  "versionGate",
  /** 后台访问面：IP 白名单（D4 第 9.8 节） */
  "surface",
  /** 鉴权：商家会话、后台会话、下载页会话，按组各一条链；把身份上下文放进 c.var.identity */
  "auth",
  /** 回调验签（x-auth: signed） */
  "signature",
  /** 成员关系与门店上下文（X-Store-Id） */
  "membership",
  /** 协议同意：有未同意的现行版本 428（约定 C73） */
  "consent",
  /** 后台的非 GET 请求：X-LYX-Admin 与 Origin */
  "csrf",
  /** 授权：商家端能力点、后台权限点与模块等级 */
  "authz",
  /** 再验证（约定 C66、C86） */
  "stepUp",
  /** 开关：受开关控制的路由 403 FEATURE_DISABLED（约定 C70） */
  "featureFlag",
  /** 限流（约定 C68） */
  "rateLimit",
  /** 幂等上下文（约定 C47–C50） */
  "idempotency",
] as const;

export type PipelineSlot = (typeof PIPELINE_ORDER)[number];

export interface PipelineEntry {
  /** 排在哪个槽位：也是这件中间件的名字，“声明即挂载”的规则表认它 */
  readonly slot: PipelineSlot;
  /** 只给这几组的路由；不写即四组都给 */
  readonly groups?: readonly RouteGroup[];
  readonly factory: RouteMiddlewareFactory;
}

/** 生产的登记表。一件一行，往末尾加 */
export const ROUTE_MIDDLEWARES: readonly PipelineEntry[] = [
  { slot: "rateLimit", factory: rateLimit() },
  { slot: "idempotency", factory: idempotency },
];
