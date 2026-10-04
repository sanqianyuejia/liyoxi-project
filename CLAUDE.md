# 狸有戏（liyoxi）会话开工须知

每个开发会话自动读到本文件。它是开工的唯一入口。细则在所引文档里，本文只写总纲与出处。

## 1. 项目与当前阶段

- 一句话：面向本地生活商家的短剧营销工具。V1.0 交付商家端微信小程序、运营后台、电脑端下载页。
- 阶段：开发计划已获业主确认（Q1、Q12 均按默认；出处：`docs/plan/owner-checklist.md` 第 3 节 Q1、Q12 两行）。处在 M0“最小地基”，第一个工作包是 W0-04（协作规范，纯文档）。
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

1. 读本文件、状态汇总、本包任务书。会话不带记忆，只凭这三样开工。状态汇总在 `docs/plan/status/README.md` 第 6 节（手工表；与单个状态文件不一致时以单个文件为准），W0-03 合并后是 `docs/plan/status/SUMMARY.md`。
2. 核对任务书“依赖”列的包已全部合并：main 上该包的状态文件写“完成”即已合并。上游未合并，不得基于其分支开工。
3. 任务书不存在时分两种。`docs/plan/tasks/README.md` 第 3 节列的 13 个 S、M 包：按 08 第 7.2 节的清单行与任务书模板补全，先查该 README 第 5 节的移交表，随 PR 提交。L 与甲类包：停下报告，不自己写。
4. 一个会话一个工作包，在独立 worktree 里做，从最新 main 切分支。
5. 只改任务书允许的目录；只新增任务书允许的依赖。
6. 超出范围即停并报告。默认：把原因写进本包状态文件的“阻塞原因”，并在回复里说明（W0-04 定）。
7. 先交付可读的中间成果，再做完整。默认：长时间没有产出就停下汇报，不空转（W0-04 定）。
8. 收尾：把 `docs/plan/status/<编号>.md` 的状态写成“完成”（取值见 `docs/plan/status/README.md` 第 3 节），开 PR 后填上 PR 编号；按 PR 模板填描述。会话不自行合并。

待评审的非草稿 PR 到上限（默认 5 个）不开新包（08 第 3 节 ⑥、第 5.3 节）。

默认：随 W0-04 交付的 27 份任务书，W0-04 的 PR 合并即视为业主已过目，头部写的“业主已过目：否”不挡开工（W0-04 定）。

## 4. 技术栈固定表

出处：08 第 5.2 节；[02](docs/02-tech-selection.md) 第 5 节；ADR-035。全部写精确版本并提交锁文件；CI 用 `--frozen-lockfile`；关闭安装脚本，只放行白名单；依赖须发布满 7 天。补丁号由 W0-01 按同一规则重取。

