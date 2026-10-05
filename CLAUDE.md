# 狸有戏（liyoxi）会话开工须知

每个开发会话自动读到本文件。它是开工的唯一入口。细则在所引文档里，本文只写总纲与出处。

## 1. 项目与当前阶段

- 一句话：面向本地生活商家的短剧营销工具。V1.0 交付商家端微信小程序、运营后台、电脑端下载页。
- 阶段：开发计划已获业主确认（Q1、Q12 均按默认，Q12 里“谁合并”一项后来改了，合并与确认的做法 2026-10-05 又按业主的话精简过，见第 7 节；出处：`docs/plan/owner-checklist.md` 第 3 节 Q1、Q12 两行）。处在 M0“最小地基”，第一个工作包是 W0-04（协作规范，纯文档）。
- 仓库现状：只有文档与两个校验工具，没有业务代码。实际进度以 `docs/plan/status/` 为准，不以本节为准。
- 日历：不排日期。用里程碑先后、进入与退出条件表达进度（[08](docs/08-development-plan.md) 第 3 节 ③）。

## 2. 文档地图与优先级

| 文档 | 定什么 |
| --- | --- |
| [01](docs/01-architecture.md)–[05](docs/05-risks-and-open-issues.md) | 架构、选型、关键方案、ADR、风险与待确认 |
| [06](docs/06-data-model.md) 与 [docs/data-model/](docs/data-model/README.md) | 表结构、约束、状态机、加锁顺序 |
| [07](docs/07-api-contract.md) 与 [docs/api/](docs/api/README.md) | 接口契约；通用约定在 [00-conventions.md](docs/api/00-conventions.md)（下称“约定”） |
| [design/design-spec.md](design/design-spec.md)（下称“规范”） | 界面：颜色、组件、状态取色、文案、平台约束 |
| [D5](docs/appendix/design/d5-media.md)、[D6](docs/appendix/design/d6-notify-docs-data.md)、[D7](docs/appendix/design/d7-platform.md) | 子系统设计草案，供 01–07 引用处查细节 |
| [08](docs/08-development-plan.md) | 先做什么、后做什么、做到什么算完 |
| `docs/plan/` | 进度与任务书：`tasks/`、`status/`、`stubs/`、`changes/`、`external-verification/`、`owner-checklist.md`、三份运维文档 |
| `docs/adr/` | 新 ADR，一条一文件。04 里状态为“提议”的 ADR 按提议执行，不当作未生效（08 第 3 节 ⑫） |

冲突时以谁为准：

| 冲突 | 以谁为准 | 出处 |
| --- | --- | --- |
| 08 与 01–07 | 01–07；回改 08 | 08 第 13 节 |
| 主文档（01–07）与附录草案（D1–D9） | 主文档；同 PR 勘误草案 | 08 第 4.2 节 Q4 |
| 文档与查实的事实 | 事实；同 PR 回写文档，PR 描述列“偏差” | 08 第 3 节 ⑨ |
| 接管之后的文档与代码 | 代码（`packages/db`、`packages/contract`）；文档同 PR 跟随 | 08 第 5.7 节 |
| 任务书与 01–07 或 08 | 01–07、08 为准：照它做，在状态文件“偏差”里记一句，由调度会话定（第 3 节第 6 步） | — |

## 3. 会话怎么开工

固定提示语：“读 `CLAUDE.md` 与 `docs/plan/tasks/<编号>.md`，完成工作包 <编号>”（08 第 5.3 节）。

1. 读本文件、状态汇总、本包任务书。会话不带记忆，只凭这三样开工。状态汇总不入库：在最新 main 的检出里跑 `pnpm status:summary` 现生成，写到 `docs/plan/status/SUMMARY.md`（被 git 忽略；它是生成那一刻的快照，与单个状态文件不一致时以单个文件为准，重新跑一遍即可）。
2. 核对任务书“依赖”列的包已全部合并：main 上该包的状态文件写“完成”即已合并。上游未合并，不得基于其分支开工。
3. 任务书不存在时分两种。`docs/plan/tasks/README.md` 第 3 节列的 13 个 S、M 包：按 08 第 7.2 节的清单行与任务书模板补全，先查该 README 第 5 节的移交表，随 PR 提交。L 与甲类包：停下报告，不自己写。
4. 一个会话一个工作包，在独立 worktree 里做，从最新 main 切分支。
5. 只改任务书允许的目录；只新增任务书允许的依赖。
6. 拿不准的、为做完本包必须小幅超出任务书范围的：自己选最贴近 01–07 的做法照做，在状态文件“偏差”里记一句，由调度会话合并时定，不停下来等人（第 6 节硬性规则不在可以自己定的范围里）。只有会动服务器、要真实密钥、或根本做不下去时才停：把原因写进本包状态文件的“阻塞原因”，并在回复里说明。
7. 先交付可读的中间成果，再做完整。默认：长时间没有产出就停下汇报，不空转（W0-04 定）。
8. 收尾：把 `docs/plan/status/<编号>.md` 的状态写成“完成”（取值见 `docs/plan/status/README.md` 第 3 节），PR 编号等调度会话开了 PR 再填；按 PR 模板写描述，各节几句话，“偏差”简短写。只改自己这一个状态文件，状态汇总不用生成、不用提交。会话不推送、不开 PR、不合并，这些由调度会话做（第 7 节）。

待评审的非草稿 PR 到上限（默认 5 个）不开新包（08 第 3 节 ⑥、第 5.3 节）。

默认：随 W0-04 交付的 27 份任务书，已随 W0-04 的 PR 由业主本人过目并合并（`docs/plan/owner-checklist.md` 第 5 节），头部写的“业主已过目：否”不挡开工（W0-04 定）。

## 4. 技术栈固定表

出处：08 第 5.2 节；[02](docs/02-tech-selection.md) 第 5 节；ADR-035。全部写精确版本并提交锁文件；CI 用 `--frozen-lockfile`；关闭安装脚本，只放行白名单；依赖须发布满 7 天。补丁号由 W0-01 按同一规则重取。

| 层 | 版本 | 不能装的 |
| --- | --- | --- |
| 运行时 | Node 24（≥24.19）；pnpm 10.34.5；TypeScript 5.9.3 | TypeScript 7、pnpm 12 |
| 服务端 | Hono 4.13 + @hono/zod-openapi 1.6；Zod 4.6；Prisma 7.9.1（三包同版）；PostgreSQL 17；BullMQ 6.3 + Redis 7；@react-pdf/renderer 4.9；write-excel-file 4.1 | Prisma 8 候选版、xlsx |
| 小程序 | Taro 4.2.1（Vite）；React 18.3.1；NutUI React Taro 3.0.20；Zustand 5 | NutUI 的 cpp 变体 |
| 后台与下载页 | React 19.3；Vite 8.3；Ant Design 6.6；TanStack Router / Query；openapi-fetch；ECharts 6.1 | echarts-for-react |
| 测试 | Vitest 4.1.11；fast-check 4.10；Playwright 1.63 | Vitest 5 |
| 规范 | ESLint 10.11 + typescript-eslint；Prettier；commitlint；husky；dependency-cruiser 18.4 | eslint-plugin-react |

新增依赖只在任务书写明时允许；依赖升级单独成 PR。

## 5. 目录结构

出处：08 第 5.1 节。包名 `@liyoxi/*`，技术前缀 `lyx`。

