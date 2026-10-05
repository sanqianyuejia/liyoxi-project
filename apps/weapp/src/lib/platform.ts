// 小程序接口的适配层（任务书 W0-27a 第 11 节第 7 项）：请求层与四个端上封装只认这里的接口，不直接碰 wx / Taro，
// 所以能在 Node 里测。真实实现在 platform.taro.ts，由 runtime.ts 装配；用例里换成手写的替身。

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** 发往服务端的一次请求。失败（断网、超时、域名不通）时 send 抛错，不给回包 */
export interface WireRequest {
  url: string;
  method: HttpMethod;
  header: Record<string, string>;
  data?: unknown;
  /** 毫秒 */
  timeout: number;
}

export interface WireResponse {
  statusCode: number;
  /** 回包体：JSON 已解析成对象；不是 JSON（网关的错误页）时是字符串或空 */
  data: unknown;
  header: Record<string, string>;
}

export type SendFn = (request: WireRequest) => Promise<WireResponse>;

/** 本地存储：读不到返回 null；写失败不抛（存储满了不该把业务流程打断） */
export interface KeyValueStorage {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

export interface Clock {
  /** 毫秒时间戳 */
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** 请求头 X-Client-Platform 的取值（约定 C17） */
export type ClientPlatform = "ios" | "android" | "harmony" | "windows" | "mac" | "devtools";
/** 请求头 X-Env-Version 的取值 */
export type EnvVersion = "develop" | "trial" | "release";

export interface ClientInfo {
  platform: ClientPlatform;
  /** 小程序版本号 */
  version: string;
  envVersion: EnvVersion;
}

/** wx.requestSubscribeMessage 的逐模板结果 */
export type SubscribeAnswer = "accept" | "reject" | "ban" | "filter";

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * UUID v4。小程序的运行环境没有 crypto.randomUUID，这里用 Math.random 拼：
 * 只用作请求编号、幂等键、事件编号这类“碰不上就行”的标识，不当密钥、不当令牌。
 */
export function uuid(): string {
  let out = "";
  for (let index = 0; index < 36; index += 1) {
    if (index === 8 || index === 13 || index === 18 || index === 23) out += "-";
    else if (index === 14) out += "4";
    else {
      const random = Math.floor(Math.random() * 16);
      out += (index === 19 ? (random & 0x3) | 0x8 : random).toString(16);
    }
  }
  return out;
}
