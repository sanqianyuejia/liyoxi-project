// 一次请求的上下文里放了什么（W0-22）。处理器经 c.var 取：
//   c.var.runtime    进程运行时：tx、config、clock、bizNo……（@liyoxi/services 的 Runtime）
//   c.var.requestId  请求编号，等于回包头 X-Request-Id
//   c.var.log        带着 reqId 的日志
//   c.var.identity   身份上下文：鉴权链放进来（M1）；公开路由上没有
//   c.var.idem       幂等上下文：写用例把它交给 runtime.tx.run(fn, { idem })
import type { IdempotencyContext, IdentityContext, Logger, Runtime } from "@liyoxi/services";

export interface ApiVariables {
  runtime: Runtime;
  requestId: string;
  log: Logger;
  identity?: IdentityContext;
  idem?: IdempotencyContext;
}

export interface ApiEnv {
  Variables: ApiVariables;
}