| 路径 | 内容 | 何时存在 |
| --- | --- | --- |
| `docs/`、`design/`、`tools/`、`CLAUDE.md` | 依据文档、设计规范与原型、校验工具 | 现在 |
| `docs/plan/`、`docs/adr/` | 台账、任务书、运维文档；新 ADR | W0-04 之后 |
| 根配置、`packages/config` | package.json、pnpm-workspace、lint、提交钩子、tsconfig 预设 | W0-01 之后 |
| `apps/api`、`apps/worker` | 同一个 server 镜像的两个入口 | 空包 W0-02；骨架 W0-22、W0-23 |
| `apps/weapp` | 商家端小程序（Taro，React 18） | 空包 W0-02；工程 W0-27a |
| `apps/admin`、`apps/portal` | 后台、下载页（React 19）。两个 React 大版本各自安装，不提升 | 空包 W0-02；骨架 W0-28 |
| `packages/contract` | Zod schema、路由元数据、错误码、权限点与能力点、开关键、事件目录；生成三份 OpenAPI 与类型 | 空包 W0-02；骨架 W0-08 |
| `packages/db` | Prisma schema、迁移、客户端工厂、结构快照 | 空包 W0-02；首版迁移 W0-05 |
| `packages/services` | 31 个模块各一个目录，对外只暴露 `index.ts`；各带 `register.ts`；Provider 与测试替身 | 空包 W0-02；装配机制 W0-07b |
| `packages/shared` | 纯函数：计价与取整、周期日期、状态机表、工作日、格式化；设计变量与图标走子路径 | 空包 W0-02；纯函数 W0-11 |
| `infra/` | compose、docker、deploy、ci（`layers.json` 与检查脚本）、bootstrap | `infra/ci` 起于 W0-01（检查脚本），`layers.json` 起于 W0-02；compose 与 CI 起于 W0-03 |
| `spikes/` | 一次性验证代码，不进生产构建 | 技术验证包（X-01 等）开工后 |

## 6. 硬性规则

违反任一条，复审按 D 类阻断（`docs/plan/templates/review.md` 第 2 节）。细则以出处为准。

| # | 规则 | 出处 |
| --- | --- | --- |
| 1 | 不读取、不输出、不提交 `.env`、密钥、证书。`.env.example` 只放占位。本地与 CI 全用替身 Provider | 08 第 3 节 ⑦、第 5.3 节“禁止” |
| 2 | 包间依赖方向：应用 → services → db / shared → contract。contract 不依赖任何工作区包；shared 只引 contract 的纯常量子路径 | 01 第 4.2 节；08 第 4.2 节 Q4 |
| 3 | services 分 L0–L4 五层，同步调用只能向下，向上走出站事件。钱（L2）不依赖履约（L3） | 01 第 5 节 |
| 4 | 同层同步调用只走白名单。下层表不引用上层表；下层要用上层逻辑时用端口 | 06 第 3.6 节 |
| 5 | 应用层（api、worker、前端）不直接查库。`packages/db` 只在进程装配时引客户端工厂 | 01 第 4.2 节；08 第 5.3 节“禁止” |
| 6 | 业务逻辑只写在 `packages/services`；路由与任务处理器是薄壳 | 01 第 2.2 节 P2 |
| 7 | 写操作统一形态：开事务 → 幂等键登记 → 按全局顺序加锁、校验守卫 → 改业务行 → 写审计、出站事件、定时器 → 提交 | 01 第 7.1 节；约定 第 7 节 |
| 8 | 改库的服务函数第一个参数是事务句柄；只有用例函数可以开事务 | 01 第 5 节 |
| 9 | 事务内不调外部服务。必须同步的外部调用写成“先调外部、再开事务” | 01 第 5 节；08 第 5.3 节“禁止” |
| 10 | 多行加锁按唯一的加锁顺序表；计费账户最后锁，一个事务只锁一个主体的计费账户 | 06 第 5 节；01 第 7.1 节 |
| 11 | 25 张业务状态机表的状态只经 `flow.transition()` 迁移，每次写状态历史 | 06 第 3.4 节；01 第 6.3 节；08 第 5.3 节“禁止” |
| 12 | 只增表（积分流水、审计、状态历史、同意记录等）只追加，不改不删 | 06 第 3.4 节 |
| 13 | 金额整数分（`_fen` / `…Fen`）、积分整数、比例万分比；全仓只有一个取整函数 | 06 第 3.2 节；01 第 6.3 节；约定 第 0 节 |
| 14 | 业务表主键 UUID v7，由应用生成，库里不设默认值 | 06 第 3.1 节 |
| 15 | 业务时间由注入的时钟提供，不用库的 `now()`。库内存 UTC；按“日”的规则用北京时间 | 06 第 3.2 节；01 第 5 节 |
| 16 | 枚举是 `text` + CHECK，取值唯一来源是 `packages/contract`；先声明，下一版再写入 | 06 第 3.2 节；01 第 2.2 节 P6 |
| 17 | 敏感字段用三件套：密文、盲索引、脱敏串 | 06 第 3.2 节 |
| 18 | 外部能力走 Provider：未配置不崩溃，失败可降级 | 01 第 2.2 节 P5、第 9 节 |
| 19 | 契约是接口唯一手写源。GET 不写库。写路由声明幂等方式。端上只按错误符号名 `error` 判断 | 01 第 2.2 节 P1；约定 第 0 节 |
| 20 | 金额、积分、可否订购、购买入口由服务端计算或下发；页面不自算 | 01 第 2.2 节 P4 |
| 21 | 结构只走手写或审过的迁移，用 `migrate deploy`；不用 `prisma migrate dev` 的自动产物。草稿 `schema.prisma` 与 `constraints/` 接管后冻结 | 08 第 5.3 节“禁止”、第 5.7 节 |
| 22 | 不跳过钩子。不在工作包 PR 里放松门禁（删改规则、调高基线、改 `layers.json` 白名单、改锁序常量） | 08 第 5.3 节 |
| 23 | 生成物（OpenAPI、类型、结构快照、登记文档、台账汇总）不手改；冲突时变基后重新生成，不手工合并 | 08 第 5.7、9.3 节 |
| 24 | 页面不写色值与状态色；购买入口、开关、文案取自引导数据；逐条核对规范 第 11 节的平台约束 | 08 第 10.1 节；规范 第 11 节 |
| 25 | 借用参考工程：逐文件借，不整体拷贝；换名为 `@liyoxi/*`、前缀 `lyx`；PR 列借用清单。参考工程只读，路径与固定提交以 `docs/plan/owner-checklist.md` 第 2.2 节为准 | 08 第 3 节 ⑧ |
| 26 | 领域 PR 只写自己接口的 Zod 结构，不动别人的路由元数据与注册表；接口是否“已落地”由 CI 判定，不手工打标 | 08 第 9.3 节 |
| 27 | 通用构件与页面骨架看样确认后冻结。页面包不改构件，要改走单独的构件 PR | 08 第 9.3 节 |
| 28 | 中间件装配顺序只在一处定义（W0-22b）；其余包只加自己的中间件文件 | 08 第 9.3 节 |

## 7. 分支、提交、PR、复审与合并

出处：08 第 5.3 节。

