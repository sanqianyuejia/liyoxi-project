# 狸有戏（liyoxi）会话开工须知

每个开发会话自动读到本文件。它是开工的唯一入口。细则在所引文档里，本文只写总纲与出处。

## 1. 项目与当前阶段

- 一句话：面向本地生活商家的短剧营销工具。V1.0 交付商家端微信小程序、运营后台、电脑端下载页。
- 阶段：开发计划已获业主确认（Q1、Q12 均按默认，Q12 里“谁合并”一项后来改了，见第 7 节；出处：`docs/plan/owner-checklist.md` 第 3 节 Q1、Q12 两行）。处在 M0“最小地基”，第一个工作包是 W0-04（协作规范，纯文档）。
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
| 任务书与 01–07 或 08 | 默认：01–07、08 为准，停下报告，不自行取舍（W0-04 定） | — |

## 3. 会话怎么开工

固定提示语：“读 `CLAUDE.md` 与 `docs/plan/tasks/<编号>.md`，完成工作包 <编号>”（08 第 5.3 节）。

1. 读本文件、状态汇总、本包任务书。会话不带记忆，只凭这三样开工。状态汇总不入库：在最新 main 的检出里跑 `pnpm status:summary` 现生成，写到 `docs/plan/status/SUMMARY.md`（被 git 忽略；它是生成那一刻的快照，与单个状态文件不一致时以单个文件为准，重新跑一遍即可）。
2. 核对任务书“依赖”列的包已全部合并：main 上该包的状态文件写“完成”即已合并。上游未合并，不得基于其分支开工。
3. 任务书不存在时分两种。`docs/plan/tasks/README.md` 第 3 节列的 13 个 S、M 包：按 08 第 7.2 节的清单行与任务书模板补全，先查该 README 第 5 节的移交表，随 PR 提交。L 与甲类包：停下报告，不自己写。
4. 一个会话一个工作包，在独立 worktree 里做，从最新 main 切分支。
5. 只改任务书允许的目录；只新增任务书允许的依赖。
6. 超出范围即停并报告。默认：把原因写进本包状态文件的“阻塞原因”，并在回复里说明（W0-04 定）。
7. 先交付可读的中间成果，再做完整。默认：长时间没有产出就停下汇报，不空转（W0-04 定）。
8. 收尾：把 `docs/plan/status/<编号>.md` 的状态写成“完成”（取值见 `docs/plan/status/README.md` 第 3 节），开 PR 后填上 PR 编号；按 PR 模板填描述。只改自己这一个状态文件，状态汇总不用生成、不用提交。会话不自行合并，合并由调度会话做（第 7 节）。

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
| 粒度 | 一个工作包一个 PR。体量上限（默认）：甲类一个机制、非生成非测试代码约 600 行；乙类 20 条接口；丙类 8 页。超过即拆 a、b |
| 契约先行 | 一个域的 Zod 结构随该域第一个后端 PR 合入；页面包在契约合入后开工 |
| PR 描述 | 按模板填全：工作包编号；依据；改了什么；怎么验（命令 + 判据，证据链接到 CI 运行或产物，不贴文本）；演示步骤或截图；用到的默认项编号；留桩与偏差；回写了哪些文档；门禁改动清单；借用清单 |
| 评审分级 | 甲（内核、账本、入账、权限与字段裁剪、迁移、回调验签）：不与其他改动混合，附性质或并发测试输出。乙：看验收输出与默认项清单。丙：看截图与清单。各包级别见 08 第 7.1 节 |
| 门禁改动 | “只增”类随工作包 PR，CI 打 `gate-touch`。“放松”类只在单独 PR 里改，标 `gate-change`，业主必看 |
| 单独成 PR | 依赖升级；首版之后的结构变更（同一时刻只允许一个在途）；契约的破坏性变更 |
| 复审与合并 | 会话不自行合并，不给自己的 PR 打 `agent-reviewed`。阻断项只有四类：超出任务书范围；验收缺证据；门禁被放松；与依据文档不符。合并由调度会话做（业主的结论，Q12 的这一项不再按默认）；新开的会话要代合并，须业主在那个会话里明说。合并条件（调度会话照业主选的“简单口径”写的）：CI 的 `required` 在“已与 main 同步”的提交上为绿 + 独立复审无阻断项且全文已贴在 PR 评论，复审的提交就是合并的提交 + PR 不是草稿、描述与状态文件已填全。六类 PR 另要业主先说“同意”才合并：门禁放松（`gate-change`）；计划、规则与 `CLAUDE.md` 变更（`plan-change`、改本文件命令与共享环境用法以外的内容、改合并规则本身）；只有业主能解的阻断项；看样；甲类；服务器与发布。只增类门禁改动（`gate-touch`）不因此要等业主，调度会话在合并评论里逐项列出，业主事后看。这里是缩写，有出入时以 `docs/plan/README.md` 第 3.5 节为准。必过检查与“合并前与 main 同步”已由平台强制，对管理员同样生效。复审、维护会话、标签的细则见 `docs/plan/README.md` 第 3 节 |

## 8. 测试与门禁要点

出处：08 第 5.4、5.5、10.1 节。

