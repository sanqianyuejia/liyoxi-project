# apps/weapp：商家端小程序

Taro 4.2.1（Vite 编译器）+ React 18 + NutUI React Taro。依据：[D7](../../docs/appendix/design/d7-platform.md) 第 3、4 节；[约定](../../docs/api/00-conventions.md) C3、C17–C23、C48；[规范](../../design/design-spec.md) 第 4 节。工程与请求层由 W0-27a 交付，之后的页面包只填页面。

## 命令

在仓库根目录跑。都不读 `.env`，要改的值在命令前给环境变量。

| 命令 | 做什么 |
| --- | --- |
| `pnpm weapp:build` | 出小程序包 `apps/weapp/dist/`，由模板生成 `project.config.json`，再过体积门禁（主包 ≤1,500KB、分包 ≤800KB）。超限即失败 |
| `pnpm --filter @liyoxi/weapp dev` | 开发：改了就重新构建（不压缩，不过体积门禁） |
| `pnpm --filter @liyoxi/weapp test` | 请求层、四个端上封装、页面清单的用例（Node 环境）。只跑一个文件：后面加 `src/lib/request.test.ts` |
| `pnpm weapp:shots` | 给已建的页各出一张截图到 `apps/weapp/shots/dist/png/`（宽 375）。只出一页：`pnpm weapp:shots -- --page pages/home/index`；本机没装 Playwright 自带的 Chromium 时前面加 `LYX_E2E_CHANNEL=chrome` |
| `node apps/weapp/scripts/build-tabbar-icons.mjs` | 重新导出标签栏的 8 张图标（改图标或改颜色时才跑，产物入库） |

构建用的环境变量（都可不给）：

| 变量 | 含义 | 缺省 |
| --- | --- | --- |
| `WEAPP_APPID` | 小程序 AppID，写进生成的 `project.config.json` | 测试号占位 `touristappid` |
| `WEAPP_API_BASE_URL` | 接口基址，不含 `/api/v1` | 空：请求以 `NOT_CONFIGURED` 结束，不发出去 |
| `WEAPP_VERSION` | 小程序版本号，随请求头 `X-Client-Version` 带出 | `0.1.0` |
| `WEAPP_SENTRY_DSN` | 错误上报的 DSN（公开部分，不是密钥） | 空：错误上报不发请求 |

用微信开发者工具看：先 `pnpm weapp:build`，再导入 `apps/weapp` 目录（`project.config.json` 是生成物，不入库，不手改 appid）。

## 目录

| 路径 | 内容 |
| --- | --- |
| `config/index.ts` | Taro 构建配置：`designWidth` 375，样式文件里的 px 照原型原样写；每个 `.scss` 自动可用 `$lyx-*` 变量 |
| `src/pages.ts` | 页面清单：49 个路由一行一条。全局配置的页面、分包、预下载由它拼出；`docs/plan/pages.md` 的小程序部分由它生成 |
| `src/app.config.ts`、`src/app.ts`、`src/app.scss` | 全局配置（原生标签栏、隐私总开关、超时）、入口、全局样式 |
| `src/lib/` | 请求层与四个端上封装，见下 |
| `src/stores/` | `session`（令牌与用户概要）、`context`（当前门店）、`bootstrap`（引导数据）；一个 store 一个文件 |
| `src/components/NavBar/` | 自绘导航栏，只给首页与登录页用；其余页面用原生导航栏 |
| `src/styles/nutui.ts` | NutUI 组件样式的唯一入口（只留 7 个组件） |
| `scripts/` | 构建、截图、截图的受影响范围、标签栏图标 |

## 页面里怎么用

```ts
import { captureError, newIdempotencyKey, request, track, withPrivacy, withSubscribe } from "@/lib/runtime";
```

| 要做的事 | 写法 |
| --- | --- |
| 调接口 | `request<T>("/m/…", { method, data, idempotencyKey })`。门店头、令牌、请求编号、超时与重试、401 后静默登录并重放都在请求层里；页面只按 `ApiError.error`（符号名）判断 |
| 幂等键 | 进入确认页或打开确认弹层时 `newIdempotencyKey("orderSubmit")` 生成一次，存在页面状态里；这次意图下的重试都用它，改了内容换新的 |
| 订阅授权 | `onClick={withSubscribe("order_submit", handler)}`。点位取契约的常量；没有可请求的模板时直接执行处理函数 |
| 隐私接口 | `const result = await withPrivacy(() => Taro.chooseMedia(…))`；`result.ok` 为假是用户没同意隐私指引 |
| 埋点 | `track("mall_view", { mode: "list" })`。事件名与属性取契约登记，写错了类型检查过不去 |
| 报错误 | 全局错误自动收集；页面里接住、但值得知道的，用 `captureError("handler", error)` |

新加页面：建 `src/pages/<页>/` 或 `src/sub/<分包>/<页>/` 下的 `index.tsx`、`index.config.ts`，把 `src/pages.ts` 里那一行的 `implemented` 改成 `true`（占位页同时去掉 `placeholder`），再跑 `node infra/ci/pages/generate.mjs`。

## 服务端调用还没接上

请求层与四个封装都写成不依赖小程序运行时的模块（接口在 `src/lib/platform.ts`，真实实现在 `platform.taro.ts`），服务端调用经 `src/lib/server.ts` 的 `connectServer({ … })` 接入。本包一个都没接，所以现在全部空转：订阅封装直接执行处理函数，埋点与错误上报不发请求，引导数据用代码里的保守默认值。接口落地的包接上自己那一个：

| 调用 | 接口 | 由谁接 |
| --- | --- | --- |
| `fetchBootstrap`、`silentLogin`、`reloadMe`、`askConsent`、`showUpdatePrompt` | `m.bootstrap.get`、`m.session.create`、`m.me.get`、协议同意 | W1-04、W1-05 |
| `reportSubscribeResult`、`sendAnalytics` | `m.subscribeResult.create`、`m.analyticsEvent.batchCreate` | G2-C |
| `sendClientError` | `m.clientError.create` | 该接口落地的包 |

## 截图与真机的差异

`pnpm weapp:shots` 截的是 Taro 的 H5 构建，是近似，不是小程序的渲染层：原生导航栏在 H5 下不出现（没有标题栏与胶囊），标签栏是 Taro 的 H5 仿制件，高度与字体都与微信不同；自绘导航取不到胶囊位置，用的是兜底值；H5 下页面底色没有铺满，内容区是白的。真机上的样子以微信开发者工具与手机为准。
