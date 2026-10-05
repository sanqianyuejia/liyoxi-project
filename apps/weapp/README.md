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
| `pnpm weapp:shots -- --component Button` | 只出某个组件的预览图（整页），可给多次。不带参数时，页面之外另出组件陈列的目录页与每个组件各一张 `gallery__<组件名>.png` |
| `pnpm weapp:shots -- --sheet colors` | 只出某张基础样张的图（整页），可给多次：`colors`、`typography`、`spacing`、`status-tone`。不带参数时每张样张各出一张 `gallery__sheet-<样张名>.png` |
| `WEAPP_GALLERY=1 pnpm weapp:build` | 出带组件陈列分包的小程序包（看样用）。不给时生产包不带；H5 截图构建与 `dev` 一律带 |

构建用的环境变量（都可不给）：

| 变量 | 含义 | 缺省 |
| --- | --- | --- |
| `WEAPP_APPID` | 小程序 AppID，写进生成的 `project.config.json` | 测试号占位 `touristappid` |
| `WEAPP_API_BASE_URL` | 接口基址，不含 `/api/v1` | 空：请求以 `NOT_CONFIGURED` 结束，不发出去 |
| `WEAPP_VERSION` | 小程序版本号，随请求头 `X-Client-Version` 带出 | `0.1.0` |
| `WEAPP_SENTRY_DSN` | 错误上报的 DSN（公开部分，不是密钥） | 空：错误上报不发请求 |
| `WEAPP_GALLERY` | 组件陈列分包进不进构建：`1` 带，`0` 不带 | 不给：H5 与开发构建带，生产的小程序包不带 |

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
| `src/components/` 其余目录 | 通用组件，一个组件一个目录（W0-27b），见下面“通用组件” |
| `src/gallery.ts`、`src/sub/gallery/` | 组件陈列（开发用的分包）：登记、目录页、预览页、各组件的预览 |
| `src/lib/toast.ts`、`cx.ts`、`percent.ts` | 轻提示；拼类名；进度取整 |
| `src/styles/_mixins.scss` | 组件共用的 mixin：点击区补足到 44、单行省略 |
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

## 通用组件

依据：[规范](../../design/design-spec.md) 第 4、12 节。第一批由 W0-27b 交付；看样（W0-29）确认后冻结，页面包不改组件，要改、要加走单独的构件 PR。

```tsx
import { Button } from "@/components/Button";
import { merchantStatusByEnum, StatusTag } from "@/components/StatusTag";
```

| 分组 | 组件 |
| --- | --- |
| 基础 | `Icon` 图标；`PageBody` 内容区；`FooterBar` 底部操作栏；`NavBar` 自绘导航 |
| 按钮 | `Button`（主、次、主色描边、危险；特大 48、大 46、中 40、小 32；`loading`、`disabled`）；`PillButton` 胶囊小按钮；`TextButton` 文字按钮与文字链；`IconButton`；`AddButton` 虚线添加 |
| 标签与角标 | `StatusTag`（`tone`，`plain` 为纯文字状态）；`InfoTag`；`Badge`（数字角标、`dot` 红点） |
| 卡片与列表 | `Card`（`default`、`item`、`list`、`dark`、`subtle`）；`Section`；`List` 与 `ListRow`（菜单行、双行行）；`DescList` 键值网格 |
| 表单 | `Field`；`Input`；`TextArea`；`SelectEntry`；`SearchBar`；`Checkbox`（`shape="round"` 为单选）；`Switch`；`Chip` 选项胶囊；`OptionCard` |
| 页签、分段与筛选 | `Tabs` 下划线页签；`Segmented` 分段控件；`FilterChips` 筛选胶囊 |
| 提示与反馈 | `Note` 提示条；`Sheet` 底部弹层；`Empty` 空状态；轻提示用 `toast()`（`@/lib/toast`） |
| 步骤与进度 | `StepBar` 分段步骤条；`Timeline`（`progress` 进度时间轴、`record` 记录时间轴）；`ProgressBar` |
| 上传与其他 | `UploadGrid`（含上传中、上传失败）；`Avatar` 字形头像；`IconTile` 图标块；`Cover` 短剧封面 |
| 补充状态 | `Skeleton` 首次加载；`LoadError` 加载失败；`ListFooter` 触底加载。提交中是 `Button` 的 `loading`；按下态各可点的组件自带（不透明度 0.7） |

各组件的属性写在它 `index.tsx` 的类型注释里，用法照 `src/sub/gallery/previews/<组件名>.tsx`。写页面时守这几条：

