# apps/admin：运营管理后台

React 19 + Vite 8 + Ant Design 6 的纯单页应用，与接口同源（[D7](../../docs/appendix/design/d7-platform.md) 第 5 节）。本目录现在是骨架（W0-28）：外壳、菜单登记表、路由守卫、请求客户端、三种页面骨架、确认与上传两个构件。之后的页面包只填“查询、列定义、详情内容、动作”。界面依据是[设计规范](../../design/design-spec.md)（下称“规范”）第 5 节。

## 命令

在仓库根目录跑。

| 命令 | 做什么 |
| --- | --- |
| `pnpm --filter @liyoxi/admin dev` | 本地开发，端口 5183。带样例页与夹具；样例接口由开发服务器自己应答，不用起 api。设了 `LYX_API_ORIGIN` 时把 `/api` 转给它 |
| `pnpm --filter @liyoxi/admin test` | 单测（Vitest，Node 环境）。配置就在 `vite.config.ts` 里，与构建共用一份 |
| `pnpm admin:build` | 生产构建到 `apps/admin/dist/app`，随后跑 `scripts/check-build.mjs`：文件名带内容哈希、写入了构建号、不含夹具 |
| `pnpm admin:e2e` | 冒烟：带样例页构建（`dist/e2e-app`），验证外壳、陈列页与鉴权样例。截图在 `dist/e2e-shots`，失败现场在 `dist/e2e-results` |
| `pnpm admin:e2e:live` | 真实 API + 生产后台：独立测试库与假密钥，激活、绑定、恢复码登录与登录态复用，员工筛选分页、新增及一次性激活码；截图在 `dist/e2e-shots`，失败 trace 在 `dist/e2e-live-results` |
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
| `src/dev/` | 样例页与夹具，只进开发与测试构建。样例页五个：`/dev/table`（筛选表格）、`/dev/queue`（审核工作台）、`/dev/detail/st-01`（详情页）、`/dev/rows`（整行可点的表格，带抽屉与分段控件）、`/dev/form`（一张比一屏长的表单，用的是 antd 的卡片与表单） |
| `src/dev/showcase/` | 陈列页（看样页，W0-29）`/dev/showcase`：构件、设计变量、状态取色、图标照规范的章节逐组摆出来。同样只进开发与测试构建，见下面“陈列页” |
| `test/e2e/` | Playwright 冒烟：`smoke.spec.ts` 走外壳与三种骨架，`showcase.spec.ts` 打开陈列页逐组截图 |
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
| 表单 | antd 的 `Form`，纵向布局：标签 13px / 600、标签文字到控件 6、字段间距 14、不显示必填星号（选填项在标签后写“（选填）”）、错误提示与字段下方的辅助说明 12px、提交有错时滚到第一个出错的字段（不在视野里才滚，落在内容区中间，标签与错误提示一起看得见），都已套好。样例页 `/dev/form`，冒烟里有断言。输入框、下拉、数值输入、日期与日期范围选择器高 36、13px、左右内边距 10（小号的下拉沿用 antd 的紧凑内边距，规范没写这一档）；多行输入内边距 8px 10px、行高 1.6。校验错误的警示播报（`role="alert"`）antd 的表单没有给，见状态文件“偏差” |
| 日期范围选择器的键盘 | W2-02 在有头 Chrome 复现原 AntD6.6.5 的空值 Tab 焦点锁。`DateRangeField` 保留原 RangePicker props/日期校验，在空字段 Tab 时收口原焦点锁并保留浏览器顺序遍历；非空值走原确认逻辑。样例 `/dev/config`，浏览器覆盖 Tab/Shift+Tab 进出、Esc关闭、手输范围与不误提交；未升级 AntD 或改全局键盘事件 |
| 开关、分段控件、复选框、单选框 | 直接用 antd 的：开关 36 × 20（开是绿色）、分段控件项高 30（选中项只是白底，不带阴影）、复选框与单选框 16 × 16，都已套好。禁用的输入框、数值输入、下拉、日期选择器的描边与禁用按钮的描边同色（规范没写禁用的输入框，状态文件“偏差”）。核对清单里的绿色复选框用 `CheckList` |
| 键盘聚焦 | 输入框、下拉是“描边变主色加浅色光晕”，其余可点的东西是主色聚焦环，都不用页面管：antd 的按钮、关闭键、清除键、复选框、单选框、开关、分段控件与侧栏菜单已经换成主色环；自己写的可点元素挂 `.lyx-focusable`，文字链 `.lyx-link` 自带。分段控件用 Tab 走有两站（先是容器自己，再按一下进到里面的项，之后用方向键换项），两站的环都画在整条轨道上。用键盘打开弹窗时焦点直接落在它的关闭键上（主色环）；用键盘打开抽屉时焦点先落在整个抽屉这一层上，那是容器不是控件，不画环，再按一下 Tab 到关闭键。antd 别的控件（`Tabs`、`Pagination`、`Dropdown`、`Tree`、`Collapse`、`Steps` 等）本包没有用到、没有套，用到的包走构件 PR 照 `global.css` 开头那一段补 |
| 整行可点的表格 | `QueryTablePage` 的 `onRowClick`：鼠标点行里的空白或文字，或 Tab 到这一行后按回车。行里另有链接、按钮、输入类控件（含 antd 的下拉、日期选择器、分段控件）时各管各的：点它们、或焦点在它们上面按回车，只做它们自己的事，不触发整行的动作；从行里弹出去的浮层、弹窗里的点击也不算这一行的。行里自己写的可点元素照规范 第 10 节用 `button` 或 `a`，不要给 `span`、`div` 绑点击，否则会被算成点了这一行。样例页 `/dev/rows`，冒烟里有断言。现在有两样规范没写、没有处理的：在行里的文字上按住拖选再松开，会触发一次整行的动作（想复制单号时抽屉会弹出来）；双击会触发两次。等业主看样时定（状态文件“偏差”） |
| 页签、分页、面包屑 | 用本目录的 `Tabs`、`SimplePager`（三种骨架里已经带了）与外壳自带的面包屑，不用 antd 的 `Tabs`、`Pagination`、`Breadcrumb`；主题里也没有给这三个组件留配置，直接用会是 antd 的缺省样子 |
| 面板里的标题 | `.lyx-section-title`，按标题的级别取字号：`h2` 是卡片这一级的标题（页签面板里的“基础信息”一类），15px / 600；`h3` 是卡片内的分区标题（“核对清单”一类），14px / 600。侧栏信息卡的标题由详情页骨架出（14px / 600） |
| 行高 | 不用管：正文是 1.6，标题与双行单元格是 1.3（规范 第 2.3 节）。正文的 1.6 盖在 antd 的 `App` 这一层，页面里直接写的段落、说明、信息列表都继承得到；弹窗与卡片的内容区、抽屉、表格的单元格、写在表单里的说明、字段下方的错误提示与辅助说明同样是 1.6。骨架出的各级标题（页头、详情卡、分区标题两级、侧栏信息卡、空状态、整页说明）与 antd 的弹窗、抽屉、卡片的标题都是 1.3。自己另写标题类时加 `line-height: var(--lyx-line-height-title)`，别的地方不要另写行高。按钮、输入框、下拉、清单之外的复选框文字这些单行、定高的控件仍是 antd 的行高（规范给的是它们的高度），不用管 |
| 数字 | 不用管：等宽数字（`tabular-nums`）加在 `body` 上，文字都继承得到，弹窗、抽屉、通知、下拉浮层里也是。输入框、多行输入、按钮、下拉这些表单控件，浏览器给它们的缺省字体会把这个属性（连同字体）重置掉、继承不进去，`global.css` 里另写了一条让它们显式继承，所以输入框里填的数字、按钮上的数字、日期浮层头部的年月同样等宽、同样是界面字体。`.lyx-num` 不用再挂（留着只为个别被别的样式重置掉的地方） |
| 卡片 | 自己的区块用 `.lyx-card`（圆角 12、1px 描边、无阴影、无内边距，内边距由里面的块给）；antd 的 `Card` 也套了（内边距 16、标题 15px） |
| 空状态的文案 | 没有数据写“暂无……”（骨架的 `empty.title`）；筛选无结果由骨架自己出“没有符合条件的……” |
| 页面装不下时怎么滚 | 滚的是整个内容区（规范 第 5.1 节），页面不用管：内容区的直接子项按自己的内容高度排、不被压缩（外壳的样式定的），表格行多了页签、筛选条、表格、分页条一起滚。页面里不要再套整页的纵向滚动容器；确实要“占满剩余高度、内部自己滚”的区块（如对话区），在自己的类上写 `flex` 与 `min-height`。冒烟里有只用鼠标滚轮滚到底的断言 |
| 提示条（`Alert`） | 不用自己设：按类型取色调的文字色（成功、进行中、待处理、错误），底是同一色调的浅底；圆角 8、无描边、默认无图标。只用单行的（给 `title`）：带 `description` 的那一种是 antd 的另一套规格（内边距 20px 24px、标题 16px），规范没有这一种，本包没有套，不要用。规范里的“中性款”antd 没有对应的类型，本包没有做 |

