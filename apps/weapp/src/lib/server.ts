// 服务端调用的接入点。本包（W0-27a）交的是请求层与四个端上封装，对应的接口在后面的包里落地：
// 引导与会话在 W1-04，订阅结果与埋点接收在 G2-C，错误上报接口按契约的里程碑归属。
// 所以这里只定“要接哪几个调用、各自长什么样”，一个都没接：没接上的调用，对应的封装空转、不报错。
// 接口落地的那个包用 connectServer({ … }) 接上自己那一个，实现里用 runtime.ts 的 request，类型取契约的生成类型。
import type { SubscribeResultBody } from "./subscribe";
import type { AnalyticsEventBatch, SendOutcome } from "./track";
import type { BootstrapData } from "../stores/bootstrap";

export interface ServerCalls {
  /** m.bootstrap.get：GET /m/bootstrap */
  fetchBootstrap(): Promise<Partial<BootstrapData>>;
  /**
   * 静默登录：m.session.create，POST /m/sessions，请求体 { loginCode }（约定 C3）。
   * 拿到令牌时由实现写进会话 store 并返回 ok；needPhone 为真返回 needPhone；其余返回 failed
   */
  silentLogin(loginCode: string): Promise<"ok" | "needPhone" | "failed">;
  /** 重拉 m.me.get；当前门店失效时回到门店选择并提示 */
  reloadMe(): Promise<void>;
  /** 弹协议确认并提交同意；返回用户是否同意 */
  askConsent(details: unknown): Promise<boolean>;
  /** 提示更新（wx.getUpdateManager） */
  showUpdatePrompt(): Promise<void>;
  /** m.subscribeResult.create：POST /m/subscribe-results，幂等键照传 */
  reportSubscribeResult(body: SubscribeResultBody, idempotencyKey: string): Promise<unknown>;
  /** m.analyticsEvent.batchCreate：POST /m/analytics-events。网络失败或 5xx 返回 retry，其余错误返回 drop */
  sendAnalytics(batch: AnalyticsEventBatch): Promise<SendOutcome>;
  /** m.clientError.create：POST /m/client-errors，请求体是信封原文（application/x-sentry-envelope） */
  sendClientError(envelope: string): Promise<unknown>;
}

const connected: Partial<ServerCalls> = {};

/** 接上一个或几个调用。后接的盖掉先接的 */
export function connectServer(calls: Partial<ServerCalls>): void {
  Object.assign(connected, calls);
}

/** 取一个调用；没接上时是 undefined */
export function serverCall<K extends keyof ServerCalls>(name: K): ServerCalls[K] | undefined {
  return connected[name];
}
