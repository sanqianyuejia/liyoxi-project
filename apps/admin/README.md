# apps/admin：运营管理后台

React 19 + Vite 8 + Ant Design 6 的纯单页应用，与接口同源（[D7](../../docs/appendix/design/d7-platform.md) 第 5 节）。本目录现在是骨架（W0-28）：外壳、菜单登记表、路由守卫、请求客户端、三种页面骨架、确认与上传两个构件。之后的页面包只填“查询、列定义、详情内容、动作”。界面依据是[设计规范](../../design/design-spec.md)（下称“规范”）第 5 节。

## 命令

在仓库根目录跑。

| 命令 | 做什么 |
| --- | --- |
| `pnpm --filter @liyoxi/admin dev` | 本地开发，端口 5183。带样例页与夹具；样例接口由开发服务器自己应答，不用起 api。设了 `LYX_API_ORIGIN` 时把 `/api` 转给它 |
| `pnpm --filter @liyoxi/admin test` | 单测（Vitest，Node 环境）。配置就在 `vite.config.ts` 里，与构建共用一份 |
| `pnpm admin:build` | 生产构建到 `apps/admin/dist/app`，随后跑 `scripts/check-build.mjs`：文件名带内容哈希、写入了构建号、不含夹具 |
| `pnpm admin:e2e` | 冒烟：先出一份带样例页的构建（`dist/e2e-app`），起它的预览，Playwright 走一条用例。截图在 `dist/e2e-shots`，失败现场在 `dist/e2e-results` |
| `node infra/ci/pages/generate.mjs`（加 `--check` 只比对） | 由菜单登记表重新生成 `docs/plan/pages.md` 的后台部分 |

冒烟缺省用 Playwright 自带的 Chromium：第一次跑先 `pnpm --filter @liyoxi/admin exec playwright install chromium`。本机不想下载时用已装的 Chrome：`LYX_E2E_CHANNEL=chrome pnpm admin:e2e`。