| 项 | 规则 |
| --- | --- |
| 分支 | `feat/<工作包编号>-<短名>`；修复 `fix/*`；验证 `spike/*`。从最新 main 切。不直接推 main（档位升级与 E15 ③ 完成前平台不拦，会话自守） |
| 提交 | conventional commits：`type(scope): 中文一句话`。默认：一句话以中文开头；要带工作包编号就放句末，如 `feat(db): 首版迁移（W0-05）`（W0-04 定；以大写拉丁字母开头会被 commitlint 的大小写规则拒掉） |
| 粒度 | 一个工作包一个 PR。体量上限（默认）：甲类一个机制、非生成非测试代码约 600 行；乙类 20 条接口；丙类 8 页。超过时拆不拆由调度会话定 |
| 契约先行 | 一个域的 Zod 结构随该域第一个后端 PR 合入；页面包在契约合入后开工 |
| PR 描述 | 按模板写，各节几句话：工作包；改了什么（含依据）；怎么验（命令 + 判据；证据就是 CI 运行，给链接，不贴文本、不另写证据文件；页面包附截图）；留给业主事后看的（用到的默认项编号、留桩、偏差、回写了哪些文档、借用清单）；门禁改动 |
| 评审分级 | 甲（内核、账本、入账、权限与字段裁剪、迁移、回调验签）：不与其他改动混合，附性质或并发测试输出。乙：看验收输出与默认项清单。丙：看截图与清单。各包级别见 08 第 7.1 节 |
| 门禁改动 | “只增”类随工作包 PR，CI 打 `gate-touch`。“放松”类只在单独 PR 里改，标 `gate-change`；不用等业主，调度会话合并并在合并评论里写明放松了什么 |
| 单独成 PR | 依赖升级；首版之后的结构变更（同一时刻只允许一个在途）；契约的破坏性变更 |
| 复审与合并 | 作者会话不推送、不开 PR、不合并：PR 描述写好交给调度会话。合并由调度会话做，三项齐了就合并，不等业主：CI 的 `required` 在“已与 main 同步”的提交上为绿；有一轮独立复审且没有未处理的阻断项；PR 不是草稿。复审每个 PR 一轮、一份（甲类也是），限时，只找真问题：bug、违反硬性规则、验收核心没做到、放松门禁而理由站不住；阻断项修完由 CI 把关，不再补复审。甲类、看样、门禁放松、计划小改、体量超限、任务书偏差、边界情况都由调度会话定并合并，合并评论里列出留给业主事后看的事项。仍然先问业主的只有：动服务器的每一步、部署与发布、用到真实密钥或账号、花钱、删数据或别的不可逆操作、改 main 的保护规则与必过检查的名单。这几句是调度会话照业主 2026-10-05 的话归纳的，业主可以随时纠正；业主的原话与全文在 `docs/plan/README.md` 第 3.5 节，有出入时以那一节为准。新开的会话要代合并，须业主在那个会话里明说 |

## 8. 测试与门禁要点

出处：08 第 5.4、5.5、10.1 节。

| 项 | 要点 |
| --- | --- |
| 验收 | 一律“命令 + 判据”；证据就是 CI 运行（给链接），不另写证据文件，不贴输出；复审不整套重跑 |
| 覆盖率 | 不设全仓门槛，以“必须有哪几类测试”为准（08 第 3 节 ⑬） |
| 服务包必带 | 改库的用例有连真库测试；状态迁移有表驱动测试；多行事务通过锁序断言；带幂等键的写用例有重放测试 |
| 甲类必带 | 性质或并发测试输出；失败的种子与反例固化成用例 |
| 服务包另须（模块完整） | 本模块的事件、订阅者、定时器处理器、周期任务、不变量已登记；x01 第 5 节归本模块的迁移已实现；全量不变量 0 违规；通知场景解析、提醒端口、直记埋点已接（实现未到的用空实现并登记留桩）；D7 第 9.4 节里本模块的告警规则已登记并有触发测试；真机清单条目已补 |
| 接口包 | 被 CI 判为“已落地”：真实处理器 + 至少一条接口层测试引用该 operationId + 不在留桩清单。商家端接口包另须店员防回归通过 |
| 页面包 | 硬性规则 24；无画板页附截图；本页的订阅点位、隐私授权、埋点按登记表挂上；`docs/plan/pages.md` 里本页标为已实现 |
| 测试库 | 隔离单位是“库”：每个会话、每个 Vitest worker 一个 `lyx_test_<包>_<n>`；守卫只认 `lyx_test_` 前缀；重置 = 删库重建。用法（W0-05b）：测试文件顶层写 `const db = useTestDatabase("<包>")`（从 `@liyoxi/services/testing` 引），包的 `vitest.config.ts` 挂 `globalSetup`；`<n>` 是“会话标识_worker 编号”，会话标识取 `LYX_TEST_SESSION`，没设就取检出根路径的短哈希，所以每个 worktree 各用各的；库从本会话的模板库 `lyx_test_tpl_<会话标识>` 拷出，模板库每轮测试开始时重建并跑全部迁移；用例全过即删库，有失败（用例或钩子）就把库改名留下并打印库名，看完用 `pnpm test:db:prune` 清掉。同一个检出里要同时跑两轮测试，各给一个不同的 `LYX_TEST_SESSION`。挂了 `globalSetup` 的项目（现在是 `packages/db`、`packages/services`）每轮开始时先建模板库：只跑其中不连库的用例，也要本地的 PostgreSQL 在运行并给出 `DATABASE_URL`。用了 `useTestDatabase` 或 `useTestRedis` 的包必须挂 `globalSetup`（没挂即报错）：CI 的 `test:isolation` 一步按它认哪些项目要跑。详见 [README](packages/services/src/testing/README.md) |
| Redis 与 Compose | Redis 按键前缀隔离（库号只有 16 个，不够分）：每个会话、每个 worker 一个 `lyx:test:<会话标识>:<worker 编号>:`，测试文件顶层写 `const redis = useTestRedis()`；“清空”只清自己前缀下的键（SCAN 加 UNLINK），不用 FLUSHDB、FLUSHALL。Compose 只起一份共享实例，多个 worktree 共用：在哪个 worktree 里 `pnpm infra:up` 都是同一套容器，已经起着就不用再起，不要另起一套（会抢端口）；别的会话在跑测试时不要 `pnpm infra:down`；不直接删别人的库、清别人的键，连库的用例不往 `liyoxi`、`lyx_schema_check`、`lyx_migrate_check` 里写数据 |
| 门禁自测 | 每加一道门禁，同包加一个反例进 `gates:selftest` |
| 时长 | PR 必过检查合计 ≤15 分钟 |
| 小程序 | CI 只构建；主包 ≤1,500KB、分包 ≤800KB；页面证据用截图命令的产物；真机手验按演示点批量做，由业主执行 |
| 留桩 | 登记在 `docs/plan/stubs/`，一项一个文件，写明回补的里程碑。内核、账本、鉴权链不留桩 |

## 9. 命令

现在就能跑（准备步骤与连接参数见各自 README；临时库只接受 `lyx_` 开头的名字）：