| 层 | 版本 | 不能装的 |
| --- | --- | --- |
| 运行时 | Node 24（≥24.19）；pnpm 10.34.5；TypeScript 5.9.3 | TypeScript 7、pnpm 12 |
| 服务端 | Hono 4.13 + @hono/zod-openapi 1.6；Zod 4.6；Prisma 7.10.0（三包同版）；PostgreSQL 17；BullMQ 6.3 + Redis 7；@react-pdf/renderer 4.9；write-excel-file 4.1 | Prisma 8 候选版、xlsx |
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
| 复审与合并 | 会话不自行合并，不给自己的 PR 打 `agent-reviewed`。阻断项只有四类：超出任务书范围；验收缺证据；门禁被放松；与依据文档不符。合并条件：CI 在“已与 main 同步”的提交上全绿 + 复审无阻断项 + 业主本人点合并（Q12 按默认）。档位升级与 E15 ③ 完成前平台不强制必过检查与同步，由业主合并前人工核对。复审、维护会话、标签的细则见 `docs/plan/README.md` 第 3 节 |

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
| 测试库 | 隔离单位是“库”：每个会话、每个 Vitest worker 一个 `lyx_test_<包>_<n>`；守卫只认 `lyx_test_` 前缀；重置 = 删库重建 |
| Redis 与 Compose | Redis 按会话分库号或键前缀，“清空”只清自己的。Compose 只起一份共享实例，多个 worktree 共用（用法由 W0-05b 补进本文） |
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
| `pnpm gates:selftest` | 门禁自测：对固定的反例逐个跑对应的检查，断言检查失败且原因对得上。其中三例要外部条件：两例要 Docker，一例要外网。怎么加反例见 [README](infra/ci/README.md) 第 4 节 |
| `pnpm status:summary` | 重新生成状态汇总 `docs/plan/status/SUMMARY.md`。改了状态文件就跑一次并提交 |
| `node infra/ci/check-env-example.mjs` | 核对 `.env.example`：键集合等于 `loadEnv` 的键集合，值都是占位 |
| `node infra/ci/classify-gate-changes.mjs --base origin/main` | 本地试跑门禁改动分类：看本分支的改动会被判成只增还是放松。口径见 [README](infra/ci/README.md) 第 5 节 |
| `pnpm lint`（`pnpm lint:fix` 自动修） | ESLint。规则片段在 `packages/config/eslint/`，装配在根 `eslint.config.js` |
| `pnpm format:check`（`pnpm format` 改写） | Prettier 格式检查。不碰 `docs/`、`design/`、`tools/` 与全部 `*.md` |
| `pnpm typecheck` | 类型检查：根、`infra`、五份 tsconfig 预设的最小工程（见 [README](infra/ci/fixtures/README.md)）、各工作区包 |
| `pnpm test` | Vitest。项目：`packages/*`、`apps/api`、`apps/worker`、`infra` |
| `pnpm --filter @liyoxi/shared test` | 只跑 `packages/shared` 的用例：PRD 2.9 七例、锚定日、工作日、金额格式化，性质测试（固定种子、每个性质 200 轮），导出自测与静态扫描，另在两个进程时区下重跑一遍。种子与轮次的改法见 [vitest.config.ts](packages/shared/vitest.config.ts) 开头的注释 |
| `pnpm depcheck` | 依赖方向与分层检查：先核对分层登记（`node infra/ci/check-layers.mjs`，可单独跑），再对全仓跑 dependency-cruiser。规则见 [.dependency-cruiser.cjs](.dependency-cruiser.cjs) 开头的注释；模块的层与同层白名单在 [layers.json](infra/ci/layers.json)；反例夹具见 [README](infra/ci/fixtures/layers/README.md) |
| `pnpm check:rename` | 换名检查：出现参考工程的旧名或旧的小程序目录即失败。口径见 [脚本](infra/ci/check-rename.mjs) 开头的注释 |
| `node infra/ci/check-release-age.mjs`（加 `--since <git 引用>` 只查新增的版本） | 锁文件里每个版本都发布满 7 天。用法见 [脚本](infra/ci/check-release-age.mjs) 开头的注释 |

本地连接参数：配置只经 `loadEnv`（`packages/services/src/kernel/env.ts`）读环境变量，会话与测试不建、不读 `.env`，在命令前或 shell 里给出。取值出处是 [local.yml](infra/compose/local.yml)，账号与口令是固定的开发值，只对本机这套容器有效；CI 的服务容器用同一组值。

```sh
export APP_ENV=local   # 测试里写 test；stg、prod 下连接串只认 *_FILE
export DATABASE_URL=postgresql://liyoxi:lyx-local-dev@localhost:5442/liyoxi
export REDIS_URL=redis://localhost:6389/0
```

计划已定名、要等对应工作包合并后才有：

| 命令 | 由谁提供 | 做什么 |
| --- | --- | --- |
| `contract:check` | W0-08 | 契约生成物与源码无差异 |
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
| 阻塞性决定（Q1–Q13） | 按 08 第 4.2 节的“默认”列；Q1、Q12 已答复按默认；Q9 须业主明确答复 | 08 第 4.2 节 |
| 业主结论与默认相反 | 开“变更工作包”：先改文档里的默认，再改代码，同一个 PR | 08 第 4.3、13 节 |
| 发现文档有错或互相矛盾 | 以查实的事实为准；同 PR 回写文档；PR 描述与状态文件列“偏差”。默认：要回写的文档不在任务书允许的目录里，就停下报告，不自行扩大范围（W0-04 定） | 08 第 3 节 ⑨、第 5.3 节“会话”行 |
| 文档没写、又必须定 | 默认：选最贴近 01–07 的做法，在 PR 描述“偏差”里写明并请业主确认（W0-04 定） | — |
| 计划要改 | 小改：改 08 并在 `docs/plan/changes/` 记一条。大改：PR 标 `plan-change`，须业主确认 | 08 第 13 节 |

本文件的改动：命令与共享环境用法由提供它的工作包同 PR 补充；其余内容改动须业主过目（默认，W0-04 定）。
