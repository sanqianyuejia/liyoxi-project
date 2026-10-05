// 一次请求的上下文里放了什么（W0-22）。处理器经 c.var 取：
//   c.var.runtime    进程运行时：tx、config、clock、bizNo……（@liyoxi/services 的 Runtime）
//   c.var.requestId  请求编号，等于回包头 X-Request-Id
//   c.var.log        带着 reqId 的日志
//   c.var.clientIp   客户端 IP（按可信代理跳数取，http/client-ip.ts）；拿不到对端地址时是 null
//   c.var.identity   身份上下文：鉴权链放进来（M1）；公开路由上没有
//   c.var.sessionId  会话行的 id（不是令牌）：鉴权链放进来；按会话限流的档位用它，没有就退到操作人
//   c.var.idem       幂等上下文：写用例把它交给 runtime.tx.run(fn, { idem })
//   c.var.staff      后台请求的员工：会话校验的结果与判权用的上下文，后台的会话中间件放进来（W1-01a）；
//                    处理器不直接读它，用 defineAdminHandler 的第二个入参
import type {
  IdempotencyContext,
  IdentityContext,
  Logger,
  Runtime,
  StaffContext,
  StaffPrincipal,
} from "@liyoxi/services";

/** 后台请求的员工 */
export interface RequestStaff {
  /** 会话校验的结果：员工、角色行、分组、当前会话 */
  readonly principal: StaffPrincipal;
  /** 判权用的上下文：模块等级、生效的权限点、数据范围 */
  readonly ctx: StaffContext;
}

export interface ApiVariables {
  runtime: Runtime;
  requestId: string;
  log: Logger;
  clientIp: string | null;
  identity?: IdentityContext;
  sessionId?: string;
  idem?: IdempotencyContext;
  staff?: RequestStaff;
}

/** @hono/node-server 给的环境：只用到对端地址。用例里的 app.request() 可以照这个形状传 */
export interface ApiBindings {
  incoming?: { socket?: { remoteAddress?: string | undefined } };
}

export interface ApiEnv {
  Variables: ApiVariables;
  Bindings: ApiBindings;
}
