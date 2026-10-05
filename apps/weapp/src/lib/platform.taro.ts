// 适配层的真实实现：把 platform.ts 的接口接到 Taro 上。lib/ 下只有这里、nav.ts 与 runtime.ts 碰 Taro；
// 用例不引本文件。H5（只给截图命令用）下取不到的值都有兜底，不抛错。
import Taro from "@tarojs/taro";

import type { ClientInfo, ClientPlatform, EnvVersion, KeyValueStorage, SendFn } from "./platform";

export const send: SendFn = async (request) => {
  const response = await Taro.request({
    url: request.url,
    method: request.method,
    header: request.header,
    data: request.data,
    timeout: request.timeout,
    // 信封这类非 JSON 的请求体原样发；回包不是 JSON 时 data 是字符串
    dataType: "json",
  });
  return {
    statusCode: response.statusCode,
    data: response.data as unknown,
    header: (response.header ?? {}) as Record<string, string>,
  };
};

export const storage: KeyValueStorage = {
  get<T>(key: string): T | null {
    try {
      const value = Taro.getStorageSync(key) as T | "" | undefined;
      return value === "" || value === undefined || value === null ? null : value;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      Taro.setStorageSync(key, value);
    } catch {
      // 存储满了或被禁用：不打断业务流程
    }
  },
  remove(key) {
    try {
      Taro.removeStorageSync(key);
    } catch {
      // 同上
    }
  },
};

const PLATFORMS: Record<string, ClientPlatform> = {
  ios: "ios",
  android: "android",
  ohos: "harmony",
  windows: "windows",
  mac: "mac",
  devtools: "devtools",
};
const ENV_VERSIONS: readonly string[] = ["develop", "trial", "release"];

let cachedClient: ClientInfo | null = null;

/** 请求头里的平台、版本、环境。一次会话内不变，量一次即可 */
export function clientInfo(): ClientInfo {
  if (cachedClient) return cachedClient;
  let platform: ClientPlatform = "devtools";
  let envVersion: EnvVersion = "develop";
  try {
    platform = PLATFORMS[Taro.getDeviceInfo().platform] ?? "devtools";
  } catch {
    // H5 或老基础库：按开发者工具算
  }
  try {
    const value = Taro.getAccountInfoSync().miniProgram.envVersion;
    if (ENV_VERSIONS.includes(value)) envVersion = value as EnvVersion;
  } catch {
    // 同上：按开发版算
  }
  cachedClient = { platform, version: __LYX_APP_VERSION__, envVersion };
  return cachedClient;
}

/** wx.login 取一次性的登录码 */
export async function loginCode(): Promise<string> {
  return (await Taro.login()).code;
}

/** 同步发起订阅授权。Taro 的类型把别的平台的字段也标成了必填，这里收窄到微信的 */
export function requestSubscribe(tmplIds: string[]): Promise<Record<string, unknown>> {
  return Taro.requestSubscribeMessage({ tmplIds } as unknown as Parameters<
    typeof Taro.requestSubscribeMessage
  >[0]) as unknown as Promise<Record<string, unknown>>;
}

interface PrivacyApi {
  getPrivacySetting?: (options: {
    success: (result: { needAuthorization: boolean }) => void;
    fail: (error: unknown) => void;
  }) => void;
  requirePrivacyAuthorize?: (options: {
    success: () => void;
    fail: (error: unknown) => void;
  }) => void;
}

/** 隐私授权的两个接口：基础库 2.32.3 起才有，没有时不给（封装据此放行） */
export function privacyApi(): {
  getPrivacySetting?: () => Promise<{ needAuthorization: boolean }>;
  requirePrivacyAuthorize?: () => Promise<void>;
} {
  const api = Taro as unknown as PrivacyApi;
  const { getPrivacySetting, requirePrivacyAuthorize } = api;
  if (!getPrivacySetting || !requirePrivacyAuthorize) return {};
  return {
    getPrivacySetting: () =>
      new Promise((resolve, reject) => getPrivacySetting({ success: resolve, fail: reject })),
    requirePrivacyAuthorize: () =>
      new Promise((resolve, reject) => requirePrivacyAuthorize({ success: resolve, fail: reject })),
  };
}

/** 回登录页。登录页还没建（W1-05）时这一跳会失败，不处理 */
export function gotoLogin(): void {
  void Taro.reLaunch({ url: "/pages/login/index" }).catch(() => undefined);
}
