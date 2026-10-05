// 运行时装配：把请求层与四个端上封装接到 Taro 与各个 store 上，页面从这里取用。
//   import { request, withSubscribe, withPrivacy, track, captureError } from "@/lib/runtime";
// 中间件一样的先后只在这里定：页面包只用导出的函数，不自己再建一套。
// 服务端调用没接上（lib/server.ts）时全部空转：请求以 NOT_CONFIGURED 或原错误结束，订阅封装直接执行处理函数，
// 埋点与错误上报不发请求。
import Taro from "@tarojs/taro";

import { createErrorReporter } from "./errors";
import { bindPersistence } from "./persist";
import { systemClock, uuid } from "./platform";
import * as platform from "./platform.taro";
import { createPrivacy } from "./privacy";
import { createRequestLayer, newIdempotencyKey as buildIdempotencyKey } from "./request";
import { serverCall } from "./server";
import { createSubscribe } from "./subscribe";
import { createTracker } from "./track";
import { bootstrapStale, flagOn, useBootstrapStore } from "../stores/bootstrap";
import { useContextStore } from "../stores/context";
import { useSessionStore } from "../stores/session";

const getToken = () => useSessionStore.getState().accessToken;
const getStoreId = () => useContextStore.getState().currentStoreId;
let launchScene: number | undefined;

/** 取引导数据：接口没接上或失败时保持现状（上次的缓存，再没有就是代码里的保守默认值） */
async function loadBootstrap(): Promise<void> {
  const fetchBootstrap = serverCall("fetchBootstrap");
  if (!fetchBootstrap) return;
  try {
    useBootstrapStore.getState().apply(await fetchBootstrap(), systemClock.now());
  } catch {
    // 用缓存或默认值
  }
}

const layer = createRequestLayer({
  baseUrl: __LYX_API_BASE_URL__,
  send: platform.send,
  clock: systemClock,
  uuid,
  client: platform.clientInfo,
  getToken,
  getStoreId,
  recover: {
    silentLogin: async () => {
      const silentLogin = serverCall("silentLogin");
      if (!silentLogin) return "failed";
      return silentLogin(await platform.loginCode());
    },
    clearSession: () => {
      useSessionStore.getState().clear();
      useContextStore.getState().clear();
    },
    gotoLogin: platform.gotoLogin,
    reloadMe: async () => serverCall("reloadMe")?.(),
    askConsent: async (details) => (await serverCall("askConsent")?.(details)) ?? false,
    showUpdatePrompt: async () => serverCall("showUpdatePrompt")?.(),
    reloadBootstrap: loadBootstrap,
  },
});

const reporter = createErrorReporter({
  clock: systemClock,
  uuid,
  dsn: __LYX_SENTRY_DSN__,
  sender: () => serverCall("sendClientError"),
  client: platform.clientInfo,
  // 用户概要的结构等契约里有了再取 id（W1-04）；在那之前不带用户
  getUserId: () => null,
});

const subscribe = createSubscribe({
  requestSubscribe: platform.requestSubscribe,
  getPlan: () => {
    const { data } = useBootstrapStore.getState();
    return {
      enabled: flagOn("notify.wx.enabled"),
      plan: data.subscribePlan,
      maxPerAsk: data.subscribeMaxPerAsk,
      cooldownDays: data.subscribeCooldownDays,
    };
  },
  storage: platform.storage,
  clock: systemClock,
  uuid,
  report: () => serverCall("reportSubscribeResult"),
  afterReport: () => void loadBootstrap(),
  onHandlerError: (error) => reporter.capture("handler", error),
});

const privacy = createPrivacy(platform.privacyApi());

const tracker = createTracker({
  storage: platform.storage,
  clock: systemClock,
  uuid,
  enabled: () => flagOn("analytics.ingest.enabled"),
  sender: () => serverCall("sendAnalytics"),
  client: () => {
    const client = platform.clientInfo();
    return { version: client.version, platform: client.platform, scene: launchScene };
  },
  getStoreId,
  schedule: (run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  },
});

/** 发业务请求。path 写 /m/… 即可，/api/v1 由请求层补 */
export const request = layer.request;
/** 生成幂等键 `<动作名>:<uuid>`：进入确认页或打开确认弹层时调一次，该意图下的重试都用它 */
export const newIdempotencyKey = (action: string) => buildIdempotencyKey(action, uuid);
/** 在按钮的点击处理上顺带请求订阅授权：onClick={withSubscribe(点位, 处理函数)} */
export const withSubscribe = subscribe.withSubscribe;
/** 调隐私接口前先过隐私授权 */
export const ensurePrivacyAuthorized = privacy.ensurePrivacyAuthorized;
export const withPrivacy = privacy.withPrivacy;
/** 记一条端上埋点。事件名与属性取自契约登记 */
export const track = tracker.track;
/** 报一条错误（页面里接住、但值得知道的） */
export const captureError = reporter.capture;

/** 小程序启动时调一次（src/app.ts）：放回本地存的状态，挂全局错误钩子，取引导数据 */
export function startApp(options: { scene?: number } | undefined): void {
  launchScene = typeof options?.scene === "number" ? options.scene : undefined;
  bindPersistence(platform.storage);

  // 这几个钩子 H5 下没有，逐个判断
  Taro.onError?.((error) => reporter.capture("error", error));
  Taro.onUnhandledRejection?.((result) => reporter.capture("unhandledrejection", result.reason));
  Taro.onPageNotFound?.((result) =>
    reporter.capture("page_not_found", new Error("page not found"), { page: result.path }),
  );
  // 切到后台：把攒着的埋点报掉。回到前台：引导数据过了 5 分钟就刷新
  Taro.onAppHide?.(() => void tracker.flush());
  Taro.onAppShow?.(() => {
    if (bootstrapStale(systemClock.now())) void loadBootstrap();
  });

  void loadBootstrap();
}
