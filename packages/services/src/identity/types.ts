// identity 各用例共用的类型（W1-04）。
import type { DeviceInfo } from "@liyoxi/contract";

/** 请求元信息：接口层从请求上取好带进来（identity 不读请求头） */
export interface RequestMeta {
  readonly requestId: string | null;
  /** 客户端 IP（按可信代理跳数取）；拿不到为空 */
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** 请求头 X-Client-Version：进同意记录的设备快照 */
  readonly clientVersion: string | null;
}

/** 当前会话：鉴权中间件每请求点查会话行得到，往后的中间件与处理器用它 */
export interface SessionPrincipal {
  readonly sessionId: string;
  readonly merchantUserId: string;
  /** 登录所用的微信身份（未吊销的会话必有） */
  readonly wechatIdentityId: string;
  /** 账号上记的用户级协议指纹：协议同意中间件拿它与当前指纹比，常态只比一次字符串 */
  readonly consentStamp: string | null;
}

const DEVICE_INFO_MAX = 512;

/** 设备摘要：机型 · 系统 · 微信版本，截到 512 字符，写 user_session.device_info；都没有为空 */
export function deviceSummary(device: DeviceInfo | undefined): string | null {
  if (device === undefined) return null;
  const parts = [
    device.model,
    device.system,
    device.wechatVersion === undefined ? undefined : `微信 ${device.wechatVersion}`,
  ].filter((part): part is string => part !== undefined && part.trim() !== "");
  if (parts.length === 0) return null;
  return Array.from(parts.join(" · ")).slice(0, DEVICE_INFO_MAX).join("");
}