## 陈列页（看样）

`/dev/showcase` 把外壳、骨架里的构件、主题套好的 Ant Design 控件，连同色板、字号、间距圆角阴影、状态取色表、全部图标，照规范的章节先后逐组摆出来；每组右上角是规范的节号，下面几行是看样时要对的要点。业主对着规范逐组看，结论填进[看样清单](../../docs/plan/sample-review/W0-29.md)。

| 怎么看 | 做法 |
| --- | --- |
| 本机打开 | `pnpm --filter @liyoxi/admin dev`，浏览器开 `http://localhost:5183/dev/showcase`。不用起 api；页面顶部的目录跳到各组，“五类页面”一组里有五个样例页的链接 |
| 只翻截图 | `pnpm admin:e2e` 之后看 `apps/admin/dist/e2e-shots/showcase-*.png`：`00` 是页面顶部，之后每组一张，`9x` 是弹窗、二次确认、抽屉、轻提示。CI 里是产物 `admin-e2e-shots` |
| 换角色、看 V1.1 的菜单 | 见下面“权限与守卫”里切换夹具的两行 |

分组登记在 `src/dev/showcase/sections.ts`（节号、标题、要点），内容在同目录的几个文件里；加一组要两处都加，少了类型检查过不去。陈列页只摆不改：构件有出入的记进看样清单，走单独的构件 PR。生产构建不带它（访问即“页面不存在”），预发上要看时部署 `e2e` 模式的产物，由环境包定。