| 命令 | 做什么 |
| --- | --- |
| `python3 tools/schema-check/check.py`（加 `--keep` 保留校验库） | 分组文档的字段表与跑完全部迁移的库逐列比：自建临时库 `lyx_schema_check`（共用实例上用 `--db` 换个名字），`--existing <库>` 只读地比一个已有的库，`--from-draft` 是由冻结的草稿建库的旧流程。见 [README](tools/schema-check/README.md) |
| `python3 tools/api-check/check.py` | 核对接口文档自洽。见 [README](tools/api-check/README.md) |
| `python3 tools/api-check/gen_registries.py`、`gen_permissions.py` | 重新生成接口索引、错误码与权限点登记表 |
| `pnpm install --frozen-lockfile` | 按锁文件安装，顺带装上提交钩子。pnpm 的版本由 `packageManager` 锁定，会自动切过去 |
| `pnpm infra:up`、`pnpm infra:down` | 起、停本地依赖（PostgreSQL 17、Redis 7.4、MinIO），要本机 Docker 在运行。`infra:up` 等到三个服务都健康才返回；`infra:down` 不删数据卷。只有一份共享实例，在哪个 worktree 里跑都是同一套容器。端口、账号见 [local.yml](infra/compose/local.yml)，连接串的写法见表后 |
| `pnpm gates:selftest` | 门禁自测：对固定的反例逐个跑对应的检查，断言检查失败且原因对得上。其中几例要外部条件：密钥扫描的要 Docker，依赖审计的要外网。怎么加反例见 [README](infra/ci/README.md) 第 4 节 |
| `pnpm status:summary` | 现生成状态汇总 `docs/plan/status/SUMMARY.md`：计数、可开工的包、各包状态。文件不入库（被 git 忽略），不用提交；换了分支、拉了 main 就重新跑。状态文件不合规时报错并指出是哪个文件的哪一项；CI 的“状态文件核对”只做这道核对（`node infra/ci/status-summary.mjs --check`，不写文件），见 [README](infra/ci/README.md) 第 6 节 |
| `node infra/ci/check-env-example.mjs` | 核对 `.env.example`：键集合等于 `loadEnv` 的键集合，值都是占位 |
| `node infra/ci/classify-gate-changes.mjs --base origin/main` | 本地试跑门禁改动分类：看本分支的改动会被判成只增还是放松。口径见 [README](infra/ci/README.md) 第 5 节 |
| `pnpm lint`（`pnpm lint:fix` 自动修） | ESLint。规则片段在 `packages/config/eslint/`，装配在根 `eslint.config.js` |
| `pnpm format:check`（`pnpm format` 改写） | Prettier 格式检查。不碰 `docs/`、`design/`、`tools/` 与全部 `*.md` |
| `pnpm typecheck` | 类型检查：根、`infra`、五份 tsconfig 预设的最小工程（见 [README](infra/ci/fixtures/README.md)）、各工作区包 |
| `pnpm test` | Vitest。项目：`packages/*`、`apps/api`、`apps/worker`、`infra` |
| `pnpm test --maxWorkers=4` | 指定并行数跑测试。参数直接跟在后面，不要写成 `pnpm test -- --maxWorkers=4`：`--` 之后的参数会被 Vitest 忽略。跑测试的前提（带不带参数都一样）：`packages/db`、`packages/services` 两个项目挂了 globalSetup，只跑其中不连库的用例，也要本地的 PostgreSQL 在运行并给出 `DATABASE_URL`；连 Redis 的用例另要 `REDIS_URL` |
| `pnpm test:isolation`（加 `--scope connected` 只跑连库的测试项目，CI 的那一步用它；加 `--workers <n>` 指定每个会话的 worker 数） | 测试隔离：两个会话同时跑全量测试，都要绿，且两边用的 `lyx_test_` 库名与 Redis 前缀没有交集。每个会话的 Vitest worker 数缺省按本机核数定：两个会话合起来不超过可用核数，各最多 4 个、至少 1 个。要本地依赖在运行并给出连接参数。日志通过即删，没过的留在系统临时目录并打印位置。见 [README](packages/services/src/testing/README.md) 第 6 节 |
| `pnpm test:db:prune`（加 `--dry-run` 只列不删；加 `--all` 清实例上全部测试库） | 清理测试库：删本会话留下的 `lyx_test_` 开头的库（失败的用例留下的、被中断的一轮没收尾的）。别的库一个不动；正有一轮测试在跑的会话的库不删。见 [README](packages/services/src/testing/README.md) 第 2 节 |
| `pnpm --filter @liyoxi/shared test` | 只跑 `packages/shared` 的用例：PRD 2.9 七例、锚定日、工作日、金额格式化，性质测试（固定种子、每个性质 200 轮），导出自测与静态扫描，另在两个进程时区下重跑一遍。种子与轮次的改法见 [vitest.config.ts](packages/shared/vitest.config.ts) 开头的注释 |
| `pnpm depcheck` | 依赖方向与分层检查：先核对分层登记（`node infra/ci/check-layers.mjs`，可单独跑），再对全仓跑 dependency-cruiser。规则见 [.dependency-cruiser.cjs](.dependency-cruiser.cjs) 开头的注释；模块的层与同层白名单在 [layers.json](infra/ci/layers.json)；反例夹具见 [README](infra/ci/fixtures/layers/README.md) |
| `pnpm contract:generate` | 由 `packages/contract/src` 重新生成三份 OpenAPI 与类型，写进 `packages/contract/generated/`。改了契约源码先跑它再提交。用法见 [脚本](packages/contract/scripts/generate.ts) 开头的注释 |
| `pnpm contract:check` | 契约生成物与源码无差异：重新生成后 `git diff --exit-code`，不一致即非 0 退出 |
| `pnpm check:rename` | 换名检查：出现参考工程的旧名或旧的小程序目录即失败。口径见 [脚本](infra/ci/check-rename.mjs) 开头的注释 |
| `node infra/ci/check-release-age.mjs`（加 `--since <git 引用>` 只查新增的版本） | 锁文件里每个版本都发布满 7 天。用法见 [脚本](infra/ci/check-release-age.mjs) 开头的注释 |
| `pnpm wxpay:vectors` | 微信支付驱动的跨实现核对：在一次性容器里用官方 Go SDK 对同一批输入签名、验签、解密、解析通知，产出 `cross-check.json`。要本机 Docker 与外网，不进 CI。见 [README](packages/services/src/providers/wechat-pay/README.md) |
| `pnpm design:generate` | 由 `design/tokens.json` 与图标源重新生成样式变量、后台主题、图标数据，并出一页预览（不入库）。来源、生成物与子路径见 [README](packages/shared/scripts/README.md) |
| `pnpm design:check` | 生成物无差异：重新生成后 `git diff --exit-code`，且生成物目录下没有未跟踪的文件。生成物不手改 |
| `pnpm lint:colors` | 页面不写色值：三个前端的 `src` 里出现十六进制、颜色函数（`rgb()`、`hsl()`、`oklch()`、`color-mix()` 等）或 Sass 的颜色运算（`darken()`、`mix()` 等）即失败。口径与白名单见 [脚本](infra/ci/check-colors.mjs) 开头的注释；页面里颜色从哪取见 [README](packages/shared/scripts/README.md)“页面里怎么取颜色” |
| `pnpm --dir spikes/license-pdf render`（另有 `test`、`render:container`、`typecheck`） | 授权书 PDF 渲染验证（X-03）：出三份样张与报告；跑用例；在 `node:24-slim` 容器里复跑。独立工程，先 `pnpm --dir spikes/license-pdf install --frozen-lockfile`。见 [README](spikes/license-pdf/README.md) |
| `pnpm mediatool:verify` | mediatool 隔离容器的验证：构建镜像，起验证用的 Compose，现场造测试片，在调用端容器里跑用例，再核对容器配置；跑完删掉容器与卷。本机要有 Docker。见 [README](infra/docker/mediatool/README.md) |
| `pnpm mediatool:bench` | 同上，另造一条约 200MB 的片子，量“体检 + 封面”与加标的耗时 |
| `pnpm db:generate` | 生成数据库客户端到 `packages/db/dist/generated/`（不入库）。`pnpm typecheck`、`pnpm test`、构建之前要先有它，`pnpm install` 不会顺带生成；不连库。见 [README](packages/db/README.md) 第 2、3 节 |
| `pnpm db:validate` | `prisma validate`：校验 `packages/db/prisma/schema.prisma`。不连库 |
| `pnpm db:deploy` | `prisma migrate deploy`：对 `DATABASE_URL` 指的库跑全部待执行的迁移，可重复跑。`pnpm test` 里 `packages/db` 的用例要连迁移库 `lyx_migrate_check`，没建就失败、不跳过：怎么建、报错怎么看见 [README](packages/db/README.md) 第 3 节 |
| `pnpm db:catalog-diff` | 系统目录比对：由底稿建的参照库 `lyx_schema_check` 与迁移库 `lyx_migrate_check` 的表、列、约束定义、索引定义、触发器、函数体逐项 0 差异，数量两组口径对得上；出报告。两个库怎么建、参数与口径见 [README](packages/db/README.md) 第 6 节。它的用例（`infra/ci/test/db-*.test.ts`）与 `gates:selftest` 里它的反例也要连本地的 PostgreSQL，各建各的临时库，用完删掉。W0-06b 起 `check.py` 缺省建的是迁移后的库：参照库要由底稿建时加 `--from-draft`，CI 里那一步的现状见 [README](infra/ci/README.md) 第 8.4 节 |
| `pnpm db:verify-managed` | 托管库验证：对 `DATABASE_URL` 指的、`lyx_` 开头的空库报告两个扩展可建、迁移跑通、计数表；不打印连接串。业主在托管库到位时跑；本地演练的做法见 [README](packages/db/README.md) 第 7 节 |
| `pnpm db:snapshot` | 重出结构快照 `packages/db/snapshot/structure.txt`：自建临时库跑完全部迁移，读表、列、约束、索引、触发器、函数六类（不含分区子表），用完删库。改了结构（写了新迁移）先跑它再提交；生成物不手改。口径见 [README](infra/ci/README.md) 第 8 节 |
| `pnpm db:snapshot:check` | 结构快照无差异：重新生成后 `git diff --exit-code`，且快照目录下没有未跟踪的文件 |
| `pnpm db:constraints:check`（加 `--db <库>` 换一个库） | 约束清单比对：拿跑完迁移的库（默认 `lyx_migrate_check`）与快照逐条比，数量与快照、06 第 1 节三处对得上。只读；核对已经部署的库的做法见 [README](infra/ci/README.md) 第 8.2 节 |
| `pnpm db:partitions:assert`（加 `--db <库>` 换一个库） | 分区断言：兜底分区在且为空，当月与未来 3 个月的分区在，子表上的触发器齐全。只读。本地长期留着的 `lyx_migrate_check` 过了月初会红，删掉重建 |
| `pnpm db:migration-lint`（加 `--base <git 引用>`，默认 `origin/main`） | 迁移规范检查：`DROP`、`RENAME`、`ALTER … TYPE`、不带默认值的 `SET NOT NULL` 要带一行 `-- lyx:allow <理由>`；已经合并的迁移不能改。不连库。两种不用标记的情形见 [脚本](infra/ci/migration-lint.mjs) 开头的注释 |
| `pnpm db:draft-freeze:check` | 草稿冻结守卫：`docs/data-model/schema.prisma` 与 `constraints/` 的 sha256 等于登记值（`infra/ci/draft-freeze.sha256`）。不连库 |
| `pnpm --filter @liyoxi/worker build`，然后 `node apps/worker/dist/index.js`（加 `--check` 只做装配与自检） | 构建并起任务进程：谁持有数据库租约谁跑四个循环与两个队列的消费。`--check` 通过即以 0 退出，要 `DATABASE_URL` 指向跑过迁移的库（本地用 `lyx_migrate_check`）。用例 `pnpm --filter @liyoxi/worker test`，要本地的 PostgreSQL 与 Redis。见 [README](apps/worker/README.md) |
| `REDIS_COMPAT_URL=<连接串> pnpm redis:compat` | 托管 Redis 与队列库的兼容脚本（验证项 V1）：七项逐项给结论并出一份 JSON 报告，连接串只从这个环境变量读、不落盘不打印。参数见 [脚本](apps/worker/src/cli/redis-compat.ts) 开头的注释；业主怎么跑见 [v01-managed-redis.md](docs/plan/external-verification/v01-managed-redis.md) |
| `pnpm admin:build`、`pnpm portal:build` | 后台、下载页的生产构建（产物在各自的 `dist/app`），随后查产物：文件名带内容哈希、写入了构建号、不含夹具。见 [README](apps/admin/README.md) |
| `pnpm admin:e2e` | 后台 Playwright 冒烟：先出一份带样例页的构建，起它的预览，走一条用例，出外壳与三种骨架的截图（`apps/admin/dist/e2e-shots`）。浏览器怎么备见 [README](apps/admin/README.md) |
| `pnpm --filter @liyoxi/admin test`、`pnpm --filter @liyoxi/portal test` | 后台、下载页的单测。根上的 `pnpm test` 不含这两个应用：它们的单测与构建共用各自的 `vite.config.ts` |
| `node infra/ci/pages/generate.mjs`（加 `--check` 只比对） | 由后台菜单登记表与下载页页面清单重新生成 `docs/plan/pages.md`。用法见 [脚本](infra/ci/pages/generate.mjs) 开头的注释 |
| `pnpm registry:generate` | 由契约的 x01 名称登记（`packages/contract/src/registry/`）重新生成条目归属表 `docs/plan/x01-map.md`。改了登记数据先跑它再提交；归属表不手改。用法见 [脚本](packages/contract/scripts/registry-map.ts) 开头的注释 |
| `pnpm registry:check` | 登记表对账：重新生成归属表后 `git diff --exit-code`，再拿登记数据与 x01 正文、`docs/api/working/frag/x01-events-jobs.json` 对账（名称集合、数量、归属里程碑、名字的写法），一处不符即非 0 退出。不连库。口径见 [脚本](packages/contract/scripts/registry-check.ts) 开头的注释 |
| `pnpm enums:check`（加 `-- --db <库名>` 换一个库） | 枚举与库 CHECK 一致：库里每条“列取值集合”形态的 CHECK 都有契约枚举（`packages/contract/src/enums/`）对应，取值集合相等；另核对名字写法的 CHECK 正则。只读；要 `DATABASE_URL`（或 `PG*`）与跑过迁移的 `lyx_migrate_check`（怎么建见 [README](packages/db/README.md) 第 3 节）。口径见 [脚本](packages/contract/scripts/enums-check.ts) 开头的注释 |
| `pnpm machines:check` | 状态机迁移表对照：`packages/shared/src/machines` 的 25 张迁移表与数据模型分组文档的状态机表逐行 0 差异（当前状态、事件码、新状态、有无守卫），状态机与状态列的清单与契约登记、01 分组、`catalogue.json` 一致。只读文件，不连库。改迁移要同一个 PR 改分组文档的那一行；怎么写、对照的口径见 [README](packages/shared/src/machines/README.md) |
| `pnpm machines:coverage`（加 `-- --strict` 时有未引用的行即失败） | 状态机覆盖检查的骨架：迁移表的每一行有没有被接口或 x01 的归属表引用。现在只出报告，不进 CI，M1 起才是门禁。见同一份 [README](packages/shared/src/machines/README.md) 第 5 节 |
| `pnpm db:verify-grants`（加 `--database <库名>` 核对名字不以 `lyx_` 开头的库） | 角色与授权的核对：对 `DATABASE_URL` 指的、`lyx_` 开头、跑完全部迁移的库，核对两个角色、授权是否生效、分区表能否写入与查询；逐表与期望比，只读系统目录，不打印连接串。`pnpm db:verify-managed` 成功后会自动接着跑它（后置钩子 `postdb:verify-managed`，要经 pnpm 跑才有）。见 [README](packages/db/README.md) 第 7、9 节 |
| `pnpm --filter @liyoxi/db exec vitest run src/grants.test.ts` | 权限测试（也在 `pnpm test` 里）：自建自删一个库，跑两遍迁移，以应用角色、只读角色、属主三种身份逐张表去试。要 `DATABASE_URL` 的账号能建库、能切换角色。加表要同时改迁移里的授权与期望的授权 `packages/db/src/grants.expected.json`（核对脚本也读它），见 [README](packages/db/README.md) 第 9 节 |
| `pnpm api-registries:check` | 接口侧注册表对账：契约里的领域错误码、权限点、能力点、后台模块键、资源登记、通知场景、订阅点位、埋点事件，以及 07 第 7 节补登的参数键与开关键，与登记文档（`docs/api/registry-errors.md`、`registry-permissions.md`）、`docs/api/working/` 的底稿及各依据文档逐字段对账，一处不符即非 0 退出。只读文件，不连库。对谁比、不比什么，见 [脚本](packages/contract/scripts/api-registries-check.ts) 开头的注释 |
| `pnpm check:type-hoist`（直接跑脚本时加 `--all` 查全部工程） | 类型解析不靠提升：写 JSX 的工程解析类型时，不许经 pnpm 的提升目录落到各工程装得不一样的包上（React 的类型由两份预设钉到工程自己装的那一份）。应用自己写 `paths` 时要把预设里钉 React 类型的四行抄上，否则这里红。来历与口径见 [README](infra/ci/README.md) 第 7 节 |
| `pnpm --filter @liyoxi/services exec vitest run src/kernel/` | 只跑 kernel（事务单元）的用例：开事务与嵌套、保存点、死锁与锁等待超时的并发测试、外呼断言、时钟、UUID v7 的性质测试、加锁顺序、操作人。连库的几份要本地的 PostgreSQL 与 `DATABASE_URL`。`tx.run`、`savepoint`、`lockRows` 怎么用，性质测试的轮次与种子怎么改，见 [README](packages/services/src/kernel/README.md) |
| `pnpm contract:docs-check` | 路由元数据对账：契约的路由清单（`packages/contract/src/routes`，一份接口文档一个目录）与 `docs/api/working/routemap.json` 逐字段 0 差异；公开、可选、验签路由与黄金文件一致；`x-step-up: skip` 与约定 C86 的登记表一致；路径里的资源段与资源登记一致。只读文件，不连库。改接口要同一个 PR 改契约、路线图与分组文档。口径见 [脚本](packages/contract/scripts/docs-check.ts) 开头的注释与 [README](infra/ci/README.md) 第 7 节 |
| `node infra/ci/landed.mjs --report`（`--check` 与基线比；`--require M0,M1` 核对里程碑清零） | 已落地判定与待落地清单：按里程碑分组列出还没落地的 V1.0 接口与各缺什么；待落地数高于基线 `infra/ci/landed-baseline.txt` 即失败。见 [README](infra/ci/README.md) 第 7 节 |
| `node infra/ci/plan-routes.mjs --check`（`--write` 重写；`--summary <文件>` 出逐条的归属汇总） | 计划 第 8.2 节的表由路由清单生成：V1.0 的接口都有里程碑，表与清单无差异。归属写在 `packages/contract/src/routes/milestones.ts`，改了先跑 `pnpm contract:generate` 再跑 `--write` |
| `node infra/ci/natural-constraints.mjs` | natural 幂等的约束名核对：契约里写的每个约束名在迁移库 `lyx_migrate_check` 里都找得到；只读 |
| `node infra/ci/api-check.mjs` | CI 里跑 `tools/api-check/check.py` 的写法：“表.列”一项连 `lyx_migrate_check`，未核对按失败算；通过后重新生成三份登记文档（`docs/api/registry-*.md`）并 `git diff --exit-code` |
| `pnpm stack:build` | 构建本地整套环境的三个镜像 `liyoxi/{server,gateway,mediatool}:local`（三个同时构建）。要本机 Docker 与外网，第一次十来分钟。镜像里有什么见 [README](infra/docker/server/README.md) |
| `pnpm stack:up`（加 `--build` 先重建镜像；加 `--lan` 真机走局域网） | 一条命令起整套：依赖没起先起、镜像不在先构建、建库 `lyx_stack`、用 server 镜像跑迁移与播种、起 `lyx-gateway`、`lyx-api`、`lyx-worker`、`lyx-mediatool` 四个容器，都健康才返回。可以反复跑。后台在 `http://admin.localhost:8080`。整套只起一份，各 worktree 共用；用法与可调的环境变量见 [README](infra/stack/README.md) |
| `pnpm stack:smoke`（直接跑脚本时加 `--image-only` 只看 server 镜像、`--inspect-only` 只核对容器约束） | 整套环境的冒烟：镜像的内容、经网关的探活与静态资源、域名隔离、请求体上限、mediatool 的套接字、容器约束。要先 `pnpm stack:up`。见 [README](infra/stack/README.md) 第 5 节 |
| `pnpm stack:down`（加 `--reset` 另删库 `lyx_stack`、共享卷与本环境在 Redis 里的键） | 只停整套环境的四个容器；卷与库保留，依赖的三个容器不动。`--reset` 遇到不以 `lyx_` 开头的库名、校验库、测试库拒绝执行 |
| `pnpm --filter @liyoxi/services exec vitest run src/kernel/assembly/ src/assembly.test.ts` | 只跑服务装配的用例：两个样例模块在 api、worker 两个入口都能收集到，重名与缺实现启动失败，按环境过滤（`envs`），组合根的入口清单与模块目录对账。用例不碰库，命令照样要带 `DATABASE_URL`（services 的全局准备要它）。模块怎么登记、端口怎么用见 [README](packages/services/src/kernel/assembly/README.md) |
| `pnpm --filter @liyoxi/services exec vitest run src/security/ src/audit/` | 只跑敏感字段与审计的用例：字段加密与密钥轮换、盲索引在真库里等值查、三件套与启动自检；`audit.record` 的同事务、只追加、规范化、每日校验，性质测试（固定种子、每个性质 200 轮，每轮真写一行）。连真库。密钥用现造的假密钥，不读文件。用法、密钥文件的格式、种子与轮次的改法见 [security](packages/services/src/security/README.md)、[audit](packages/services/src/audit/README.md) 两份 README |
| `pnpm --filter @liyoxi/services exec vitest run src/events/` | 只跑 events（出站事件）的用例：emit 的去重、同事务、信封与载荷校验，事件行只许写一次，按订阅者展开，展开双跑的并发测试，订阅者登记对照契约，`events.I8`，聚合类型自检。都连库，要本地的 PostgreSQL 与 `DATABASE_URL`。怎么发事件、订阅者怎么登记见 [README](packages/services/src/events/README.md) |
| `pnpm --filter @liyoxi/services exec vitest run src/timers/ src/sla/ src/kernel/ports/` | 只跑定时器、时限与五个端口的用例：`arm` 的状态机表与并发登记、改期与按前缀取消、周期任务补登记与栅格时刻的性质测试、登记对照契约、跨节假日的时限与时限快照、端口没人实现时走空实现。除 `schedule`、`registry` 两份外都要本地的 PostgreSQL 与 `DATABASE_URL`。用法见 [timers](packages/services/src/timers/README.md)、[sla](packages/services/src/sla/README.md)、[ports](packages/services/src/kernel/ports/README.md) 三份 README |
| `pnpm --filter @liyoxi/services exec vitest run src/flow/` | 只跑 flow（状态迁移）的用例：迁移表逐行驱动、同事务、非法迁移被拒、锁序、审计恰一行、事件的三个迁移键、工作分钟端口、`flow.I12` 与状态列自检，两条连接同迁一个对象的并发测试，随机事件序列的性质测试（固定种子、200 轮）。连真库。用法、状态机怎么登记、种子与轮次的改法见 [README](packages/services/src/flow/README.md) |
| `pnpm db:seed` | 播种：对 `DATABASE_URL` 指的、跑完迁移的库，把缺的初始行插进去（8 个角色、通知场景与通道绑定、开关、字典、清单模板、协议清单、订阅槽位、短信模板、价目初始行、估值口径、工作日历、站点配置初始版），再跑六条配置类不变量的断言，有违规即非 0 退出。没有才插、已有的行不改，可以反复跑；测试库不带种子。用法见 [脚本](packages/services/scripts/seed.ts) 与 [运行器](packages/services/src/seed.ts) 开头的注释 |
| `pnpm --filter @liyoxi/api build` | api 的构建：出 `apps/api/dist/server.js` 与 `check-env.js`（`@liyoxi/*` 内联，第三方包运行时解析），构建完核对产物引到的第三方包都已在 `apps/api/package.json` 里声明。起它：`node apps/api/dist/server.js --port 3000`（要连接参数）。见 [README](apps/api/README.md) 第 5 节 |
| `pnpm exec vitest run --project api` | 只跑 `apps/api` 的用例（也在 `pnpm test` 里）：接口层、幂等、声明即挂载、探活、构建产物起得来；顺带写出已挂载清单 `apps/api/dist/mounted-operations.json`（`node infra/ci/landed.mjs` 读它）。要连接参数。接口测试支架的用法见 [README](apps/api/README.md) 第 2 节与 `apps/api/src/testing/index.ts` 开头的注释 |
| `pnpm test:db:seeded`（加 `--name <库名>` 换一个 `lyx_test_` 开头的名字） | 一条命令得到带种子的干净库：建一个测试库（已存在即删掉重建），跑全部迁移与 `pnpm db:seed` 的种子，核对六条断言，打印库名。要本地的 PostgreSQL 与 `DATABASE_URL`；演示、手工排查用，用完 `pnpm test:db:prune`。测试文件里要带种子的库写 `useSeededDatabase("<包>")`，造数据用 `createFactories`，都从 `@liyoxi/services/testing` 引：见 [README](packages/services/src/testing/data/README.md) |
| `pnpm weapp:build` | 出小程序包 `apps/weapp/dist/`，由模板生成 `project.config.json`（不入库），再过体积门禁；超限即失败。AppID、接口基址等经环境变量给，都有缺省，不读 `.env`。见 [README](apps/weapp/README.md) |
| `node infra/ci/check-mp-size.mjs apps/weapp/dist` | 小程序体积门禁：主包 ≤1,500KB、各分包 ≤800KB，打印各包体积。口径见 [脚本](infra/ci/check-mp-size.mjs) 开头的注释 |
| `pnpm --filter @liyoxi/weapp test` | 小程序的用例：请求层、四个端上封装、页面清单，在 Node 里跑。根上的 `pnpm test` 不含它。只跑一个文件时后面加路径，如 `src/lib/request.test.ts` |
| `pnpm weapp:shots`（只出一页加 `-- --page pages/home/index`） | 小程序页面截图：出一份 H5 构建，用 Chromium 按 375 宽给已建的页各截一张，产物在 `apps/weapp/shots/dist/png/`。本机没装 Playwright 自带的浏览器时前面加 `LYX_E2E_CHANNEL=chrome`。H5 是近似，与真机的差异见 [README](apps/weapp/README.md) 末节 |
| `pnpm weapp:shots -- --component Button`（可给多次） | 只出某个组件的预览图 `apps/weapp/shots/dist/png/gallery__<组件名>.png`（整页）。不带参数时，页面之外另给组件陈列的目录页与每个组件各出一张。组件名是 `apps/weapp/src/components/` 下的目录名。见 [README](apps/weapp/README.md)“通用组件” |
| `WEAPP_GALLERY=1 pnpm weapp:build` | 出带组件陈列分包（`sub/gallery`，开发用）的小程序包，看样时用；同样过体积门禁。不给这个变量时，生产的小程序包不带陈列分包（H5 截图构建与开发构建一律带） |
| `pnpm exec vitest run --project api test/rate-limit.test.ts test/pipeline.test.ts` | 只跑限流与装配顺序的用例：超限 429 带 `Retry-After`、停掉 Redis 后降级（用故障注入的转发口，不动共享的 Redis）、路由级中间件的先后只在 `apps/api/src/routing/pipeline.ts` 一处定义。要连接参数（含 `REDIS_URL`）。加一件中间件、加档位与调额度的做法见 [README](apps/api/README.md) 第 3.1、3.2 节 |
| `pnpm status-tone:check` | 状态字典键与契约枚举同名：状态色调字典（`packages/shared/src/design/status-tone`）里写了“表.列”的条目，那一列在契约里绑定了枚举，取值都在枚举的取值之内，一处不符即非 0 退出。只读文件，不连库。字典加条目、契约改枚举取值之后跑它。口径见 [脚本](packages/shared/scripts/status-tone-check.ts) 开头的注释 |
| `pnpm --filter @liyoxi/admin dev`（看样：浏览器开 `http://localhost:5183/dev/showcase`） | 后台的开发服务器（端口 5183，带样例页与夹具，不用起 api）。陈列页（看样页）把构件、设计变量、状态取色、图标照规范的章节逐组摆出来；它的截图随 `pnpm admin:e2e` 出在 `apps/admin/dist/e2e-shots/showcase-*.png`。见 [README](apps/admin/README.md)“陈列页” |
| `pnpm weapp:shots -- --sheet colors`（可给多次） | 只出小程序陈列里某张基础样张的图 `apps/weapp/shots/dist/png/gallery__sheet-<样张名>.png`（颜色、文字、间距圆角、状态取色表）。不带参数时每张各出一张。看样怎么看见 [看样清单](docs/plan/sample-review/W0-29.md) |
| `pnpm --filter @liyoxi/services exec vitest run src/ops/`（任务进程里的那一份：`pnpm --filter @liyoxi/worker exec vitest run test/ops-jobs.test.ts`） | 只跑不变量与清理框架的用例：带种子的库上 full 0 违规、人为造一条违规能发现并去重、三种自愈策略、上报端口、清理的限量与出错隔离；真实装配里的三个周期任务（`invariant.full`、`invariant.quick`、`ops.retention`）经任务进程跑。除一份外都连库，要本地的 PostgreSQL 与 `DATABASE_URL`，任务进程的那一份另要 `REDIS_URL`。检查项与清理项怎么登记、手工跑一次（`runInvariants`）怎么调，见 [README](packages/services/src/ops/invariants/README.md) |
| `pnpm lint:copy` | 文案约束：规范 第 11 节的词不出现在规则管的页面源码、页面标题与错误码的默认文案里（第一版只有“登录相关文案不出现‘微信’”一条）；命中时指出文件、行与规则。只读文件，不连库。规则表 [copy-rules.json](infra/ci/copy-rules.json)，页面包加规则照它开头的“说明”；口径见 [脚本](infra/ci/check-copy.mjs) 开头的注释 |
| `pnpm --filter @liyoxi/services exec vitest run src/authz/` | 只跑 authz（后台判定与数据范围）的用例：8 角色 × 13 模块与每个权限点的表驱动、性质测试（固定种子、每个性质 200 轮）、范围谓词；连库的一份要本地的 PostgreSQL 与 `DATABASE_URL`。`authorize`、`assertConfirm`、`scopeOf` 与范围谓词怎么用，轮次与种子怎么改，见 [README](packages/services/src/authz/README.md) |
| `pnpm --filter @liyoxi/services exec vitest run src/docs/ src/tenant/` | 只跑 docs（协议的当前版本、同意记录、待同意与指纹、已签署协议、占位版本）与 tenant（建主体、成员关系解析、门店列表与额度、资质结论的三个写函数）的用例。连库的走带种子的测试库，要本地的 PostgreSQL 与 `DATABASE_URL`。两个模块各有一个装配入口 `createDocs`、`createTenant`，用法见 [docs](packages/services/src/docs/README.md)、[tenant](packages/services/src/tenant/README.md) 的 README；商家读侧的事实端口见 [kernel/ports](packages/services/src/kernel/ports/README.md) |