| 项 | 要点 |
| --- | --- |
| 验收 | 一律“命令 + 判据”；证据只认 CI 运行或产物的链接。默认：CI 就绪（W0-03 合并）前，证据按任务书写的办法给（命令与输出贴 PR 评论，描述里链接），复审会话重跑并写结果，W0-03 的首次 CI 运行补证（W0-04 定） |
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
| `python3 tools/schema-check/check.py`（加 `--keep` 保留校验库） | 校验数据模型草稿自洽。见 [README](tools/schema-check/README.md) |
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
| `pnpm db:catalog-diff` | 系统目录比对：由底稿建的参照库 `lyx_schema_check` 与迁移库 `lyx_migrate_check` 的表、列、约束定义、索引定义、触发器、函数体逐项 0 差异，数量两组口径对得上；出报告。两个库怎么建、参数与口径见 [README](packages/db/README.md) 第 6 节。它的用例（`infra/ci/test/db-*.test.ts`）与 `gates:selftest` 里它的反例也要连本地的 PostgreSQL，各建各的临时库，用完删掉 |
| `pnpm db:verify-managed` | 托管库验证：对 `DATABASE_URL` 指的、`lyx_` 开头的空库报告两个扩展可建、迁移跑通、计数表；不打印连接串。业主在托管库到位时跑；本地演练的做法见 [README](packages/db/README.md) 第 7 节 |
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
| `pnpm weapp:build` | 出小程序包 `apps/weapp/dist/`，由模板生成 `project.config.json`（不入库），再过体积门禁；超限即失败。AppID、接口基址等经环境变量给，都有缺省，不读 `.env`。见 [README](apps/weapp/README.md) |
| `node infra/ci/check-mp-size.mjs apps/weapp/dist` | 小程序体积门禁：主包 ≤1,500KB、各分包 ≤800KB，打印各包体积。口径见 [脚本](infra/ci/check-mp-size.mjs) 开头的注释 |
| `pnpm --filter @liyoxi/weapp test` | 小程序的用例：请求层、四个端上封装、页面清单，在 Node 里跑。根上的 `pnpm test` 不含它。只跑一个文件时后面加路径，如 `src/lib/request.test.ts` |
| `pnpm weapp:shots`（只出一页加 `-- --page pages/home/index`） | 小程序页面截图：出一份 H5 构建，用 Chromium 按 375 宽给已建的页各截一张，产物在 `apps/weapp/shots/dist/png/`。本机没装 Playwright 自带的浏览器时前面加 `LYX_E2E_CHANNEL=chrome`。H5 是近似，与真机的差异见 [README](apps/weapp/README.md) 末节 |
| `pnpm weapp:shots -- --component Button`（可给多次） | 只出某个组件的预览图 `apps/weapp/shots/dist/png/gallery__<组件名>.png`（整页）。不带参数时，页面之外另给组件陈列的目录页与每个组件各出一张。组件名是 `apps/weapp/src/components/` 下的目录名。见 [README](apps/weapp/README.md)“通用组件” |
| `WEAPP_GALLERY=1 pnpm weapp:build` | 出带组件陈列分包（`sub/gallery`，开发用）的小程序包，看样时用；同样过体积门禁。不给这个变量时，生产的小程序包不带陈列分包（H5 截图构建与开发构建一律带） |

本地连接参数：配置只经 `loadEnv`（`packages/services/src/kernel/env.ts`）读环境变量，会话与测试不建、不读 `.env`，在命令前或 shell 里给出。取值出处是 [local.yml](infra/compose/local.yml)，账号与口令是固定的开发值，只对本机这套容器有效；CI 的服务容器用同一组值。

```sh
export APP_ENV=local   # 测试里写 test；stg、prod 下连接串只认 *_FILE
export DATABASE_URL=postgresql://liyoxi:lyx-local-dev@localhost:5442/liyoxi
export REDIS_URL=redis://localhost:6389/0
```

计划已定名、要等对应工作包合并后才有：

| 命令 | 由谁提供 | 做什么 |
| --- | --- | --- |
| `contract:docs-check` | W0-10 | 路由元数据与 routemap.json 逐字段对账 |
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

默认（W0-04 定）：接管之前（W0-05、W0-10 合并前），改 `docs/data-model/` 或 `docs/api/` 后跑第 9 节的两个校验工具。

## 11. 待确认事项与文档有错

| 情况 | 做法 | 出处 |
| --- | --- | --- |
| 遇到待确认事项（07 第 8 节、06 第 7 节、规范 第 14 节、05 第 2.3、3.3 节、D7 第 16 节） | 按文档写的默认实现，不阻塞，不向业主追问；PR 描述列出用到的默认项编号 | 08 第 3 节 ⑤、第 4.3 节 |
| D7 第 16 节里不按其自身默认的几项 | 按 08 第 4.3 节的裁决 | 08 第 4.3 节 |
| 阻塞性决定（Q1–Q13） | 按 08 第 4.2 节的“默认”列；Q1、Q12 已答复按默认，Q12 里“谁合并”一项后来改了（第 7 节）；Q9 须业主明确答复 | 08 第 4.2 节 |
| 业主结论与默认相反 | 开“变更工作包”：先改文档里的默认，再改代码，同一个 PR | 08 第 4.3、13 节 |
| 发现文档有错或互相矛盾 | 以查实的事实为准；同 PR 回写文档；PR 描述与状态文件列“偏差”。默认：要回写的文档不在任务书允许的目录里，就停下报告，不自行扩大范围（W0-04 定） | 08 第 3 节 ⑨、第 5.3 节“会话”行 |
| 文档没写、又必须定 | 默认：选最贴近 01–07 的做法，在 PR 描述“偏差”里写明并请业主确认（W0-04 定） | — |
| 计划要改 | 小改：改 08 并在 `docs/plan/changes/` 记一条。大改：PR 标 `plan-change`，须业主确认 | 08 第 13 节 |

本文件的改动：命令与共享环境用法由提供它的工作包同 PR 补充；其余内容改动须业主过目（默认，W0-04 定）。