## 权限与守卫

权限只影响显示什么，接口每次请求即时鉴权（D7 第 5.4 节）。数据经可替换来源读取（`AppServices.setAccessSource`），默认调用真实 `GET /api/v1/admin/auth/me`；开发与样例构建仍用 `src/dev/fixture-access.ts`。模块等级与权限键引契约，`Can`、`useCan`、`useModuleLevel` 在现有纯函数上只增封装。权限拒绝或开关失效会重取 loader 缓存并使路由重新检查；登录完成清缓存、放开登录跳转闩。生产构建打开登录页，四种 `AuthNext.next` 决定去向；票据只留内存，绑定确认使用接口续期票据，恢复码保存确认后进入后台。

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

通用构件与页面骨架在业主看样、提过意见并改完后冻结；页面包要改构件，走单独的构件 PR（计划 第 9.3 节）。

## React 的类型

仓库里装着两份 `@types/react`（小程序用 18，这里与下载页用 19）。antd 与 `@tanstack/*` 的类型里写 `import "react"`，自己却不声明 `@types/react`，不管的话 tsc 会到 pnpm 的提升目录里去找，那里放的是哪一份不保证，类型检查就时过时不过。预设 `packages/config/tsconfig/web-react19.json` 用 `compilerOptions.paths` 把 `react`、`react-dom` 的类型钉到了本应用自己装的那一份。

要在本目录的 `tsconfig.json` 里写 `paths`（比如加别名）时，把预设里那四行一并抄上：tsconfig 的 `paths` 不合并，自己一写就把预设里的整体顶掉了。忘了的话 `pnpm check:type-hoist` 会红。来历与口径见 [infra/ci/README.md](../../infra/ci/README.md) 第 7 节。

## 已知的限度