| 事 | 做法 |
| --- | --- |
| 颜色 | 组件与页面都不写色值（`pnpm lint:colors`）。样式里用 `$lyx-*` 变量；图标的颜色跟随外层文字色 |
| 状态色 | 不自己挑：`merchantStatusByEnum("表.列", 取值)` 给出色调与商家端的叫法，再交给 `StatusTag`。对应关系只有一份，在 `@liyoxi/shared/design/status-tone` |
| 筛选与取值 | 筛选、切换视图用深色选中的 `FilterChips`、`Segmented`、`Tabs`；表单里取值用橙色选中的 `Chip`、`OptionCard` |
| 文案 | 组件不带业务文案，都由属性传。带了缺省文字的只有规范写明的几句：“重新加载”“加载中……”“没有更多了”“上传失败”“重试”“关闭”，也都能换 |
| 确认 | 商家端不设居中确认框，要确认的地方用 `Sheet`：放弃在左、确认在右，危险操作的确认键用 `variant="danger"` |
| 下拉刷新 | 用小程序原生的：页面配置里开 `enablePullDownRefresh`，不另做组件 |
| 尺寸 | 写在 `.scss` 里，不写行内 `style`。选择器里带 `nut-` 的规则不做单位转换（构建配置如此）：给 NutUI 的组件改尺寸，写在自己的类名上或用它的 `--nutui-*` 变量 |
| NutUI | 按组件的路径引（`@nutui/nutui-react-taro/dist/es/packages/<组件>`），不从包的根上引；样式在 `src/styles/nutui.ts` 登记 |

第一批没有的（用到的页面包之前走构件 PR 补）：会员等级胶囊、剧目宫格卡、金额明细行、统计格、积分包卡、序号步骤、文件行、广告视频预览、音频、对话气泡、结果页头、选择器弹出。

### 组件陈列

`src/sub/gallery/` 是开发用的分包：目录页 `sub/gallery/index/index` 列出全部组件，预览页 `sub/gallery/preview/index?name=<组件名>` 看一个组件的各种状态。它不是业务页面，不在页面清单里。生产的小程序包缺省不带它；`WEAPP_GALLERY=1 pnpm weapp:build` 出带它的包，在开发者工具里用编译模式打开目录页。

看样也用它（W0-29）：目录页照规范的章节先后分组，每组标着规范的节号与要对的要点，预览页顶上也有同样一段。除了组件，另有四张基础样张（颜色、文字、间距圆角与描边、状态取色表），预览页用 `?sheet=<样张名>` 打开，登记在 `src/gallery.ts` 的 `GALLERY_SHEETS`，内容在 `src/sub/gallery/sheets/`。分组的节号与要点在 `GALLERY_GROUP_SPEC`。业主怎么在开发者工具与真机上打开、逐项看什么，见[看样清单](../../docs/plan/sample-review/W0-29.md)。

新加组件：建 `src/components/<组件名>/`（`index.tsx`、`index.scss`），在 `src/gallery.ts` 加一行，写 `src/sub/gallery/previews/<组件名>.tsx` 并登记进同目录的 `index.ts`。少了哪一样，`src/gallery.test.ts` 或类型检查会指出来。

## 服务端调用还没接上

请求层与四个封装都写成不依赖小程序运行时的模块（接口在 `src/lib/platform.ts`，真实实现在 `platform.taro.ts`），服务端调用经 `src/lib/server.ts` 的 `connectServer({ … })` 接入。本包一个都没接，所以现在全部空转：订阅封装直接执行处理函数，埋点与错误上报不发请求，引导数据用代码里的保守默认值。接口落地的包接上自己那一个：

| 调用 | 接口 | 由谁接 |
| --- | --- | --- |
| `fetchBootstrap`、`silentLogin`、`reloadMe`、`askConsent`、`showUpdatePrompt` | `m.bootstrap.get`、`m.session.create`、`m.me.get`、协议同意 | W1-04、W1-05 |
| `reportSubscribeResult`、`sendAnalytics` | `m.subscribeResult.create`、`m.analyticsEvent.batchCreate` | G2-C |
| `sendClientError` | `m.clientError.create` | 该接口落地的包 |

## 截图与真机的差异

`pnpm weapp:shots` 截的是 Taro 的 H5 构建，是近似，不是小程序的渲染层：原生导航栏在 H5 下不出现（没有标题栏与胶囊），标签栏是 Taro 的 H5 仿制件，高度与字体都与微信不同；自绘导航取不到胶囊位置，用的是兜底值；H5 下页面底色没有铺满，内容区是白的。真机上的样子以微信开发者工具与手机为准。

组件预览的图同样是 H5 近似：原生的输入框、多行输入、开关、弹层在微信里的样子，以及点击区、按下态、弹层正文的内部滚动，以真机为准（W0-29 看样时看）。