本地连接参数：配置只经 `loadEnv`（`packages/services/src/kernel/env.ts`）读环境变量，会话与测试不建、不读 `.env`，在命令前或 shell 里给出。取值出处是 [local.yml](infra/compose/local.yml)，账号与口令是固定的开发值，只对本机这套容器有效；CI 的服务容器用同一组值。

```sh
export APP_ENV=local   # 测试里写 test；stg、prod 下连接串只认 *_FILE
export DATABASE_URL=postgresql://liyoxi:lyx-local-dev@localhost:5442/liyoxi
export REDIS_URL=redis://localhost:6389/0
```

计划已定名、要等对应工作包合并后才有：

| 命令 | 由谁提供 | 做什么 |
| --- | --- | --- |
| `pnpm demo:m0` | W0-30 | 一条命令重放 M0 样例用例 |
| `pnpm demo:mN` | 各里程碑的合流包 | 重放该里程碑演示 |
| `contract:compat` | M2 起 | 契约对在役小程序版本兼容 |
| 小程序截图命令（可能是 `pnpm weapp:shots`） | W0-27a | 出页面截图；办法由该包定 |

其余命令（安装、起环境、lint、测试、构建）由提供它的工作包同 PR 补进本节。本节没列的命令不要假定存在。默认：每个包只往本节加命令行；用法、参数、连接方式写进各自的 README，本节链过去（W0-04 定）。