- 路由树是手写装配的（`src/routes/tree.ts`），没有用 `@tanstack/router-plugin` 的文件路由生成：装上它会把锁文件里已有依赖的解析版本带着变，属“放松”类门禁改动，要走单独的依赖 PR。目录约定已照文件路由来，换过去时只动装配（[状态文件](../../docs/plan/status/W0-28.md)“偏差”）。
- 单测不装 DOM 测试库：结构用 `react-dom/server` 渲染后断言，交互留给 Playwright（任务书 第 11 节第 2 项）。
- W1-02① 已接登录、激活、动态口令、绑定、再验证、用户菜单、403/404。并发请求共用一个再验证弹层，成功后沿用原幂等键重放；M1 用户菜单仅退出登录。员工页已接真实员工/角色查询与新增，manual 激活码只留当前弹层内存，关闭即清；行内操作及页头汇总等待 M2，修改密码与动态口令设置等待 M2。
- 全局搜索与通知入口不显示（规范 第 14 节第 12 项）；V1.1 的 13 个菜单只登记、默认不显示。
- 表格行高的两档靠 CSS 的 `:has()` 选择器判断一行里有没有双行单元格（Chrome 105、Safari 15.4、Firefox 121 起支持）；更老的浏览器里双行的行会落到 44 那一档，不到 56。复选框、单选框、分段控件的键盘聚焦环同样靠 `:has()`。
- 衬线字体（页面标题、品牌字）没有带字体文件，按字体栈回落到系统的宋体；antd 控件内部自带的图标（下拉箭头、清除键、排序箭头、关闭“×”等）还是它自己的。两件都在状态文件“偏差”里，等业主定。
- 还有几样只量了、没有改，同样在状态文件“偏差”里等业主定：antd 弹窗的缺省页脚（见上面“弹窗的页脚”）；antd 按钮点击后的水波动画没有关（规范没写点击的动效）；日期浮层里不属于本月的日期用的是禁用色（antd 的缺省）；上传区里的图标是 16px、线宽 1.8（规范说 16px 及以下用 2；图标集里这个图标就是 1.8，图标集不在本包改）。
- `QueryTablePage` 的 `mask` 只提示服务端已脱敏值，不能证明 DTO 安全或请求明文；`selectedRowKey` 加选中行和左侧色条。业务页只消费这些公开构件。

## W2-02 公共构件与查询

| 公口 | 受控边界与样例 |
| --- | --- |
| `MasterDetailPage` | `selectedKey/onSelect/list/detail/onRetry`；详情带取数 key，旧 key 响应显示加载而非串记录；默认右栏360px。`/dev/master-detail` 验选中 URL、后退/刷新和陈旧响应 |
| `ConfigPage` | `children/aside/readOnly/pending/canSubmit/onSubmit/error`；字段禁用与同步提交锁，领域给校验/版本/权限/幂等。保存按钮（或焦点在按钮时按Enter）才提交，日期 Enter 不隐式保存。`/dev/config` |
| `Chart` | 调用方给 `option/label/state/height/onRetry`，按需柱/折线/饼图，ResizeObserver/零尺寸延迟与dispose；图例/指标由调用方给出。`/dev/chart` |
| 单选控件 | `CapsuleRadio/ReasonChips/RadioCard` 的 `value/options/onChange/ariaLabel/disabled`；原生 radio 支持方向键/Tab，disabled 不回写。`/dev/shared-controls` |
| 月份与展示 | `MonthSwitcher` 的年月对象与范围；`ReadOnlyValue/NeutralNotice/EmphasisBlock/Stepper/LogList/DiffBlock` 只展示调用方事实，不推导领域进度/日志/差异。同上样例 |
| 既有比对/驳回 | `CompareTable` 的 `rows/ariaLabel` 与 `RejectDialog` 受控签名不变；提交等待期间不能Esc/关闭/取消/重复提交，不重做现有业务包装 |
| 查询适配 | `readContractQuery(schema, raw, options)` 返回分离的 `wire/parsed`；显式白名单、默认和恢复；审批 CSV 数组不重新传给输入 schema。已有表格10/20/50和队列100分页保持。员工/资质页消费公开 `/queries/admin`，id只属队列UI |