三种构建模式（`vite.config.ts` 开头）：`production` 不含样例页与夹具；`e2e` 与开发、测试都带。构建号取环境变量 `LYX_BUILD`，没有时取 git 提交的短哈希；它写进 `index.html` 的 `<meta name="lyx-build">`、代码里的 `__LYX_BUILD__` 与产物根目录的 `build.json`，随请求头 `X-Client-Version` 带出。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/lib/menu.ts`、`src/lib/menu/` | 菜单登记表：菜单、面包屑、路由守卫、角标的唯一来源。一个模块一个登记文件，`_base.ts` 是不属于任何模块的页面 |
| `src/lib/permissions.ts`、`guard.ts` | 模块等级、权限点、开关的判断；路由守卫 `requireModule` |
| `src/lib/api.ts`、`api-errors.ts`、`idempotency.ts` | 请求客户端：统一请求头、幂等键、按错误符号名的统一处置 |
| `src/lib/query.ts` | 查询缓存策略（列表、队列、详情、字典各一组选项） |
| `src/lib/table-search.ts`、`queue.ts`、`upload.ts` | 三种骨架与上传构件背后的纯函数：地址参数的读写、选中逻辑、上传校验与状态机 |
| `src/components/` | 外壳 `AppShell`；骨架 `QueryTablePage`、`QueueWorkbench`、`DetailPage`；构件 `ConfirmAction`、`UploadField`；它们用到的小构件（`PageHeader`、`Tabs`、`SimplePager`、`StatusTag`、`CheckList`、`InfoList`、`Icon`、三态块） |
| `src/theme/` | `antd.ts` 组件级主题覆盖，另有 ConfigProvider 上主题之外的组件级配置 `adminComponentConfig`（弹窗居中、抽屉的缺省宽度、表单不显示必填星号等）；`css-vars.ts` 把设计变量铺成 CSS 自定义属性；`global.css` 全部样式 |
| `src/app/` | 应用外层：主题与中文文案、查询缓存、请求客户端的单例、全局反馈 |
| `src/routes/` | 路由。`modules/` 下每个模块一个路由清单；`_dev/` 是样例路由；`registered.tsx` 接住登记了但还没实现的页面 |
| `src/dev/` | 样例页与夹具，只进开发与测试构建。样例页四个：`/dev/table`（筛选表格）、`/dev/queue`（审核工作台）、`/dev/detail/st-01`（详情页）、`/dev/rows`（整行可点的表格，带抽屉与分段控件） |
| `test/e2e/` | Playwright 冒烟 |
| `scripts/` | `check-build.mjs` 构建产物检查（下载页共用）；`e2e-affected.mjs` 冒烟的受影响范围判断 |

## 颜色与样式

页面不写色值（`pnpm lint:colors` 会拦）。三个出处：

| 场合 | 从哪取 |
| --- | --- |
| Ant Design 组件 | 主题：全局取 `@liyoxi/shared/design/antd-theme`，组件级覆盖在 `src/theme/antd.ts` |
| 自己写的样式 | `src/theme/global.css` 里用 `var(--lyx-<组>-<名>)`，变量名与 `design/tokens.json` 的第二、三层键相同；启动时由 `css-vars.ts` 从 `@liyoxi/shared/design/tokens` 铺出 |
| 状态标签 | `StatusTag` 的 `tone` 取状态色调字典（`@liyoxi/shared/design/status-tone`） |

没有用 `@liyoxi/shared/design/admin.scss`：那要装 `sass`，不在本包允许新增的依赖里。要用带透明度或调亮调暗的颜色，先让它进 `design/tokens.json`。

## 页面里直接用的几样

规范写明了数值、页面不用再自己调的（都在 `src/theme/` 里做好了，冒烟里有断言）：

| 要什么 | 怎么写 |
| --- | --- |
| 表格行高：单行 44、双行 56 | 双行单元格用 `.lyx-cell-2`（主行 `.lyx-cell-2__main`、副行 `.lyx-cell-2__sub`）。一行里有双行单元格就是 56，否则 44，不用另外声明。行里放高 32 的行内按钮（`size="small"`）不会把行撑高 |
| 按钮三档 | 页头与筛选条用缺省大小（高 36）；弹窗底部与详情操作用 `size="large"`（高 40）；表格行内用 `size="small"`（高 32）。圆角前两档 8、行内 6 |
| 危险描边按钮（驳回、禁用账号一类） | `<Button danger>`；工作台的驳回由骨架按 `kind: "reject"` 出 |
| 文字按钮（“重置筛选”一类）、表格里的文字链 | `<Button type="link">`；`<a className="lyx-link">`（危险操作加 `lyx-link--danger`）。悬停只加下划线，不变色 |
| 操作成功的提示 | `showSuccessNotice("……已……")`（`src/app/feedback.ts`）：右上角，带对勾，4 秒后消失，读屏按状态播报。构件不直接引它：工作台骨架要页面传 `notifySuccess={showSuccessNotice}` |
| 操作失败的提示 | 不用自己弹：请求层按错误符号名统一弹（红色感叹号，不自动消失，同一句话只留一条）。表单校验、确认不一致这两类不弹，由表单与确认构件就地显示 |
| 弹窗 | antd 的 `Modal`：两个方向居中、内边距 24、关闭按钮 32 × 32 都已套好（居中是全局给的，不用每个弹窗写 `centered`）。内容比窗口还高时由遮罩那一层滚动，上下各留 24。标题下面的说明放在内容最前面，用 `.lyx-confirm__desc` 的写法（紧跟标题、右侧让出关闭按钮） |
| 弹窗的页脚 | 一律自己摆，不用 antd 的缺省页脚，也不用 `modal.confirm` 这类静态确认框：缺省页脚的按钮高 36、两键间距 8、离内容 12，不是规范的 40、10、16，主题这一层没有套（状态文件“偏差”，等业主定）。写法照 `ConfirmAction`：`footer={null}`，内容最后放 `.lyx-confirm__footer`（右对齐、间距 10，取消在左、确认在右），按钮用 `size="large"`。要二次确认的直接用 `ConfirmAction` |
| 抽屉 | antd 的 `Drawer`：右侧、宽 480、内边距 24、阴影都已套好；头部照原型是标题在左、关闭按钮（32 × 32）在右，没有分隔线。宽度是全局给的缺省值，页面自己传了 `size` 的按页面的 |
| 表单 | antd 的 `Form`，纵向布局：标签 13px / 600、与控件间距 6、字段间距 14、不显示必填星号（选填项在标签后写“（选填）”）、错误提示 12px、提交有错时滚到第一个出错的字段（不在视野里才滚，落在视口中间，标签与错误提示一起看得见），都已套好。输入框、下拉、数值输入、日期与日期范围选择器高 36、13px、左右内边距 10（小号的下拉沿用 antd 的紧凑内边距，规范没写这一档）；多行输入内边距 8px 10px、行高 1.6。校验错误的警示播报（`role="alert"`）antd 的表单没有给，见状态文件“偏差” |
| 日期范围选择器的键盘 | 样子已经套好，键盘要用到它的页面包自己核：在 Playwright 驱动的无头 Chrome 里，Tab 走进它的第一个输入之后再按 Tab 出不来（不带主题的裸 antd 6.6.5 也一样，不是主题带来的；有头的浏览器里没有试）。第一个用到它的页面包在真实浏览器里把“Tab 进、Tab 出、Esc 关浮层”核一遍，结果写进自己的 PR |
| 开关、分段控件、复选框、单选框 | 直接用 antd 的：开关 36 × 20（开是绿色）、分段控件项高 30、复选框与单选框 16 × 16，都已套好。核对清单里的绿色复选框用 `CheckList` |
| 键盘聚焦 | 输入框、下拉是“描边变主色加浅色光晕”，其余可点的东西是主色聚焦环，都不用页面管：antd 的按钮、关闭键、清除键、复选框、单选框、开关、分段控件与侧栏菜单已经换成主色环；自己写的可点元素挂 `.lyx-focusable`，文字链 `.lyx-link` 自带。分段控件用 Tab 走有两站（先是容器自己，再按一下进到里面的项，之后用方向键换项），两站的环都画在整条轨道上。用键盘打开弹窗时焦点直接落在它的关闭键上（主色环）；用键盘打开抽屉时焦点先落在整个抽屉这一层上，那是容器不是控件，不画环，再按一下 Tab 到关闭键。antd 别的控件（`Tabs`、`Pagination`、`Dropdown`、`Tree`、`Collapse`、`Steps` 等）本包没有用到、没有套，用到的包走构件 PR 照 `global.css` 开头那一段补 |
| 整行可点的表格 | `QueryTablePage` 的 `onRowClick`：鼠标点行里的空白或文字，或 Tab 到这一行后按回车。行里另有链接、按钮、输入类控件（含 antd 的下拉、日期选择器、分段控件）时各管各的：点它们、或焦点在它们上面按回车，只做它们自己的事，不触发整行的动作；从行里弹出去的浮层、弹窗里的点击也不算这一行的。行里自己写的可点元素照规范 第 10 节用 `button` 或 `a`，不要给 `span`、`div` 绑点击，否则会被算成点了这一行。样例页 `/dev/rows`，冒烟里有断言 |
| 页签、分页、面包屑 | 用本目录的 `Tabs`、`SimplePager`（三种骨架里已经带了）与外壳自带的面包屑，不用 antd 的 `Tabs`、`Pagination`、`Breadcrumb`；主题里也没有给这三个组件留配置，直接用会是 antd 的缺省样子 |
| 面板里的标题 | `.lyx-section-title`，按标题的级别取字号：`h2` 是卡片这一级的标题（页签面板里的“基础信息”一类），15px / 600；`h3` 是卡片内的分区标题（“核对清单”一类），14px / 600 |
| 数字 | 不用管：等宽数字（`tabular-nums`）加在 `body` 上，全站继承，弹窗、抽屉、通知、下拉浮层里也是。`.lyx-num` 不用再挂（留着只为个别被别的样式重置掉的地方） |
| 卡片 | 自己的区块用 `.lyx-card`（圆角 12、1px 描边、无阴影、无内边距，内边距由里面的块给）；antd 的 `Card` 也套了（内边距 16、标题 15px） |
| 空状态的文案 | 没有数据写“暂无……”（骨架的 `empty.title`）；筛选无结果由骨架自己出“没有符合条件的……” |
| 页面装不下时怎么滚 | 滚的是整个内容区（规范 第 5.1 节），页面不用管：内容区的直接子项按自己的内容高度排、不被压缩（外壳的样式定的），表格行多了页签、筛选条、表格、分页条一起滚。页面里不要再套整页的纵向滚动容器；确实要“占满剩余高度、内部自己滚”的区块（如对话区），在自己的类上写 `flex` 与 `min-height`。冒烟里有只用鼠标滚轮滚到底的断言 |
| 提示条（`Alert`） | 不用自己设：按类型取色调的文字色（成功、进行中、待处理、错误），底是同一色调的浅底；圆角 8、无描边、默认无图标。只用单行的（给 `title`）：带 `description` 的那一种是 antd 的另一套规格（内边距 20px 24px、标题 16px），规范没有这一种，本包没有套，不要用。规范里的“中性款”antd 没有对应的类型，本包没有做 |

## 权限与守卫

权限只影响显示什么，接口每次请求即时鉴权（D7 第 5.4 节）。数据经一个可替换的来源读取（`AppServices.setAccessSource`）：现在只有夹具实现（`src/dev/fixture-access.ts`，只进开发与测试构建），真实来源 `GET /admin/auth/me` 由 W1-02 接上。生产构建在那之前没有权限数据，打开只有“请先登录”。

看样时可在浏览器控制台切换夹具：`localStorage["lyx.dev.role"] = "service"` 换成客服的权限；`localStorage["lyx.dev.releases"] = "release.partner"` 打开 V1.1 的菜单。

## 加一个页面

1. 在 `src/lib/menu/<模块>.ts` 找到这一页的登记，把 `implemented` 改成 `true`（无画板页另把 `inMenu`、`path` 定下来），跑 `node infra/ci/pages/generate.mjs` 并提交 `docs/plan/pages.md`。
2. 路由文件放 `src/routes/<模块>/`，一个画板一个文件。守卫与地址参数写在路由上：

   ```tsx
   export const merchantListRoute = createRoute({
     getParentRoute: () => rootRoute,
     path: "/merchants",
     validateSearch: (raw: Record<string, unknown>) => raw,
     beforeLoad: ({ context }) => requireModule(context.access, "merchant", "v"),
     component: MerchantListPage,
   });
   ```

3. 在 `src/routes/modules/<模块>.ts` 的清单里加上这条路由。只动自己模块的清单。
4. 页面私有的组件与查询封装放 `src/features/<模块>/`（D7 第 5.1 节）。取数用 `services.api.client`，查询选项取 `src/lib/query.ts` 里对应的一组。
5. 页面用哪种骨架见 D7 第 5.2 节的“骨架”列。三种骨架都是受控的：状态从地址来、改动写回地址，写法照 `src/dev/` 下三种骨架各自的样例页。主从页、配置页、图表在 G2-0 的构件包。

通用构件与页面骨架看样确认后冻结；页面包要改构件，走单独的构件 PR（计划 第 9.3 节）。

## 已知的限度

- 路由树是手写装配的（`src/routes/tree.ts`），没有用 `@tanstack/router-plugin` 的文件路由生成：装上它会把锁文件里已有依赖的解析版本带着变，属“放松”类门禁改动，要走单独的依赖 PR。目录约定已照文件路由来，换过去时只动装配（[状态文件](../../docs/plan/status/W0-28.md)“偏差”）。
- 单测不装 DOM 测试库：结构用 `react-dom/server` 渲染后断言，交互留给 Playwright（任务书 第 11 节第 2 项）。
- 登录、动态口令、再验证弹层、用户菜单、403 与 404 的真实页面在 W1-02；这里的 403、404 是占位。再验证接上之前，收到 `STEP_UP_REQUIRED` 一律按没通过处理。
- 全局搜索与通知入口不显示（规范 第 14 节第 12 项）；V1.1 的 13 个菜单只登记、默认不显示。
- 表格行高的两档靠 CSS 的 `:has()` 选择器判断一行里有没有双行单元格（Chrome 105、Safari 15.4、Firefox 121 起支持）；更老的浏览器里双行的行会落到 44 那一档，不到 56。复选框、单选框、分段控件的键盘聚焦环同样靠 `:has()`。
- 衬线字体（页面标题、品牌字）没有带字体文件，按字体栈回落到系统的宋体；antd 控件内部自带的图标（下拉箭头、清除键、排序箭头、关闭“×”等）还是它自己的。两件都在状态文件“偏差”里，等业主定。
- 还有几样只量了、没有改，同样在状态文件“偏差”里等业主定：antd 弹窗的缺省页脚（见上面“弹窗的页脚”）；分段控件选中的那一项带 antd 缺省的浅阴影（规范与原型都没有）；上传区里的图标是 16px、线宽 1.8（规范说 16px 及以下用 2；图标集里这个图标就是 1.8，图标集不在本包改）。
- D7 第 5.4 节的 `Can`、`useCan`、`useModuleLevel`，第 5.3 节 `QueryTablePage` 的列脱敏声明（`mask`）与 `validateSearch` 复用契约里的查询结构，本包没有做：现在页面用 `hasModuleLevel`、`canAction` 的结果决定渲染什么（样例页的写法）。归属见状态文件“往后移交”。