## 10. 文档与代码不漂移

出处：08 第 5.7 节。原则：代码为准；文档同 PR 跟随；CI 对账。

| 改什么 | 同一个 PR 里还要改 |
| --- | --- |
| 表结构与约束 | 迁移、结构快照、分组文档。走结构变更包，单独成 PR |
| 枚举 | 契约先声明，下一版再写入；库 CHECK 的取值集合与契约一致 |
| 状态机 | `packages/shared` 的迁移表与分组文档 |
| 接口 | 契约、`docs/api/working/routemap.json`、分组文档 |
| 结构字段 | 类型以 Zod 为准，文档跟随 |
| 登记表（错误码、权限点、事件、定时器等） | 一个模块一个文件；汇总由脚本生成，不手抄 |
| 种子 | 由契约注册表生成，不手抄 |
| 接口、页面、x01 条目的里程碑归属 | `docs/plan/changes/` 记一条 |
| 默认做法 | 先改文档里的默认，再改代码 |

默认（W0-04 定；数据模型一侧已接管，W0-06b 改）：改 `docs/data-model/` 的分组文档后跑 `python3 tools/schema-check/check.py`，它比的是迁移后的库；草稿 `schema.prisma` 与 `constraints/` 已冻结，不改。改表结构照 [infra/ci/README.md](infra/ci/README.md) 第 8.3 节的单子：新迁移、`pnpm db:snapshot` 重出快照、06 第 1 节的数量、分组文档、授权的期望。`docs/api/` 在 W0-10 合并前，改后仍跑 `python3 tools/api-check/check.py`。