四个样例继续由 `__LYX_DEV_FIXTURES__` 控制，生产访问404且产物无夹具，不新增真实页/菜单/接口。`pnpm admin:e2e` 沿用 samples项目；定点命令 `LYX_E2E_CHANNEL=chrome pnpm --filter @liyoxi/admin exec playwright test test/e2e/w202-components.spec.ts --project=samples`；加`--headed`验有头日期键盘。

截图写入 `dist/e2e-shots/w202-{master-detail,config,chart,shared-controls}.png`。叶控件SSR/纯测试只证明结构与年月规则，实际方向键、只读、等待、尺寸与焦点由浏览器验收。

## 真实接口浏览器验收（运行入口）

显式提供本地 Compose 的公开测试连接参数（APP_ENV=test、DATABASE_URL、REDIS_URL），执行 `pnpm admin:e2e:live`；不读取 .env。正常 Node24，nightly 沿用仓库 Node26 兼容作业。CI 先安装 Chromium；本机可 `LYX_E2E_CHANNEL=chrome`。脚本为本轮生成严格配对的测试库与 Redis 前缀，seed 与 staff:bootstrap 后启动真实 API 构建产物和生产后台静态文件；/api 转发保留 Host/Origin 及端口。结束或中断后停止本轮子进程、精确清理数据库/Redis 与私有临时文件；失败时保留截图、trace 和 API 脱敏日志（dist/e2e-live-logs）。

后续页面包只在 `packages/services/src/testing/admin-live/` 新增 `<短名>.fixture.ts`，共享一个服务端进程的 `make`/`runtime`；前端调用已合并的 `admin:live:data` CLI，不导入数据库或 services。新增 `test/e2e/live-*.spec.ts`，用 `liveContext()` 读取返回的 fixtures；live 项目依赖一次登录准备并自动复用 storageState，无需改起栈脚本或 Playwright 配置。数据与登录态文件不入库。

员工真实用例 `live-staff.spec.ts` 使用 `staff.fixture.ts`：10 位假员工加 bootstrap 管理员覆盖角色、主管、待激活、待启用、禁用及10条分页；返回的 fixtures 经 `liveContext().fixtures` 读取服务端桥 JSON。三张截图为 `staff-01-list.png`、`staff-02-create.png`、`staff-03-activation.png`。同一事件循环触发两次表单提交，断言只发一个创建请求、真实查询只有一行；关闭后不再显示码，重新打开表单为空。

W1-19 PR1 的真实用例只追加本域登记：`z-order-ticket.fixture.ts` 在原 staff 之后复用“演练交付”员工走激活链，不增加原员工总量或改变角色/状态；工厂准备三种订单快照，真实 `createTickets` 建待分配工单，真实 `publish.bind` 建两条账号核验。仅将本轮既有 bootstrap 假管理员设为主管，满足实际指派守卫；另一非主管交付经理的独立会话按本人范围查看、不请求员工名单。账号五项人工核对后通过/原因驳回，静默30秒刷新保留当前输入；headless不能真实隐藏tab时，本测试页限定visibility getter+bubbling visibilitychange走实际focusManager，31秒隐藏零queue GET、恢复真实GET并保留输入，日志明确标为依赖探针。账号图片只对本轮 fileId 在两个既有假 Provider/公开本机存储 origin 的精确路径回演练字节，所有 /api 请求均走真实构建进程。四页及分配/驳回截图为 `orders-01-list`、`orders-02-detail`、`tickets-01-pool`、`tickets-02-assign`、`accounts-01-compare`、`accounts-02-reject`；1440×900 留图、1366×768 核横向溢出，保留旧激活登录、资质/员工/收款全部用例。

W1-19 PR2 的 `zz-delivery-flow.fixture.ts` 用独立“制作演练-本轮 runId”门店、两集工单和真实批准的发布账号；商家会话只交给 Node 私有 helper。上传人复用原管理员，质检与推送复用原“演练交付”经理的第二个原始恢复码，不重新激活、改角色或增加员工。详情按工单号定位；方案、样片、逐集与成片包表单均按实际 `actions` 和 `Can` 显示，写成功重新 GET，冲突保留输入。

`live-delivery-flow.spec.ts` 经生产 `UploadField` 与本域直传 adapter 完成真实 MinIO POST/complete，再由 Node 私有 helper 调 `packages/services/scripts/admin-live-delivery-media.ts`。窄桥只接受本检出、本轮 `APP_ENV=test`、严格配对的 `lyx_test_admin_live_<runId>` 库/前缀与 loopback 公开测试配置；复核 file/category/item/uploader/clientToken/ETag/createdAt 全部归属后，对已有 job 调实际 `runtime.media.promote`，真实 copy/head 成功且 stored 后才写固定 known MP4 事实。文件是 17947 字节、真实 1 秒、160×90 的 H.264；未知 metadata 样片仍以 `PRODUCTION_NOT_READY` 拒绝 QC，零业务写。Chrome 不保证保留 Request stream 的 postData，因此 Node 从实际注册响应取 fileId/clientToken，再经真实文件 GET 核文件名与主体，制作上下文继续由窄桥锁内核验。测试不改生产请求、公共 harness、探测/QC 或 stored 状态；对象、库与前缀按本轮归属清理。

该流程走方案推送/商家确认、不同员工样片质检/推送、商家实际 900 秒附件下载留证/确认、两集上传登记、默认与单集例外质检、成片包质检至 delivering；成片包推送由 W1-20 接续。八张 `delivery-01-detail` 至 `delivery-08-delivering` 截图为 1440×900，另核 1366×768 无横向滚动。服务端窄桥目标可直接在 CI 用 Node FormData 运行；早期本机 CORS 探针显式加 `LYX_W119_BROWSER_POST=1`、`LYX_E2E_CHANNEL=chrome`，最终完整 live 总是实际浏览器上传，不以 Node 上传代替。


## W2-08 操作日志与访问留痕

`/sys/logs` 是唯一 `system.logs` 主从页，默认 ops；实际消费 `admin.auditLog.list/get`，复用 `MasterDetailPage`、`DateRangeField`、`DiffBlock` 与公共 mask。category 多选写 CSV，操作人、对象 ID/key 二选一、主体/门店、标题/RZ编号与北京时间日期均沿正式查询 schema 校验；筛选/切流清旧详情与游标。分页仅使用真实 nextCursor/hasMore，前驱按身份和筛选范围隔离，totalApprox 明示近似与 10,000 条封顶，不计算精确页数。URL 的日期范围也显示为两端含的文本；近 7/30 天和全部日期只改变查询条件。

列表声明已脱敏；详情显示具名安全字段，未知对象和值裁剪，密码/密钥/value 等不进入 DOM。关联 link 仅在已实现且有权限的登记页转成固定入口，未来页显示普通标签。access 切换只给超级管理员；非超管仍由真实 API 返回 403（列表）/404（详情），失败清选择，不显示旧详情。PII 留痕显示访问字段、动作、用途、备注、操作人和审计编号，不含被查看值。

`w208.fixture.ts` 只在本轮隔离库准备虚构 ops、系统任务与合法财务查看角色。`live-audit.spec.ts` 的 PII POST 使用 Node 原生 fetch：明文响应不经过浏览器或 Playwright API tracing，断言只比较布尔结果，返回 auditLogId 后以真实 GET 查询；API 日志不记响应 body。页面查询前后 ops/access 数量相同、浏览器零写请求。访问 POST 单独证明 access 数量增加一条。

真实截图在 `dist/e2e-shots/`：`audit-01-filtered-ops.png`（多条件）、`audit-02-masked-detail.png` / `audit-02-masked-diff.png`（脱敏详情与差异）、`audit-03-access-pii.png` / `audit-03-access-purpose.png`（访问留痕与用途）、`audit-04-empty.png`、`audit-05-permission-denied.png`。截图尺寸 1440×900，另在 1366×768 核对整页/内容区无横滚；图中均为虚构数据。日期空值 Tab/Shift+Tab 进出、Enter打开、Esc关闭与手输当天两端包含由真实 Chrome 验收；无头全量与有头 W208 定向结论分别写在本包状态。保留原 runner/config 与失败 trace 策略。

后续 `W2-31` 所拆 G7-A 接 `admin.exportJob.create` / `audit_logs.list` 及导出记录，不在本页放占位导出按钮；关联页落地后再按正式 link 与权限接准确对象入口。