## 11. 待确认事项与文档有错

| 情况 | 做法 | 出处 |
| --- | --- | --- |
| 遇到待确认事项（07 第 8 节、06 第 7 节、规范 第 14 节、05 第 2.3、3.3 节、D7 第 16 节） | 按文档写的默认实现，不阻塞，不向业主追问；PR 描述列出用到的默认项编号 | 08 第 3 节 ⑤、第 4.3 节 |
| D7 第 16 节里不按其自身默认的几项 | 按 08 第 4.3 节的裁决 | 08 第 4.3 节 |
| 阻塞性决定（Q1–Q13） | 按 08 第 4.2 节的“默认”列；Q1、Q12 已答复按默认，Q12 里“谁合并”一项后来改了（第 7 节）；Q9 须业主明确答复 | 08 第 4.2 节 |
| 业主结论与默认相反 | 开“变更工作包”：先改文档里的默认，再改代码，同一个 PR | 08 第 4.3、13 节 |
| 发现文档有错或互相矛盾 | 以查实的事实为准；同 PR 回写文档；PR 描述与状态文件列“偏差”，简短写。要回写的文档不在任务书允许的目录里，照回写并记一句（第 3 节第 6 步） | 08 第 3 节 ⑨、第 5.3 节“会话”行 |
| 文档没写、又必须定 | 选最贴近 01–07 的做法，在 PR 描述与状态文件“偏差”里记一句；业主事后看，不等确认 | — |
| 计划要改 | 小改：改 08 并在 `docs/plan/changes/` 记一条，由调度会话定并合并。大改（里程碑范围、退出条件、前提）：PR 标 `plan-change`，须业主确认 | 08 第 13 节 |

本文件的改动：命令与共享环境用法由提供它的工作包同 PR 补充；其余内容改动由调度会话定并合并，合并评论里列出，业主事后过目。要放宽第 6 节硬性规则、密钥与 `.env` 的规则，先问业主（`docs/plan/README.md` 第 3.5 节第 5、9 项）。
