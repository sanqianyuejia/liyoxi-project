# 任务书（tasks）

依据：[开发计划](../../08-development-plan.md) 第 5.3 节“任务书”“怎么运转”“会话”行、第 7.2 节 W0-04 与 W0-31 两行、第 7.3 节 W1-23 一行、第 7.4、7.5、12 节。

## 1. 用途

| 项 | 规则 | 出处 |
| --- | --- | --- |
| 是什么 | 每个工作包开工前有一份自包含的任务书 | 计划 第 5.3 节 |
| 写什么 | 目标、依据（文件 第 N 节）、依赖、允许改动的目录、不做什么、验收命令；写明本包允许新增的依赖 | 计划 第 5.3 节 |
| 验收 | 一律“命令 + 判据”。计划表里没写命令的，由任务书补上；需要人工的只有看样与演示点，写清业主的操作步骤 | 计划 第 7.1 节 |
| 文件名 | `docs/plan/tasks/<编号>.md`，与状态文件同名 | 计划 第 5.3 节 |
| 怎么用 | 会话不带记忆，只凭任务书、`CLAUDE.md` 与状态汇总开工。固定提示语：“读 `CLAUDE.md` 与 `docs/plan/tasks/<编号>.md`，完成工作包 <编号>” | 计划 第 5.3 节 |
| 范围 | 会话只改任务书允许的目录；超出范围即停并报告 | 计划 第 5.3 节 |
| 两种写法 | S、M 包可以是“清单行 + 模板补全”；L 与甲类包单独成文，业主过目 | 计划 第 5.3 节 |
| 模板 | [任务书模板](../templates/task.md)，随 W0-04 交付 | 计划 第 7.2 节 |

## 2. 随 W0-04 交付的任务书（27 份）

| 批 | 工作包 | 份数 | 出处 |
| --- | --- | --- | --- |
| 首批 13 个包里除 W0-04 之外的 12 个 | W0-01、W0-02、W0-03、W0-08、W0-11、W0-26、W0-05、W0-05b、W0-06a、W0-09a、W0-06b、W0-07 | 12 | 计划 第 12 节 |
| M0 其余 L 包 | W0-10、W0-19、W0-23、W0-27a、W0-28 | 5 | 计划 第 7.2 节 |
| M0 其余甲类包 | W0-13、W0-14、W0-15、W0-16、W0-17、W0-20（W0-23 已计入 L 包） | 6 | 计划 第 7.1 节 |
| 四个 X 包 | X-01、X-02、X-03、X-04（X-04 属甲类，单独成文） | 4 | 计划 第 7.4 节 |

- 27 份不含 W0-04 自己的：计划 第 12 节写的是“本表其余 12 个包”。
- 业主过目：`CLAUDE.md`、首批任务书与 X-04 的任务书（计划 第 7.2 节 W0-04 的验收）。业主过目后才开第二个会话（计划 第 12 节）。
- 验收里的一条：W0-01 的会话只凭固定提示语、`CLAUDE.md` 与任务书开工，不向业主追问。
- 默认：这 27 份随 W0-04 的 PR 过目，该 PR 合并即视为业主已过目；头部写的“业主已过目：否，随 W0-04 的 PR 过目”不必逐份回改，不挡开工（W0-04 定）。
- 任务书里写的参考工程路径与固定提交是写任务书时的值，以 [业主清单](../owner-checklist.md) 第 2.2 节为准；该登记是会话代填的，待业主确认。
- 任务书里“没有 CI 时证据怎么给”的写法，与 CI 就绪之前的默认一致（那时[复审模板](../templates/review.md)第 2 节的 B 类；CI 就绪后证据就是 CI 运行），不算与 `CLAUDE.md` 冲突。

随 W0-31 交付的任务书（32 份，另有 W0-31 自己的一份）：

| 批 | 工作包 | 份数 | 出处 |
| --- | --- | --- | --- |
| M1 的 27 个包 | W1-01a、01b、02、03、04、04b、05、06、07、08、09、10、11a、11b、12、13、14、15、16a、16b、17、18、19、20、21、22、23 | 27 | 计划 第 7.3 节 |
| G2-D 的 5 个环境包 | W2-25、W2-26、W2-27、W2-28、W2-29（拆包表在计划 第 7.5 节表后） | 5 | 计划 第 7.5 节 |

- 头部都写“业主已过目：否（按 2026-10-05 业主的要求先开工，事后看）”：不挡开工，也不用回改（[docs/plan/README.md](../README.md) 第 3.5 节）。
- 这 32 份是 M0 还没合流时写的：用到 W0-16、21、22、22b、23、24、25、27b、30 交付物的地方（路由目录、循环登记处、端到端运行器、四个计数与不变量的命令等）写的是“以合并后的为准”，开工时按 main 上的实际再对一遍，对不上的照实际做并在状态文件“偏差”记一句。
- M1 各包共用的口径在第 7 节，每份任务书的“依据”表里都有一行指过去。

## 3. 其余任务书由谁在何时补

| 范围 | 谁写 | 何时 | 出处 |
| --- | --- | --- | --- |
| M0 其余 S、M 包，13 个：W0-07b、W0-09b、W0-12、W0-18、W0-21、W0-22、W0-22b、W0-24、W0-25、W0-27b、W0-29、W0-30、W0-31 | 开工的会话，按计划 第 7.2 节的清单行与模板补全 | 开工时写，随该包的 PR 提交 | 计划 第 5.3 节 |
| M1 的 27 个包 | W0-31（M0 拆包 PR） | 已交付（第 2 节）。计划写 M0 合流（W0-30）之后；调度会话按业主 2026-10-05 的要求提前做了，同时按 M0 的实际情况修正了 M1 的依赖 | 计划 第 7.2 节 |
| 环境泳道提前开工的包：G2-D 的 5 个环境包（含拆包）。G2-E 的 2 个包随生产，不在 W0-31，默认由 M7 交 M8 的拆包 PR 交（ADR-041） | W0-31 | 已交付：W2-25–W2-29（第 2 节） | 计划 第 5.3、7.2 节 |
| M2、M3、M4 的其余各组 | W1-23（M1 拆包 PR） | 编号/全状态及M2 25本由W1-23a交；M3 19本与M4 20本由W1-23b交，有任务书且依赖实际合入才开工 | 计划 第 7.3、7.5 节 |
| G7-A | 挂在 M2 合流包之后的拆包 PR | M2 合流之后 | 计划 第 7.5 节 |
| M5、M6、M7、M8 | M4、M5、M6、M7 各有一个拆包 PR 交下一个里程碑（交 M5 的挂在 M4；M6 的拆包 PR 只交 M7 除 G7-A 外的部分） | 各里程碑合流之后 | 计划 第 7.5 节 |

L 与甲类包的任务书，不论由哪个拆包 PR 交付，都要业主过目（计划 第 7.2 节 W0-31、第 7.3 节 W1-23 的验收）。按 2026-10-05 精简后的做法，过目是事后看，不挡开工（[docs/plan/README.md](../README.md) 第 3.5 节）。

M1 的包不必等 M0 整体退出才开工（2026-10-05，调度会话按业主“尽快把系统开发出来”的要求定，业主可改回；计划 第 6.4 节“进入条件”，[changes/W0-31-m1-early-start-and-deps.md](../changes/W0-31-m1-early-start-and-deps.md)）：某个 M1 包任务书“依赖”里的包全部合并后，这个包就可以开工；状态文件的“依赖”已写成具体编号，`pnpm status:summary` 的“可开工的包”照它算。M0 的退出条件、合流包 W0-30 与演示不变。环境包同理，只等拆包表里的依赖。

## 4. 任务书与其他台账

| 事 | 去哪 |
| --- | --- |
| 包的状态、PR、阻塞、偏差 | [status/](../status/README.md) |
| 任务书里写明的留桩 | 开工后登记到 [stubs/](../stubs/README.md) |
| 包被拆并、改依赖或改级别 | 改计划正文，在 [changes/](../changes/README.md) 记一条，同 PR 改任务书与状态文件 |
| 任务书把事项交给后面的包 | 第 5 节移交表 |
| 任务书另加了计划依赖列没有的前置 | 第 6 节 |

## 5. 移交表

加行的规矩（2026-10-06 起）：**新加的行不再编号，首列写“—”**，加在所属小节的表尾；引用时写“接收方是某某的一行”，不写行号。原因：几个会话并行往表尾加行，编号总是相撞（第 61、62、63 号都各出现过两次）。已有编号的行（第 1–68 行）编号不变，照旧可以按行号引用。记录见 [changes/plan-handoff-rows-unnumbered.md](../changes/plan-handoff-rows-unnumbered.md)。

随 W0-04 交付的任务书把一些事项交给了后面的包，接收方的清单行或任务书里没写。默认（W0-04 定）：

- 接收方补全任务书前先查本表，把自己那几行写进任务书的“目标”与“验收”。
- 办结后在本包状态文件“偏差”一节写一句“移交表第 N 行已办”；没有编号的行写“移交表里接收方是某某的一行已办”。各包不回改本表；台账 PR 整理时在行尾括注办到哪了，不删行。
- 之后的任务书再往后移交事项，同 PR 往本表加行（不编号，见上）。
- W0-30 核对 M0 各行都已办结。M1 以后的行由 W0-31 与各拆包 PR 写进对应的任务书。

### 5.1 接收方在 M0

| # | 接收方 | 事项 | 出处（任务书） |
| --- | --- | --- | --- |
| 1 | W0-22、W0-23（两个进程的装配） | 启动时调四个自检：`security` 的加密、解密、盲索引；审计 `target_type` 对照库里的表名单；聚合类型都是库里存在的表名；`machine`、`state_field` 的表与列在库里存在。开工时已在 main 上的就接；没到的由两包中后合并的一方接，W0-30 兜底 | W0-14 第 2 节第 12 条、第 11 节第 3 项；W0-15 第 11 节第 7 项；W0-16 第 11 节第 7 项；W0-23 第 7 节第 11 条（已办结：聚合类型一项 W0-23 接了，#50；其余三项由 KF-1 接齐，api 与 worker 共用 `packages/services/src/ops/startup.ts` 的清单，#54） |
| 2 | W0-22、W0-23 | 客户端工厂的连接参数（连接串、连接数上限、三个会话超时）在装配时传；真实构建脚本接替占位 | W0-05 第 10 节第 5 步；W0-07 第 5 节；W0-02 第 11 节第 8 项（已办结：W0-22、W0-23，#50） |
| 3 | W0-22 | 测试装配导出“已挂载的 operationId 清单”，供已落地判定读（之前为空集）；`/health` 读 worker 租约 | W0-10 第 11 节第 3 项；W0-23 第 5 节（已办结：W0-22，#50） |
| 4 | 单独的 `gate-change` PR，W0-07b 合并后、W0-22 开工前 | 放开一个装配文件引 `@liyoxi/db`（W0-02 先全禁） | W0-02 第 11 节第 5 项（不用办：组合根放在 `packages/services/src/assembly.ts`，api 与 worker 不引 `@liyoxi/db`，W0-07b 状态文件偏差 3） |
| 5 | W0-24 | 调度已登记的不变量与清理项：`events.I8`、`flow.I12`、`sla.N8`、timers 的 90 天清理。两处在开工时 `register.ts` 机制未到而只导出函数的，由本包登记：幂等记录的过期清理、审计的两条检查 | W0-13 第 11 节第 8 项；W0-14 第 11 节第 5 项；W0-15、W0-16 第 10 节第 6 步；W0-17 第 10 节第 9 步（已办结：W0-24，#54） |
| 6 | W0-18 | 参数的类型、范围、默认值定义（W0-09a 只登记键名与分组） | W0-09a 第 11 节第 3 项（已办结：W0-18，#43） |
| 7 | W0-09b | contract `exports` 里接口侧注册表的子路径 | W0-08 第 11 节第 8 项（已办结：W0-09b，#38） |
| 8 | W0-27a | 定 `pricing`、`period`、`alloc` 子路径对小程序是否开放；经 Taro 构建验证 shared 的子路径可引。已写进 W0-27a 第 11 节第 9 项 | W0-11 第 11 节第 4、8 项（已办结：W0-27a，#50） |
| 9 | W0-30 | ① `flow` 的“工作分钟”端口接上真实实现：读工作日历（sla）与工作时段（config 读侧），三张表迁移能写出 `elapsed_work_min`，带测试。② `packages/shared` 里的字符串字面量联合类型改为引用 contract 的常量。③ “状态字典键与契约枚举同名”的检查只查有枚举对应的条目。④ 核对 PR 必过检查合计 ≤15 分钟。⑤ 留桩、变更、外部验证三张汇总的脚本，随四个计数的报表。⑥ 核对本表 M0 各行已办结。⑦ 任务书“需要业主做的事”的“合并后”写上：业主或调度会话在合并提交上打 `m0-done`。⑧ 定第 ⑤ 项那三张汇总入不入库：状态汇总已改为不入库，这三张若入库会有同样的冲突或过期 | W0-16 第 11 节第 5 项；W0-11 第 11 节第 2 项；W0-26 第 11 节第 5 项；W0-03 第 11 节第 9 项；[docs/plan/README.md](../README.md) 第 1、3.4 节；[changes/plan-status-summary-not-committed.md](../changes/plan-status-summary-not-committed.md)（已办结：①③ 由 W0-30a 办，#51；其余 W0-30，#55。⑦ 说的 `m0-done` 标签还没打） |
| 19 | W0-10 | ① 路由元数据的 `x-permission`、`x-capability` 只取契约登记的键（`PermissionKey`、`CapabilityKey`），另许 `assert-in-handler` 与不设；`x-step-up: skip` 的 8 条与处理器内判定的规则登记在路由一侧。② 约定 C10 里对着路由查的几条：路径里的每个资源段都在资源登记里、参数名与登记一致、别名在登记过的别名之内 | W0-09b 第 5 节；`packages/contract/src/resources/define.ts` 开头的注释（已办结：W0-10，#42） |
| 20 | W0-18 | 07 第 7 节补登的 7 个参数键的类型、范围、默认值定义（同第 6 行，键已在契约的参数键清单里） | W0-09b 第 5 节、第 11 节第 12 项（已办结：W0-18，#43） |
| 21 | W0-21 | ① 通知场景播种：键、受众、显示名取契约的 `NOTIFY_SCENES`；通道绑定的播种值（订阅槽位、短信模板与策略、节点、发送时段、合并窗口、转交付经理的开关）按 13 分组 第 2.1 节写。② 角色的权限点开关（`staff_role.actions`）由权限点的默认授予得出：`roles` 一种写成 `{ on, leadOnly }`，其余四种不进角色配置或另行处理；默认模块等级矩阵契约里没有。③ 07 第 7 节补登的 2 个开关键随开关一起播种 | W0-09b 第 5 节（已办结：W0-21，#47） |
| 25 | W0-24、W0-25 | W0-24：把 config 的五条 SQL 断言登记成不变量（`packages/services/src/config/invariants.ts` 的 `configSeedAssertions`；“现在”取注入的时钟）。W0-25：“带种子的干净库”调 `runSeed`，不另抄数据 | W0-21 第 5 节、第 10 节第 10 项（已办结：W0-24，#54；W0-25，#50） |
| 29 | W0-22、W0-22b | ① 装配顺序里给后台的会话、防跨站、权限与再验证三件中间件，和商家端鉴权链的中间件留位置；`admin.login`、`admin.global`、`m.sign` 等档位与客户端 IP 解析由 W0-22b 交，M1 的两条鉴权链只挂不改顺序。② 路由目录、处理器登记与接口测试支架的写法写进 `apps/api/README.md`，M1 的接口包照它放文件。③ 探针循环 M2 才有，`/health` 在那之前的整体状态码要有定论：W1-22、W2-26 的冒烟现在只看 worker 一项与版本号 | W1-01a、W1-04、W1-16a、W1-22、W2-26 的任务书（①② 已办结：W0-22、W0-22b，#50、#51。③ 现状：没有探针记录即 `degraded`，整体回 503，冒烟只看 worker 一项） |
| 30 | W0-23 | 循环与队列消费者的登记要让域包“加一个文件、汇总处加一行”：W1-10 的 `billing_advance`、W1-16a 的 `flow_reevaluate_sweep`、W1-07 的 `promote` 消费者照这个写法挂；`--check` 与命令行入口的位置写进 README（W1-22 用） | W1-07、W1-10、W1-16a、W1-22 的任务书（循环一项已办结：一个循环一个文件，清单 `apps/worker/src/domain-loops.ts` 里加一行，W1-10 的第一个 PR 加的，#57；入口与 `--check` 的位置在 `apps/worker/README.md`，W0-23，#50。队列消费者仍写在 `apps/worker/src/runtime.ts` 里，没有单独的登记处） |
| 31 | W0-25 | 工厂函数要能造员工、主体与门店、交付工单；一条命令得到带种子的干净库。W1-01a 的范围隔离用例、W1-02 的真实接口冒烟、W1-10 与 W1-11a 的账本用例、W1-19 与 W1-20 的造数都要用 | W1-01a、W1-02、W1-10、W1-11a、W1-19 的任务书（已办结：W0-25，#50） |
| 32 | W0-30 | 端到端运行器与 `demo:m0` 的位置定下来，W1-21 沿用（没有交运行器时 W1-21 在 `apps/api/test/e2e/` 自建）；四个计数的报表、三张汇总脚本与全量不变量的命令，W1-21 直接用 | W1-21 的任务书（已办结：W0-30，#55；接口级的运行器没有交，W1-21 自建） |
| 59 | 调度会话另派的 kernel 小修补（不是工作包；W1-10 开工前合并） | 数据库错误出在 `COMMIT` 那一刻时（延迟约束、提交时才报的序列化失败），`packages/services/src/kernel/tx.ts` 的 `sqlStateOf` 读不到 SQLSTATE（只认 `error.meta.driverAdapterError.cause.originalCode`），`tx.run` 的重试与错误映射、`isRetryableDbError` 落空。修好并带“错误出在提交时”的用例。W1-10 的依赖里写了“开工另等”它，W1-11a 经 W1-10 的第一个 PR 带上 | W0-07 第二轮审计的备注；W1-10 的任务书 第 3 节（已办结：KF-1，#54。W1-10 任务书“开工另等”的就是它） |
| — | W0-22 | 已挂载的 operationId 清单写到 `apps/api/dist/mounted-operations.json`（JSON 字符串数组，探活用登记键如 `hooks.healthz.get`），CI 里要在“待落地数只减不增”一步之前生成；接口层测试放在 `apps/api` 下的 `*.test.ts`，以字符串字面量引用 operationId；两条内网探活的留桩文件在“留桩内容”一行用反引号写登记键；根路径探活 3 条落地后在 `infra/ci/landed-baseline.txt` 末尾加一行 610 | W0-10 的状态文件“往后移交”（已办结：W0-22，#50。只有降基线没做，见第 5.2 节里接收方是“调度会话（门禁改动，单独 PR）”的一行） |
| — | W0-22b | 接手 `apps/api/src/routing/pipeline.ts`，定成装配顺序的唯一定义；限流中间件的名字用 `rateLimit`；429 的 `Retry-After` | W0-22 的状态文件“往后移交”（已办结：W0-22b，#51） |
| — | W0-23 | worker 用同一个 `createRuntime({ entry: "worker", … })`；构建照 `apps/api/scripts/build.mjs` 的做法（不装 tsup）；第 1 行没到的自检往 `startupChecks` 里加 | W0-22 的状态文件“往后移交”（已办结：W0-23，#50，构建用 esbuild；任务进程的装配写在 `packages/services/src/ops/worker.ts`，没有用 `createRuntime`。自检由 KF-1 接齐，#54） |
| — | W0-14、W0-15、W0-16 | 各自的启动自检函数合并后，在 `packages/services/src/runtime.ts` 的 `startupChecks` 里加一项 | W0-22 的状态文件“往后移交”（已办结：KF-1 接齐，清单在 `packages/services/src/ops/startup.ts`，#54） |
| — | W0-20 | 定 Provider 装配的落点，把 `createProviders` 与外呼前钩子接进进程运行时 | W0-22 的状态文件偏差 4 与“往后移交”（已办结：KF-1，#54） |
| — | W0-27a | 往 `infra/ci/pages/sources/` 加小程序的数据源，不用改脚本 | W0-28 的状态文件“往后移交”（已办结：W0-27a，#50，`infra/ci/pages/sources/weapp.mjs`） |
| — | W0-29 | 看样页另建；三种骨架与两个构件看样确认后冻结；看样时请业主定 W0-28 偏差第 6、16、17、19、21、24、25、26 条 | W0-28 的状态文件“往后移交”（看样页与清单已交：W0-29，#51。结论等业主：`docs/plan/sample-review/W0-29.md` 第 4.2 节） |
| — | W0-30 | 合流时核对看样清单各项有没有结论，没有的在合流的 PR 描述里列出，不替业主填 | W0-29 的状态文件“往后移交”（已办结：W0-30，#55；71 项都没有结论，列在 `docs/plan/m0-exit.md` 第 3 节） |
| — | W0-22、W0-23（进程装配） | `createFlow` 不用为工作分钟另做什么，装配结果里已有实现 | W0-30a 的状态文件“往后移交”（只是知会，不用办） |
| — | 调度会话另派的小修补 | 测试工厂 `createFactories` 的缺省三件套换成 W0-14 的真实现。可以顺手做的：工厂的假单号改调 W0-13 的 `formatBizNo` | W0-25 的状态文件偏差 2、3 与“往后要做的”（前一件已办结：KF-1，#54，缺省是 `testSealer`；假单号没改，不影响用） |

### 5.2 接收方在 M1 及以后

| # | 接收方 | 事项 | 出处（任务书） |
| --- | --- | --- | --- |
| 10 | W1-01a、W1-04 | `auth_event` 的写入、清理与登录锁定告警 | W0-14 第 5 节（W1-01a 一侧已办结：写函数、清理项与锁定告警在 `packages/services/src/audit/auth-event.ts`，第二个 PR，#54；W1-04 的商家侧照旧） |
| 11 | W1-02 | 后台权限数据的真实来源接替夹具；7 个基础页 | W0-28 第 11 节第 1、5 项 |
| 12 | W1-04、G2-C | 小程序请求层的可注入调用函数接上真实接口：引导与会话；订阅结果与埋点接收 | W0-27a 第 5 节 |
| 13 | W1-10 | 提出“只有一个取整函数”的全仓 lint 规则 | W0-11 第 11 节第 9 项 |
| 14 | W2-04；W2-31 所拆 G7-A | W2-04 接明文查看、审计查询与独立 access 事务；导出接口/队列交 W2-31 拆 G7-A。企业微信真实驱动同属该 G7-A：消费 `WecomProvider.exchangeWebLoginCode({ code }) → ProviderResult<{ userid }>`，保持事务外调用、受控未配置分支并留外部实测证据；本包默认手填不代表平台核验 | W0-14 第 5 节；W2-04 实际公共能力及状态偏差 |
| 15 | G3-A | mediatool 调用端挂到 `media` 接口；`ProduceID` 的格式；媒体任务、租约与留痕写入 | X-02 第 5 节、第 11 节第 1、6 项 |
| 16 | G3-C | `docText`（文档抽文本） | X-02 第 5 节 |
| 17 | G4-A（部分与 G2-0、G4-B） | 微信支付驱动接进选择分支与组合根；补 `loadEnv` 与 `.env.example` 缺的变量；到 `WEBHOOK_*` 的错误映射；真实账单复核 V13 | X-04 第 5 节、第 11 节第 4、5、7 项 |
| 18 | G5-B | 法务条款定稿后用真文本复测授权书渲染 | X-03 第 11 节第 4 项 |
| 22 | W1-02 | 后台的模块键、模块等级换成引契约：`apps/admin/src/lib/menu-types.ts` 的 `AdminModuleKey`、`ModuleLevel` 改为取 `@liyoxi/contract/authz`（W0-28 状态文件“往后移交”点名交给 W0-09b、W0-10 的那一件；菜单角标键随 a02 域，契约里还没有） | W0-09b 第 5 节 |
| 23 | G2-C | ① 通知注册表登记的场景键与契约的 `NOTIFY_SCENES` 一一对应（启动自检或用例）。② 埋点接收接口对端上 10 个事件的属性校验结构，与契约 `ClientEventProps` 的类型同形（用例断言） | W0-09b 第 5 节；`packages/contract/src/analytics/events.ts` 开头的注释 |
| 24 | 各域第一个后端 PR | 本域里标了带 `details` 的领域错误码，各登记 `details` 的结构；默认文案不合适的同 PR 改（文案不在对账之内） | W0-09b 第 5 节、第 11 节第 3 项（W1-03、W1-06 的第一个 PR 各登记了本域的两个码，#54、#56；W1-11b 登记本域 M07/A07 details 结构；其余各域照旧） |
| 26 | W1-01b；服务器与发布的包（G2-D 环境包） | W1-01b：登记 `staff.I8`（`packages/services/src/staff/invariants.ts`）。发布流程：`migrate deploy` 之后跑播种；命令行入口 `pnpm db:seed` 靠 `tsx` 直接跑源码，生产镜像里没有它时由构建产物里的入口调 `runSeed` | W0-21 第 5 节、第 10 节第 1 项（`staff.I8` 已由 W0-24 登记在 `packages/services/src/staff/register.ts`，#54：W1-01b 不再登记，再登记会装配重名。发布流程的一半照旧） |
| 27 | G2-C；M2 的初始化脚本 | 订阅槽位的字段定义、短信模板的变量定义、模板编号与签名：种子里是空数组与 `unconfigured`，模板选定、报备通过后写 | W0-21 第 10 节第 7 项 |
| 28 | W1-01a、W1-13 | 原想请 W0-21 顺手做的两件，W0-21 合并时都没有带，改由用到的包自己做。① 8 个角色各一个默认组（`staff_group`，03 分组 第 2.2 节；新增员工与引导命令都要用）：W1-01a 的第二个 PR 在 `packages/services/src/staff/seed.ts` 里追加。② “新增字典项、没有才插”的函数：config 现在只有读侧与种子，W1-13 在 `packages/services/src/config/` 里只增这一个函数，演示种子用它补题材、卖点标签、行业、定制重点的演示项；字典写侧的接口与引用计数仍在 M2（交 W1-23 写进 G2-A 任务书的那一行） | W1-01a、W1-13 的任务书；已写进这两份任务书（① 已办结：W1-01a 的第二个 PR，#54；② 照旧） |
| 33 | W1-01a | `auth_event` 的写函数与清理项建在 `packages/services/src/audit/auth-event.ts`，三个身份空间共用（W1-04 先开工时自己建同名同签名的文件，后合并的一方并成一份）；演示种子的运行器让各模块加一行；演示员工满足下游的四个要求；`defineAdminHandler`、`signInAsStaff` 给全部后台接口包用；a01 的公共结构 `StaffBrief`、`AdminPage<T>`、`AdminCursorPage<T>` | W1-04、W1-06、W1-07、W1-11b、W1-13、W1-16a、W1-19 的任务书；已写进 W1-01a 的任务书（`auth_event` 的写函数与清理项已建：W1-01a 的第二个 PR，#54；其余在第三个 PR） |
| 34 | W1-01b | `staff.pickNext(tx, pool, scopeKey)` 对选中的员工行加共享锁，调用方（W1-17、W1-08、W1-16a）要在锁任何业务行之前调；`publisher` 池在 M1 可返回空；按 id 批量取员工摘要的只读函数只给上层用 | W1-06、W1-08、W1-17 的任务书；已写进 W1-01b 的任务书 |
| 35 | W1-02 | `admin:e2e:live` 的起栈脚本与登录态由第一个 PR 交，留造数步骤的登记口；W1-09、W1-19、W1-20 沿用，不改起栈脚本。登记的造数步骤要在同一个进程里跑完：W0-25 的工厂序号（假手机号、假单号）是进程级计数，同一个库分两次进程造数据会撞唯一索引 | W1-09、W1-19、W1-20 的任务书；已写进 W1-02 的任务书 |
| 36 | W1-03 | 读侧事实端口（`packages/services/src/kernel/ports/merchant-facts.ts`）一次定义全八个键；`tenant.getQuotaUsage` 给 W1-11b 的钱包用；计费账户端口的桩由 W1-11a 删 | W1-04、W1-08、W1-11a、W1-11b 的任务书；已写进 W1-03 的任务书（W1-03 一侧已办结，#54；桩由 W1-11a 删，照旧） |
| 37 | W1-04、W1-05 | 第 12 行里“小程序端引导与会话的接线”由 W1-04 改归 W1-05（甲类后端包不混前端改动）：冷启动与恢复动作的接线、重新同意弹层在 W1-05 的第二个 PR。W1-04 交的店员防回归框架与黄金文件给全部商家端接口包用；W1-05 的文案规则表允许页面包只增，截图喂固定数据的做法写进 `apps/weapp/README.md`，“我的”页留钱包入口 | W1-04、W1-05、W1-12、W1-18、W1-20 的任务书 |
| 38 | W1-06 | `approval.submit`、`approve` 能在没有请求上下文的地方调用（演示种子）；kind 登记里的 `handlerOf` 可选；`admin.dictItem.list` 提前到 M1，随第二个 PR | W1-11b、W1-14、W1-09、W1-12、W1-19、W1-20 的任务书；已写进 W1-06 的任务书 |
| 39 | W1-07 | 演示种子运行器里入六份协议占位 PDF 并调 docs 的占位种子；`putSystemFile` 支持海报、许可扫描件、权属证明；分类登记表后面的包只增放开（如 W1-14 的 `evidence`）；引导数据里上传上限的常量换成取登记表；a01 的公共结构 `SignedUrl` | W1-03、W1-04、W1-13、W1-14 的任务书；已写进 W1-07 的任务书 |
| 40 | W1-08 | 调 tenant 的三个写函数（缺的在 tenant 里只增）；注册事实端口的 `profile` 键；导出 `profile.storeGate`、`assertProfileComplete`、行业开放判定、门店城市与品类的只读函数、收事务句柄的“指派交付经理”函数；资质结论事件的载荷带门店 id 与是否终局；b 的两个经理同步端口返回真实改写数量（兼容旧 void 空实现为0），调用时store130已锁而经理列尚未更新，后继按 input.staffId 写入、保持order160/delivery180锁序；后台聚合另注册 profile.admin_facts 的各来源键（M2 G2-B） | W1-03、W1-13、W1-14、W1-15、W1-16a、W1-17 的任务书；已写进 W1-08 的任务书 |
| 41 | W1-09 | 小程序上传工具 `apps/weapp/src/lib/upload/` 按分类用，W1-12、W1-18 复用；并排比对表与驳回弹层先做成页面私有组件，W1-19、W1-20 要用时由先到的包开构件 PR 提升 | W1-12、W1-18、W1-19、W1-20 的任务书；已写进 W1-09 的任务书 |
| 42 | W1-10 | `priceAt`、`paramsAt`、`getWalletView`、`getEntitlements` 在第一个 PR；`hold` 的 `pricing` 入参不带等级，billing 在账户锁内自己读 `drama.heat_tier`（07 分组 第 5.1 节；W1-13、W1-15 不取、不传）；`capture` 对已不在冻结中的冻结单抛调用方认得出的错误 | W1-13、W1-15、W1-17 的任务书；已写进 W1-10 的任务书 |
| 43 | W1-11a | 注册计费账户端口的真实现并删 W1-03 的桩；事实端口的 `billing` 键一次注册全（含“我的”页的套餐与积分卡）；`billing.subscription.activated` 的载荷带主体 id | W1-03、W1-04、W1-17 的任务书；已写进 W1-11a 的任务书 |
| 44 | W1-12、W1-18 | 结果页 `sub/order/result` 的壳归 W1-12，按 `type` 分文件；W1-18 只加 `order.tsx` 与分发处一行，谁先合并谁建壳。“我的”页与首页的积分卡跳钱包是同一条路由 | W1-12、W1-18 的任务书 |
| 45 | W1-13 | `priceAt` 由 W1-10 交，本包只登记 `DramaPricePort` 的实现；演示种子在运行器里加 content 一行；首页取门店城市与品类调 W1-08 的只读函数 | W1-08、W1-10、W1-21 的任务书；已写进 W1-13 的任务书 |
| 46 | W1-14 | 注册事实端口的 `publish` 键；登记 `launch_link` 时给 `handlerOf`；定义“上线情况变了”端口并导出建上线任务的函数（W1-16a 实现与调用）；a06 的 `delivery-releases.ts` 归 W1-16b | W1-03、W1-04、W1-06、W1-16a 的任务书；已写进 W1-14 的任务书 |
| 47 | W1-15 | 注册事实端口的 `order` 键；a 已注册 W1-08 的“订购单同步”端口（store130→orders160，显式 staffId、实际 count）；把 W1-13 留的老板专有字段接上 | W1-03、W1-04、W1-08、W1-13 的任务书；已写进 W1-15 的任务书 |
| 48 | W1-16a | 注册 W1-08 的工单分配端口、W1-14 的“上线情况变了”端口、W1-07 的分类守卫（`sample_video`、`final_episode`）并写制作留痕；定义 `orderSidePort`；第一个 PR 导出工单步骤、方案摘要、时间轴各时刻的只读函数给 order 读侧 | W1-07、W1-08、W1-14、W1-17 的任务书；已写进 W1-16a 的任务书 |
| 49 | W1-17 | 第一个 PR 实现 `orderSidePort` 的 `rederive` 与 `applyConfirmedPlan`，并把 W1-15 的开工后读侧接上；系统指派交付经理调 W1-08 的函数；开工后的发布专员调 `staff.pickNext` | W1-15、W1-16a、W1-01b 的任务书；已写进 W1-17 的任务书 |
| 50 | W1-19、W1-20 | Playwright 的造数步骤放自己的文件；登记样片与质检用两个账号；在脚本里代商家调方案确认、样片保存与确认、链接回填。M1 里读侧恒空的内容（公告条、待办、售后、授权书、巡检、下架）页面不做 | W1-13、W1-15、W1-16a 的任务书；已写进 W1-19、W1-20 的任务书 |
| 51 | W1-21 | 演示种子运行器由 W1-01a 起头，本包只核对先后并加演示参数（`order.start_delay_minutes` 设 0）；降 `landed-baseline.txt`；核对计划留桩清单“M1 内的端口桩”一行全为已回补；端到端脚本里“保存样片 → 确认样片”两步缺一不可，登记样片与质检用两个账号；演示手册含演示点 A 的起环境步骤与 W1-12 的四页；接口清零按两条提前之后的数 | W1-06、W1-09、W1-11b、W1-12、W1-13、W1-16a 的任务书；已写进 W1-21 的任务书 |
| 52 | W1-23（写进 G2-A 的任务书） | 员工其余接口与页面、staff 其余不变量（`staff.I2` 在没引导过首位管理员的库上必然违规，M1 没登记）、在办来源端口、分配池与 `pickNext` 去桩、发布专员的指派、激活码短信（staff 调 notify 不在 06 第 3.6 节的同层白名单里，要定走端口还是改白名单）；用户菜单的修改密码与动态口令设置两项及页面清单补登、员工页的行内操作与页头计数；审批决定时限（`due_at`、`sla.breach`、`approval.onCalendarImported`、`approval.I3`、`I5`）、“只升锁版本”入口、字典写侧与引用计数 | W1-01a、W1-01b、W1-02、W1-06、W1-17 的任务书 |
| 53 | W1-23（写进 G2-B 的任务书） | 登录表单换成手机号组件并去桩；休眠检查的两支；“退出登录”移进设置页；协议 PDF 的读地址与 docs 登记文件引用怎么走（06 第 3.6 节的同层白名单没有 docs → media，13 分组 第 5.1 节却要 docs 调 `files.link()`：走端口或单独的 `gate-change`）；`notices.withdraw`；资质的 `change`、`new_store` 轮次与终局驳回、联系人发码、后台商家聚合端口的各键、建档首页成员摘要、小程序地图选点入口（业主申请的 `chooseLocation` 通过后）；门店数额度校验 | W1-03、W1-04、W1-05、W1-08、W1-09、W1-15 的任务书 |
| 54 | W1-23（写进 G2-0、G2-C、G2-D 的任务书） | W2-02：`QueryTablePage` 的 `mask` 与 `selectedRowKey`、`validateSearch` 复用公开 `@liyoxi/contract/queries/admin` 查询结构；CompareTable/RejectDialog 已公开，保留既有公口与 pending 守卫，新增 DiffBlock。G2-C：事实端口的 `notify` 键；billing、order、delivery、publish、approval 的通知场景解析（M1 的事件已照发）；定 `docs.N5` 的归属（要读付款单、订购单、广告三张上层表，docs 在 L1 登记不了）。G2-D 的代码包：后台来源 IP 白名单（`ADMIN_IP_ALLOWLIST`、`IP_NOT_ALLOWED`）；锁定告警的规则键 `auth.staff_untrusted_locked` 进告警最小集；事件型告警规则的登记处收进 `sla.calendar_fallback` 等已在用的键；`alerts.raise` 在业务事务里被调不能丢（`sla.dueAt` 就在业务事务里调它；实现要另开独立事务时会被 kernel 的嵌套检测拦下，得先由 kernel 给一个“脱离当前事务作用域”的办法，G2-D 的代码包开工前做）；`ops.cert_check` 对还解析不到的读域名记“未配置”；`backup.pgdump` 的上传走存储 Provider；两条错误上报转发接口归到一个代码包（同时接上小程序 `apps/weapp/src/lib/server.ts` 里错误上报的那个调用，W0-27a 留的），并把 W2-27 依赖里的两处文字换成编号；预发的 `AUTH_KEYS_FILE` 生成步骤进环境包的密钥清单；计划 第 5.5 节“M2 起加”的每晚 P95 基线归到一个包 | W1-01a、W1-02、W1-03、W1-06、W1-09、W1-11b、W1-16a 与 W2-25–W2-29 的任务书 |
| 55 | W1-23（写进 G3、G4 的任务书） | G3-A：真实存储与分块、`media.sweep`；执行循环接手后删掉 W1-07 的 promote 补偿扫描；体检接入包替换 `media/production-stub.ts`；成片批量上传；预发 mediatool 的内存上限实测后定是否升配。G3-B：原片与预告片就绪、版权到期定时器与 `content.I3`、订购统计、公告条、搜索。G3-C：OCR 接上证照识别与提交时的字段比对；事实端口的 `asset` 键；参考素材。G4-A、G4-B、G4-C：续费、升级、降级、加购的报价与履约；微信渠道入账（付款人与回传数据校验、孤儿交易、补单）；对公二人复核；凭证的 `sla.breach` 与回单识别；unexpire、revoke、extend、调整审批；估值与日快照及 `billing.I11`、`I13`、`I15`、`I17`；payment 不变量从 I16 续编；延长后续费的锚定日；提醒查询 R1；钱包里生效中的续费、升级、加购入口与微信支付调起；订购单页的付款单页签 | W1-07、W1-08、W1-10、W1-11a、W1-11b、W1-12、W1-13、W1-15、W1-16a、W1-19 与 W2-25 的任务书 |
| 56 | 之后的拆包 PR（G5、G6、G7-A） | G5-A：指派剪辑师时去掉“首次登记即认领”，环节时限、已确认方案的修订、样片修改意见，资质驳回后的 `order.rejected_stale` 与整店取消。G5-B：事实端口的 `ad` 键、广告就绪与授权书齐全、订购时选广告。G6-A、G6-B：发布清单编辑、预打包、到期定时器、重新生成授权、`m.download.report` 与逐集下载的真实形态；方案表单里改选发布账号。G7-A：事实端口的 `support` 键、企业微信联系人回填、在线客服配置、首页待办区 | W1-03、W1-04、W1-15、W1-16a、W1-16b、W1-17、W1-18、W1-19、W1-20 的任务书 |
| 57 | 第一个结构变更包；M2 合流包 | D7 第 10.6 节第 19 项的迁移演练（`@ignore` 删列三步、CHECK 约束替换各一次）随第一个结构变更包做，W2-28 只交混跑冒烟。M2 合流包按实际页面把 W2-29 的真机清单第一版校一遍并补本里程碑的条目 | W2-28、W2-29 的任务书 |
| 58 | 调度会话 | 环境五包第 8 节的服务器步骤逐步经业主同意后才执行；业主清单第 4.1 节的镜像仓库、补 3、补 4 是“首次起环境”之前要有的结论，不挡五个包写脚本与合并。业主要在小程序后台申请 `chooseLocation` 接口。预拆的包凭第一个 PR 放行下游，照第 7.2 节。同层没有白名单的读取，M1 的任务书统一写成“在本模块仓储里只读查表、不 import 对方模块，写入一律走端口”（06 第 3.6 节没写这一条）：想改成调函数，要先有单独的 `gate-change` PR 改白名单 | W2-25–W2-29、W1-09、W1-06、W1-08、W1-14、W1-15、W1-16a 的任务书 |
| 60 | W1-08、W1-11b；G4 的开票包（由 W1-23 写进任务书） | 审计按键名里的词脱敏（`packages/services/src/audit/sensitive.ts`），有几个不敏感的键会被多遮：`storeTel`（门店公开的联系电话，W1-08）、`bankAccountFinanceConfigRevisionId`（收款账户版本的 id，W1-11b）、`emailState` 与 `emailSentAt`（发票邮件的投递状态，M4）。本域写审计的前后值带到这些键时由本域的包收：在敏感键清单里加例外（只增，带用例），或写审计时换一个不撞词的键名；做法记偏差 | W0-14 复审的备注（调度会话记） |
| 61 | 第一个要写带数据范围的原生查询的包（数据报表、导出的明细查询；由那一里程碑的拆包 PR 写进任务书） | `authz` 只给了 Prisma 条件形态的六个范围谓词，没有做原生 SQL 用的范围片段（D4 第 7.3 节的 `scopeSql`）。用到门店、主体归属的原生查询须收 `DataScope` 并拼这个片段：加在 `packages/services/src/authz/scope.ts`，与谓词同处、同一套条件，不在各模块自己拼 | W1-01a 第一个 PR 的状态文件“偏差”第 5 条；`authz/README.md` 第 6 节 |
| 62 | W1-04、W1-04b | W1-03 交的两个装配入口 `createDocs({ tx, clock })`、`createTenant({ tx, clock, flow, assembly })` 还没接进进程运行时（`packages/services/src/runtime.ts` 里现在没有 `events`、`flow`）：谁先用到谁接，W1-04b 挂 tenant 的三条路由前要有。`apps/api/src/routes/agreements.ts` 的 `docsOf(runtime)` 是临时的取法，接进运行时后换掉。把 `common/error-details.ts`、`errors/common.ts` 里 `PendingConsent` 的占位换成 `PendingConsentSchema`（已在 `routes/m01-account/agreement.schemas.ts`）。契约入口给出单条路由与结构的做法：各接口文档目录的 `index.ts` 里 `export *` 自己的资源文件，契约 `src/index.ts` 每份文档一行（m01、m02 已加） | W1-03 的状态文件偏差 2、3 |
| 63 | W1-08；W1-23（写进 G2-C 的任务书） | W1-08：`tenant.setStoreQualification` 通过时两个主体的信用代码撞唯一索引 `uq_entity_uscc_bidx_verified` 会让事务中止，要接它就包在 `savepoint` 里并用 `isUniqueViolation` 认；认证字段的三件套由调用方做好传入。G2-C：`notices.announce` 的深链现在写的是 `agreement.version`，深链路由表进契约时登记它（或改成表里的键）；`site_notice.announced` 的订阅与首页公告条的读取 | W1-03 的状态文件偏差 9；`packages/services/src/tenant/README.md` 第 2 节 |
| 64 | W1-08（第一个登记真实审批类型的包）；W1-06 的第二个 PR | 进程装配里建 approval：`createApproval({ assembly, clock, flow, events, bizNo })`，排在 `createFlow` 之后，api 与 worker 都要建（worker 不建，`approval.I1` 查不到登记的领域表）。W1-06 的第一个 PR 只交了入口，没有接进 `packages/services/src/runtime.ts`（那时 events、flow 也还没接进去）。领域用例调 `approval.submit`、`approve`、`reject`、`withdraw` 要排在锁自己的行之前（员工行 20 → 审批单 30 → 领域行） | W1-06 第一个 PR 的状态文件“偏差”第 2、3 条；`approval/README.md` 第 2、4 节 |
| 65 | 调度会话（kernel 的小修补，或并进 G2-A） | `lockRows` 只有 `FOR UPDATE`、`FOR SHARE` 两种强度，`flow.transition` 也按 `FOR UPDATE` 锁对象行；03 分组 第 2.12 节写审批单用 `FOR NO KEY UPDATE`（领域表插行时的外键检查要取 `FOR KEY SHARE`）。现在照 `FOR UPDATE` 锁，结果对，只是别的事务往领域表插行要等决定的事务结束。要照文档就给 `lockRows` 加一种强度并让 flow 按表选。另：x01 第 2.3 节“其余本文定的取法”里补 `approval.executed:{approvalRequestId}`（`approval.recordExecuted` 用的去重键） | W1-06 第一个 PR 的状态文件“偏差”第 4、6 条 |
| 66 | W1-10 的第二个 PR；W1-11a；G4-A（由 W1-23 写进任务书） | 第二个 PR：冻结（`hold`）走账户锁的那一条（验收 4）、“清零与冻结落在同一时刻”（验收 8）在第一个 PR 里用加购入账代替，冻结落地后各补一条；自检与写入顺序里冻结单、分摊的那一半；契约里冻结一族的文案码参数是照 m07 第 4.5 节先写的，用到时核一遍。W1-11a：建计费账户的端口实现调 `ledger.ensureAccount`；建好生效周期后调 `ledger.grant(tx, { grantScheduleId, ctx })` 发首月（它连 `next_due_at` 一起算），建预约周期后调 `ledger.refreshNextDue`；api 进程的运行时里还没有账本，要用时照任务进程的写法 `createLedger({ clock, events })` 建一次。G4-A：`billing.points.expired` 的去重键照 x01 第 2.3 节是按周期的，周期延长复活后再次到期会被当成已发过，做延长时改成带止日（同 PR 改 x01）；`advance` 现在只在“上一期到期”时接续预约周期，退款提前生效由 `revokeTerm` 自己做 | W1-10 |
| 67 | W1-04 的第二个 PR；W1-04b | 第 62 行后半已由②回补：`PendingConsentSchema` 与纯 TS 类型在 `common/`，两处占位已替换，m01、引导和 428 从契约包根共用。W1-04b：处理器取会话用 `merchantSessionOf(c)`、取服务用 `merchantServicesOf(runtime)`（`apps/api/src/merchant/services.ts`）；`docsOf` 的装配在 `merchant/docs.ts`，`routes/agreements.ts` 仍重导出；重新同意的快照取 `identity.consentSignerOf(tx, principal)`（还没有用例）；接口用例登录态取 `testing/merchant.ts` 的 `signInAsMerchant`；店员回放入口与裁剪约定见 `apps/api/README.md` 第 9 节 | W1-04 的状态文件偏差 4、11、18 |
| 68 | 调度会话（合并内核小修补、W1-01a 的第二个 PR 时）；W1-23（写进 G2-B、G2-D 的任务书） | 调度会话的几件接到 main 时已办：`merchant/services.ts` 取 `runtime.providers.wechat` 与运行时上的 `events`，接口用例的假微信经 `createRuntime` 的 `providers` 给；`audit/auth-event.ts` 只留 W1-01a 的那一份。G2-D：AppID 的配置来源接到 `createIdentity` 的 `appid`、替掉占位值，`smsConfigured` 接短信驱动的状态；微信驱动的 `getPhoneNumber` 要把区号交出来（Provider 的接口现在只交 `phone`，`identity/phone.ts` 只能看原串里的国际前缀：区号不是 86 的号码不能不带加号地拼成一串数字交回来，`+1` 的号码去掉符号与大陆号同形）。G2-B：休眠检查的两支、订阅者 `identity.onWechatBound`、会话过期清理的登记、openid 的 HMAC 要不要专用的密钥用途 | W1-04 的状态文件偏差 1、4–6、13、14 |
| — | 各域第一个后端 PR | 补结构时把资源文件里的 `merchantMeta(...)` 等换成 `merchantRoute(...)` 并补 `request`、`responses`，其余字段不动；`packages/contract/src/contract.test.ts` 里钉的两个条数与“paths 为空”跟着改；改接口同 PR 改 `routemap.json` 与分组文档 | W0-10 的状态文件“往后移交”；做法已写进 M1 各任务书与第 7.3 节 |
| — | 各合流包（W1-21 起） | 已落地数、待落地数取 `node infra/ci/landed.mjs --report`；里程碑退出用 `--require` 核对；合流包把基线降到当时的待落地数 | W0-10 的状态文件“往后移交”（W0-30 的一半已办，#55；基线没降，见接收方是“调度会话（门禁改动，单独 PR）”的一行） |
| — | 调度会话（门禁改动，单独 PR） | 待落地基线从 613 降到 610（合流包以后还要再降）：先让已挂载清单在全新检出里拿得到（入库成生成物并加对账，或换 `infra/ci/test/routes-gates.test.ts` 里对真仓库比基线那一例的取数），再在基线末尾加一行。W1-21 降基线之前要有 | W0-22 的状态文件偏差 13 与“往后移交”；W0-30 的状态文件偏差 7 与“往后移交”；`docs/plan/m0-exit.md` 第 6 节第 1 项 |
| — | 调度会话 | ① `test` 任务分片时，“四个计数”一步跟到跑 `apps/api` 用例的那一片、排在它之后。② 第 1、30 行没办结的部分定谁接。③ W0-30 合并后打 `m0-done` | W0-30 的状态文件“往后移交”（① 已办结：#53 分片时在 `test` 任务里加了“导出已挂载清单”一步，排在待落地数与四个计数之前。② 已办结：见第 1、30 行的括注。③ 没打，留给业主：业主清单第 4.3.1 节） |
| — | W1-21 | 四个计数：`pnpm counts:report --require M1`，CI 里另加一步，不改 M0 那一步。三张汇总：`pnpm plan:summaries`。全量不变量：`runInvariants`（`@liyoxi/services`）。演示命令的写法照 `packages/services/scripts/demo-m0.ts`；接口级的端到端运行器在 `apps/api/test/e2e/` 自建，任务进程一侧“中继 → 派发 → 消费 → 扫描”怎么推照 `runM0Chain`。定时器到没到点按数据库时间判，端到端脚本里要“到点”的定时器不能靠拨业务时钟 | W0-30 的状态文件偏差 2、3 与“往后移交”（接第 32 行） |
| — | M1 里要加留桩的各包 | 留桩文件的键与状态取值由 CI 核对（`node infra/ci/plan-summaries.mjs --check`）：照 `docs/plan/templates/stub.md` 写，“回补里程碑”以里程碑号开头 | W0-30 的状态文件“往后移交” |
| — | 调度会话（没有指定接收的包） | 契约补 `follow_up.intent` 的枚举：要先让 `enums:check` 认组合条件里的取值清单（改已有的检查脚本，按门禁改动处理），补上后把状态字典那三条说明里的“契约未绑定枚举：”去掉 | W0-30a 的状态文件“往后移交” |
| — | 各域第一个接口包 | 处理器写在 `apps/api/src/routes/<域>.ts`，在 `routes/index.ts` 加一行；接口层测试用 `useTestApi()`；回调的处理器自己接住错误、按 Provider 的协议应答 | W0-22 的状态文件“往后移交”；写法在 `apps/api/README.md` 第 2 节 |
| — | M1 的鉴权链（商家、后台、下载页）、授权、回调验签各包 | 中间件写成 `RouteMiddlewareFactory`，在 `apps/api/src/routing/pipeline.ts` 的 `ROUTE_MIDDLEWARES` 末尾加一行（鉴权写 `groups`）；工厂只返回处理函数，名字就是槽位，不改 `PIPELINE_ORDER`。鉴权链把身份上下文放进 `c.var.identity`、会话行的 id 放进 `c.var.sessionId`；客户端 IP 取 `c.var.clientIp`。它们没到之前，声明了登录、权限点、验签的路由挂不上去 | W0-22、W0-22b 的状态文件“往后移交”（工厂的形态以 W0-22b 的为准，`apps/api/README.md` 第 3.1 节；W0-22 写的 `{ name, handler }` 形态已作废） |
| — | 登录的包（商家端会话在 W1-04） | `m.session.phoneLogin` 的“每 openid 5 次 / 小时”在处理器里数：那条路由是公开的，中间件里拿不到 openid | W0-22b 的状态文件偏差 5 与“往后移交”；W1-04 的任务书 第 10 节已有这一项 |
| — | 各域的接口包 | 要单独限流的接口：把 operationId 写进契约的档位登记 `packages/contract/src/routes/rate-limits.ts`；新档位同 PR 改约定 C68 的表与额度表。三段式的路由登记在 `routes/three-phase.ts` | W0-22b 的状态文件偏差 2 与“往后移交”；第 7.5 节 |
| — | 环境包（G2-D；由 W1-23 写进任务书） | 限流额度、可信代理的跳数与网段接成部署配置；预发实测负载均衡怎么写 `X-Forwarded-For` 之后照实填网段 | W0-22b 的状态文件偏差 6 与“往后移交” |
| — | M1 第一个写接口的包 | `required` 的路由，请求头带 `Content-Type: application/json` 而请求体为空时回 400：把空请求体按 `null` 算 | W0-22 的状态文件“往后移交”（已办结：W0-22b 办了，#51，它的状态文件偏差 10） |
| — | W1-02 | `apps/admin/src/lib/menu-types.ts` 的 `NavBadgeKey` 改为引 `@liyoxi/contract/authz`（与第 22 行的模块键一起）；样例页自带的 `paths`（`src/dev/sample-api.ts`）不再需要时删掉。再验证弹层接到请求客户端的 `stepUp`；登录成功后调 `resetLoginLatch()`，登录页按 `redirect` 回跳；用户菜单；403、404 换成真实页面。`Can`、`useCan`、`useModuleLevel`；表单字段的构件给错误块加 `role="alert"`、有字数上限的字段显示计数 | W0-10、W0-28 的状态文件“往后移交”；已写进 W1-02 的任务书 第 2 节 |
| — | G7-B（由 M6 交 M7 的拆包 PR 写进任务书） | 菜单角标的轮询接上 `AppShell` 的 `badges` 属性（现在不传，角标不显示）；D7 第 5.4 节“页面用到的接口的权限不高于进入页面所需的权限”的 CI 测试 | W0-28 的状态文件“往后移交” |
| — | 第一个用到日期范围选择器的后台页面包（由那一里程碑的拆包 PR 写进任务书） | W2-02 已在有头 Chrome 实证并以 DateRangeField 修复空值焦点锁；公共包装保留日期语义，Tab/Shift+Tab 进出、Esc关闭与手输范围由本包浏览器用例覆盖 | W0-28 的状态文件偏差 25 与“往后移交”；`apps/admin/README.md` |
| — | W2-02 | W0-28 移交的构件已交：胶囊单选与原因单选、单选卡、月份切换、只读值、中性款提示条、橙色强调信息块、驳回弹窗、步骤进度、三列日志行、并排比对表、变更前后；主从页的可点行选中样式。列脱敏声明 `mask` 与 `validateSearch` 已在第 54 行 | W0-28 的状态文件偏差 23 与“往后移交” |
| — | 调度会话另派的环境小包（或并进 W2-25）；W1-02、W1-21；W1-23（写进 G2-A 的任务书）；W1-04、W1-06 | 环境：本地整套环境 `pnpm stack:up` 起的 api、worker 没有三份密钥文件（`DATA_KEYS_FILE`、`BIDX_KEYS_FILE`、`AUTH_KEYS_FILE`），进程起得来但后台登录与 `staff:bootstrap` 用不了：起环境时在不入库的位置现生成一份本机用的并挂进容器，另把引导与演示种子接进起环境的步骤；演示种子现在只有 `tsx` 的入口，预发要跑就照 `apps/worker/src/cli/seed.ts` 加一个镜像内入口。W1-02 的 `admin:e2e:live` 自己现造密钥文件（做法照 `apps/worker/test/staff-bootstrap-cli.test.ts`）。G2-A：首位管理员的激活码 24 小时没用即过期，而引导命令不会再执行，要有重新生成激活码的入口（接口 `admin.staff.reissueActivationCode` 之外，给命令行留一个）；权限矩阵的黄金文件 `apps/api/golden/admin-permission-matrix.txt` 还没登记成门禁文件（登记成 `append` 时注意它的行里不能出现分类脚本认的放行关键字）。W1-04、W1-06 等同时在改 `packages/services/src/runtime.ts` 的包：`flow` 已由本包接进运行时（`runtime.flow`），合并时只留一份 | W1-01a 第三个 PR 的状态文件“偏差” |

| — | W1-11a 的第二个 PR；W1-11b；G4-A（由 W1-23 写进任务书） | 第二个 PR：履约的入口是 `createFulfillment({ clock, events })` 给出的 `fulfill(tx, { billingOrderId, ctx })`，返回 `{ result, replayed }`；它要求付款单已是已支付，自己不改付款单（履约状态、结果、说明、`fulfilled_at` 由入账函数按 `result` 写回）；`ACCOUNT_BUSY` 与可重试的数据库错误它原样抛出，入账函数不要接。“入账函数只接对公一个入口”的留桩、`payment.I1`、`I2`、`I4` 由第二个 PR 登记。W1-11b：api 进程的运行时里还没有账本与履约，接入账函数时照任务进程的写法各建一次。G4-A：升级、加购的履约（留桩 `m4-billing-fulfill-upgrade-topup.md`）；`billing.I12` 现在只查套餐与加购两种付款单，升级付款单与已退款付款单的两句随升级、退款补；链尾被延长过之后再续费，止日的次日不在锚定日上，现在按受阻处理（`detail.problem = term_dates`），做延长时定规则；测试夹具 `openTerm` 可以换成经 `fulfill` 造 | W1-11a 的第一个 PR |
| — | W1-23（写进 G2-A、G2-D 的任务书）；W1-17 与使用员工摘要的接口包 | W1-01b 员工最小集：既有 staff.I8 保留单份登记；G2-A 接 staff 其余不变量、在办来源端口、池维护与城市轮询，并去两项留桩。短信要定 staff→notify 走端口还是改白名单（真实驱动随 G2-D）。业务事务先调 `staff.pickNext(tx, pool, scopeKey)` 再锁业务行，展示摘要复用 `staff.staffBriefs(tx, ids)` | W1-01b 任务书 第 9 节；staff README 第 9 节；两项 m2-staff 留桩 |

| — | 未来 media 结构包（由 W1-23 写进相应任务书） | 冻结的 file_object noscope 上传去重索引未包含 entity_id。W1-07 对同上传人、分类、clientToken 的跨主体 pending 冲突回 VALIDATION_FAILED 并提示重新生成 clientToken；保持现有 schema，不返回其他主体凭证。结构包对照主文档核定是否将主体归属纳入索引，并保留同归属重用与跨主体反例 | W1-07 状态文件偏差 3；media README；06 分组 第 2.1 节 |
| — | W1-09、W1-12、W1-18、W1-20 | 账户接线已由W1-05②交付：页面监听既有contextRev废弃门店维度缓存并拒绝旧响应；登录返回页非标签路由保留查询。八态H5注入只替换账户API，后续为自己的接口建同样固定离线DTO入口，不改生产中央请求层伪造证据；钱包入口随pages.ts对应页implemented自动显示。通用陈列继续冻结，两个业务组件在实际使用页看样 | W1-05状态与apps/weapp/README账户流程/离线样张节；既有第37、53行仍适用 |

第 28–60 行是 W0-31 加的（第 59、60 行是合并前接到 main 时补的）。第 67、68 行随商家鉴权 PR #58 合入 main，本台账 PR 同步时保留。第 61–66 行是 W1-01a、W1-03、W1-06、W1-10 各自的 PR 加的；第 64、65、66 行原来分别与第 62、63、61 行重号，2026-10-06 的台账 PR 改成现在的号，按行号引用它们的两份状态文件（W1-06、W1-10）跟着改了。两张表里首列写“—”的各行，是同一个台账 PR 照各状态文件的“往后移交”补的（W0-10、W0-22、W0-22b、W0-25、W0-28、W0-29、W0-30、W0-30a）；行尾的括注是那一天对着 main 核过的办结情况。接收方在 M1 的各行（第 28、33–51 行）已写进接收方的任务书，这里留作出处；第 12 行里交给 W1-04 的那一半改归 W1-05（第 37 行）。main 上先有的第 26 行：W1-01b 登记 `staff.I8` 原已写进 W1-01b 的任务书，W0-24 先登记了（#54），任务书那两处已行内改成“不再登记”；发布流程在 `migrate deploy` 之后播种，已写进 W2-25（节点步骤 `seed`）与 W2-26（发布顺序）的任务书。第 27 行交给 W1-23 写进 G2-C 的任务书。

| — | W1-09、W1-12、W1-19、W1-20 | 真实后台验收复用 `pnpm admin:e2e:live`：造数在 services/testing/admin-live 新增 *.fixture.ts，单进程顺序共享 make/runtime；浏览器只新增 live-*.spec.ts，由项目依赖复用 storageState。不改起栈脚本或配置，不从前端导入服务端。G2-0 接 mask/validateSearch，G2-A 补用户菜单两项与员工操作 | W1-02①；apps/admin/README.md；任务书第 9 节 |

| — | W1-17；W1-16a PR2；G2-A | W1-16a PR1 公共 createTickets/prepareTicketAssignees、reevaluate 与按订单项工单/按订购单方案摘要可复用；开工须同 TX 先 staff20 prepare（同 TX/order 重入无计数变化，main pickNext 无游标/计数写），后 store130/order160/item170/account420，create 只重入预持父锁及 INSERT，传首 capture 返回 Tf 给 at。确认需注册 orderSidePort.applyConfirmedPlan，default INTERNAL；rederive 在新步骤写入后同 TX 调，稳态上线事实也回调且带 launchFacts，不重开事务。方案应用前父锁和选中账号190已持，不能 release210 后首次补锁账号。PR2 补样片/包写侧及相应详情聚合/I7–13/I15；G2-A 补工单三负责人在办来源端口，当前 main 未注册，承接 W1-01b M2 既有留桩 | W1-16a 第 7、9、10 节；10 分组 第 2.1、5 节；W1-01b 第 7、9 节 |
| — | W1-16b；W1-19、W1-20、W1-21；G3-A、G5-A、G6-A | W1-16a PR2 十接口交样片、逐集/包质检与成片包。media 公开 ensureProductionStubs/consumeFinalReleaseBatch/recordAdoptedStoreAssets；批次消费是真实 ready final_release 行与引用交接，上游批次管理 API 仍待 G3-A。M1 只桥接本上下文人工无 AI，已有 mediaInfo 才回写时长/尺寸；无时长 uploaded 的 QC 受控拒绝零写，真实探测/水印留 G3-A。W1-19 live 造数须明确已知媒体事实并标注替身。W1-16b 写访问证据，GET 与确认不制造 evidence；G5-A 替换首次登记认领；G6-A 接清单编辑、ZIP 与到期定时器 | W1-16a 第 7、10 节；a05 第 3.30、3.38、3.39 节；m05 第 3.8、3.9 节 |
| — | W1-12、W1-18、W1-19、W1-20 | W1-09 分类上传入口：`lib/upload/taro.ts` 的 prepareTaroFile/createTaroUpload/useUploadBusy，纯编排 queue.ts 与生成 DTO 的 api.ts。pay_receipt 图片/PDF、channel_screenshot 及 licenseKind 复用；非图片/视频精确上限由登记 API 判，post 之外给小文件/代传说明；切店/退出取消、暂停可恢复，原 token/确认意图沿重试。审核 CompareTable/RejectDialog 已公开且被资质/发布账号两域复用；后继页面不复制修改 | W1-09 状态与本包 PR；原第 41 行归属不变 |


| — | W2-21、W2-22、W2-17、W2-23；W3-03、W4-02/10及M7回调包 | W2-01公共 `security.createWebhooks`/`WebhookSource`、两根 `webhookSources`，API `receiveWebhook`。verify在事务外用原始字节验签，POST必须event/error（仅h01明确两种可信skip免收件），restore本地恢复、handle复用传入Tx。inline原子/支付显式失败inbox兜底（必须summary+完整resourceCipher/kid）；inbox同TX出站、subscriber复用现有Tx、分钟50条SKIP LOCKED扫描。1/5/15分钟、1/6小时/8死信，支付5次升级；每日载荷UPDATE清理180/90天保留summary/举证。W4-02须补实际Provider公开的密文/kid适配，现有verifyAndDecrypt仅归一通知，不得深引；当前未挂真实hook/未验真实平台。W2-23接人工死信管理，W2-24接真实告警隔离/实现，不在本包偷偷detach | W2-01第4/7节；h01第2.1/2.4节；15分组第2.1/4节；security README第5/6节 |


| — | W2-31 所拆 G7-A；W2-30 | W2-08 单页 system.logs 已接真实 admin.auditLog.list/get、ops/access 权限、CSV/日期/对象查询、游标与脱敏详情；G7-A 接 admin.exportJob.create/audit_logs.list 与导出记录，保持后端先裁剪、scope/stream 授权和异步结果，不放空导出按钮。W2-30 接本页日期键盘、PII实际POST→auditLogId可查询、查询零新增审计与截图结论；未来关联详情按正式 link/权限补准确入口 | W2-08 第 3/4/7 节；admin README；W2-04 已落地审计/PII公共能力 |
W2-10精准授权移交：PR1的tenant公口是membershipAuthorizationsPort（tenant.membership_authorizations，无fallback），identity实现revokePortalGrants(tx,input)返回实际count。必须同时过滤主体和（owner范围时）原授权老板，只改尚未撤销的portal_session，重复不覆盖证据；now取调用方时钟，调用方在同TX先持主体及相关成员锁。PR1已随#133实际合入，主包移除店员不吊销全账号user_session，by_owner归档仍允许老板下载；真实阻断/取消收尾必须所属公开函数，缺装配不能当0。notify/portal登录producer不由此口实现，下游仍等整包。


### 5.3 W2-05 配置与审批 SLA 移交

W2-05 接齐系统配置13接口与 approval.onCalendarImported、sla.breach 的审批主体、calendar.coverage_check。x01 第2.3节已补实际 approval.recordExecuted 去重取法；审批仍采用既有 FOR UPDATE，不把锁强度优化混入本包。

| 接收方 | 实际公开入口与接入要求 |
| --- | --- |
| W2-06、W2-07 | 使用已结构化 a01 DTO 和当前/pending/version；字典 refCount 为 null 表示没有已注册来源，不能当成零。缺内置日历年份明确拒绝，当前只内置2026官方安排。 |
| W3-16 | 资质 OCR 字段修正先经 `approval.touchPending(tx, { approvalId, lockVersion })` 持30阶审批锁并只升版本，再锁所属领域行；真实字段更正及领域审计由本包自行持有。 |
| 后续引用写域 | 注册 `dictReferencesPort` keyed 真实只读计数来源；Profile/Content/Config 已接实际事实。新增启用项引用在事务中以该 dict_item 共享锁保护后检查并写业务，不能用恒零来源冒充没有引用。 |
| W4-08、W4-10、W4-13 | `ApprovalKind.executionSla(tx, row)` 返回真实 pending_execution、nullable exec_due_at、hasExecuted；审批通过的事务登记 execution timer，执行/作废/晚回调完成同事务取消。失败返回待执行不重新计时，缺来源不能假造已覆盖。 |
| W2-24 PR2 | 独立告警存储/投递接实际 alerts 端口；calendar coverage 的 detach 只隔离事务，不能豁免存活祖先的 Provider 外呼守卫。 |


## 6. 任务书加的前置（计划依赖列没有）

写任务书时查实的三处。已由一条计划小改补进计划 第 7.2 节依赖列与第 12 节（[changes/W0-04-post-kickoff-fixes.md](../changes/W0-04-post-kickoff-fixes.md)）。下表留作出处，“怎么办”一栏照旧有效（默认，W0-04 定）。

| 包 | 任务书加的前置 | 性质 | 怎么办 | 出处 |
| --- | --- | --- | --- | --- |
| W0-14 | W0-26（脱敏纯函数） | 开工前置 | 计划与 `status/W0-14.md` 的依赖已加 W0-26；开工时 W0-26 不在 main 上就停 | W0-14 第 3 节、第 11 节第 1 项 |
| W0-08 | W0-03（CI 与 `gates:selftest`） | 合并前置：开工不等，转非草稿要等 | 可以开工；PR 保持草稿，草稿不占待评审名额 | W0-08 第 3 节、第 11 节第 6 项 |
| W0-26 | W0-03（同上）；W0-11（时区子路径） | 合并前置：同上 | 同上 | W0-26 第 3 节、第 11 节第 1、2 项 |

以后的任务书再加这类前置：先改计划的依赖列并在 [changes/](../changes/README.md) 记一条，同 PR 改状态文件的“依赖”；不只写在任务书里。

## 7. M1 与环境泳道各包共用的口径（W0-31 定）

32 份任务书是七个会话并行写的，下面是统稿时定的共同做法。任务书的“依据”表里有一行指到本节；任务书与本节不一致时以本节为准，照做并在状态文件“偏差”记一句。

### 7.1 预拆成几个 PR 的包

按体量上限（计划 第 5.3 节“粒度”行）预先拆好，编号不变，状态文件一份。各 PR 的叫法各任务书不同（a、b；①、②；PR 1、PR 2），指的都是“第一个、第二个 PR”；带 a、b 后缀的编号（W1-01a、W1-04b、W1-11a、W1-16a 等）是另外的工作包，不是这里说的 PR。

| 包 | 任务书里的叫法 | 各 PR 交什么 | 只等第一个 PR 的下游 |
| --- | --- | --- | --- |
| W1-01a | PR ①、②、③ | ① authz 判定与数据范围；② 凭据与会话（staff 的服务层）；③ 接口、中间件、命令行、演示种子。①、② 可以两个会话同时做，③ 等前两个 | 无：下游都等三个 PR |
| W1-02 | ①、② | ① 登录链路、权限数据的真实来源、`admin:e2e:live`；② 员工账号页 | W1-09、W1-12、W1-19、W1-20 |
| W1-04 | ①、② | ① 会话与鉴权链；② 按角色裁剪、店员防回归、引导与“我的”聚合 | 无：商家端接口包要 ② 的店员防回归框架 |
| W1-05 | ①、② | ① 文案约束扫描（只等 W0-03、W0-27a）；② 页面与接线 | 无 |
| W1-06 | a、b | a 写侧框架（甲类）；b 读侧 3 条加字典项 1 条 | W1-08、W1-11b、W1-14 |
| W1-08 | a、b | a 商家端 13 条与给下游的进程内函数；b 后台 6 条（a 登记审批类型与权限动作，后台处理器在 b 才挂载） | W1-09 仅小程序六页可等 a，后台页面必须等 b；W1-14、W1-15、W1-16a 等 a |
| W1-10 | a、b | a 账户与批次、读函数、`billing_advance`；b 冻结单一族与取整规则 | W1-11a、W1-11b、W1-13 |
| W1-11a | a、b | a 账本侧（建周期、`fulfill`、两个端口）；b 付款侧（`applyPayment`、差异单） | 无 |
| W1-15 | a、b | a 报价与确认订购（甲类）；b 选剧单与读侧（没有资金写入，按乙类看） | W1-17 |
| W1-16a | PR 1、PR 2 | 1 工单与方案；2 样片、成片、成片包 | W1-17、W1-19 的第一个 PR |
| W1-17 | a、b | a 状态推导与 order 侧端口的实现；b 开工事务与三个触发点 | 无 |
| W1-18 | PR 1、PR 2 | 1 首页、商城、详情、选剧单；2 确认订购、订单、发布账号 | 无 |
| W1-19 | PR 1、PR 2 | 1 订购单两页、工单池、账号核验；2 工单详情与表单、交付主路径的 Playwright | 无 |
| W1-23、W2-25、W2-27 | a、b 两步 | 见各任务书第 9 节 | W2-26 只等 W2-25 的第一步；W2-29 只等 W2-27 的第一步 |
| W2-26 | a、b1、b2 三步 | a 节点步骤、通道编排、回滚与测试；原 b 下拆 b1 持续探测、全资源/DB核对与双版演练，b2 上传体验版与工作流消费者（另等 W2-25b actual main）；按任务书第 9 节预拆，见 [原变更](../changes/W2-26-split-a-b.md)与[续拆](../changes/W2-26-b-split-b1-b2.md) | 无：下游等整包 |
| W2-10 | PR1、主包 | PR1甲仅tenant定义端口、identity同事务精准吊销portal授权；其actual后主包乙17接口/2x01/2桩，其他缺失收尾公口仍由拥有者先实际交；见[记录](../changes/W2-10-portal-revocation-first.md) | 无：下游等整包 |
| W2-12 | PR1、PR2 主包 | PR1仅有界对象读取、隔离正文技术转换、精确依赖和两应用真实产物，0 HTTP/页/x01/桩；actual后PR2乙交原8接口/2cron/2桩；见[记录](../changes/W2-12-document-capability-first.md) | 无：W2-16仍等整包，计划PR与PR1均不代替整包actual |

体量仍超上限而没有再拆的三处，由调度会话在 PR 上定，会话不停下：W1-04 的 ①（约 1,100 行）、W1-15 的 a（约 1,200 行，只有“确认订购”一个机制）、W1-08 的 a（约 1,900 行，乙类按接口数 13 条不超）。

### 7.2 状态文件怎么写，下游怎么等

- 一个会话只交一个 PR：开工先看本包状态文件的“PR”一栏与 main 上已有的文件，接着做下一个。
- 不是最后一个的 PR：状态写“进行中”，“偏差”首行写“第 N 个 PR 已合并：交了什么”，“PR”一栏由调度会话开 PR 后填上编号。最后一个 PR 才把状态写“完成”。
- 只等第一个 PR 的下游，状态文件“依赖”里写成文字条件（如“；开工另等 W1-10 的第一个 PR”）；本包后一个 PR 另等谁，也写成文字（如“；第二个 PR 另等 W1-01b”）。汇总脚本判不了文字条件：编号那一段齐了，它就把本包列进“可开工的包”，文字条件原样写在“另需核对”一栏。看到“开工另等”的，开工前先看那个包的状态文件：“PR”一栏已有合并了的编号、“偏差”首行有“第 N 个 PR 已合并”才算齐；没齐就不开工。
- 另有两句不是等“第一个 PR”的文字条件，同样列在“另需核对”：W1-06、W1-16a 的“开工另等 W0-30a 合并”（W0-30a 是调度会话从 W0-30 提前拆出来的包，交 `flow` 的工作分钟端口的实现；它合并之前审批单、交付工单一迁移就抛错）：main 上有 `docs/plan/status/W0-30a.md` 且写“完成”才算齐。写成文字是因为 W0-31 合并时那个状态文件还不在 main 上，写编号过不了状态文件核对；它合并后可以由台账 PR 换成编号。W1-10 的“开工另等 kernel 的提交时错误码小修补合并”：那个修补没有编号，看第 5.1 节里接收方是“调度会话另派的 kernel 小修补”的一行与 W1-10 任务书 第 3 节的判据。这两句现在都已满足（2026-10-06 核对）：W0-30a 已合并（#51），那个小修补随 KF-1 合并了（#54）；状态文件与计划里的文字没有换成编号。
- 预拆已由 W0-31 记过计划变更（[changes/W0-31-m1-early-start-and-deps.md](../changes/W0-31-m1-early-start-and-deps.md)），各包不用再记；实际拆法与任务书不同时才记一条。

### 7.3 共用文件怎么不撞

| 文件 | 规矩 |
| --- | --- |
| `packages/contract/src/contract.test.ts` 钉的条数、`packages/contract/generated/` | 每个接口包都要改同一处。冲突时变基后重新数、重新生成，不手工合并（`CLAUDE.md` 第 6 节规则 23） |
| `infra/ci/landed-baseline.txt` | 接口包不动（并排加行必冲突），由合流包 W1-21 降 |
| 契约的路由文件、结构与事件 | 只把自己的条目从 `…Meta` 换成 `…Route`，别人的条目与元数据不动（规则 26）；结构写在同目录自己的 `<资源>.schemas.ts`；各接口文档目录下的 `error-details.ts` 先到的新建、后到的只增；`events/index.ts`、`apps/api` 的路由汇总文件只加一行 |
| 两条提前到 M1 的接口 | `admin.auth.activate`（W1-01a 的 ③）、`admin.dictItem.list`（W1-06 的 b）各改 `routes/milestones.ts` 里自己的一行，改后重新生成计划 第 8.2 节的表；谁后合并，变基后重新生成 |
| `packages/services/src/demo-seed.ts`（演示种子运行器） | W1-01a 的 ③ 起头（`pnpm db:seed:demo`）。各模块的种子放 `<模块>/demo-seed.ts`，只经服务函数写；运行器里各加一行，先后固定：staff → 占位文件入库（W1-07）→ docs（W1-03）→ billing（W1-11b）→ content（W1-13）→ 演示参数（W1-21）。只进本地、测试与预发，`APP_ENV=prod` 拒绝（计划 第 8.5 节）；仓库里不放任何固定口令，演示员工都建为待激活 |
| `packages/services/src/kernel/` 的公共接口 | 同一时间只许一个在途包改（计划 第 9.1 节）：W1-01a 的 ②（`loadEnv` 加 `AUTH_KEYS_FILE`）、W1-03（新增 `kernel/ports/merchant-facts.ts`）开工前看汇总，错开 |
| 读侧事实端口 `kernel/ports/merchant-facts.ts` | W1-03 定义全八个键，各键由所属模块在自己的 `register.ts` 注册：`profile` W1-08、`billing` W1-11a（一次注册全）、`order` W1-15、`publish` W1-14；`notify`、`asset`、`ad`、`support` 在 M2、M3、M5、M7 |
| `apps/weapp/src/pages.ts`、`apps/admin` 的 `routes/modules/*.ts` 与 `lib/menu/*.ts` | 只动自己的行；`docs/plan/pages.md` 只由脚本重新生成，冲突时变基后重新生成 |
| `apps/weapp/src/lib/upload/` | 归 W1-09。W1-12 先到时在同一目录放最小实现，后合并的一方并成一份 |
| `apps/weapp/src/sub/order/result/` | 页面壳归 W1-12，按 `type` 分文件；W1-18 只加 `order.tsx` 与分发处一行，谁先合并谁建壳 |
| `infra/ci/copy-rules.json` | W1-05 的 ① 新增；页面包只增规则与反例（`gate-touch`） |
| 两端的通用构件与页面骨架 | 页面包不改（规则 27）。缺的先做成页面私有的；两个包要用同一样东西时，由先到的包开单独的构件 PR 提升 |
| `apps/api/golden/clerk-visible-keys.snap`、后台权限矩阵的黄金文件 | 只增自己路由的条目，用命令重写，不手改 |
| 计划 第 7.3 节留桩清单、本文第 5 节移交表 | W0-31 已集中补过。各包只在开工后有新的清单外留桩、新的移交事项时才加行 |

### 7.4 留桩、变更、移交怎么记

- 留桩一项一个文件，登记在 [stubs/](../stubs/README.md)。“留桩内容”一行不要用反引号写接口的 operationId：`infra/ci/landed.mjs` 会把那条接口判成未落地。
- “M1 内的端口桩”（计划 第 7.3 节留桩清单同名一行）：定义方登记，实现方合并时把那个文件改成“已回补”，W1-21 核对。
- 任务书里写明的预拆、清单外留桩、两条接口的归属提前，W0-31 都记过变更；各包不用再记，也不用再往计划里加行。实际做法与任务书不同（另拆、改归属、新留桩）才照 [changes/README.md](../changes/README.md) 记一条。
- 任务书末尾“往后移交”的各行已进第 5 节，不用再加；做的时候发现新的才加行，新行不编号、首列写“—”（第 5 节开头）。
- 开工时发现任务书引用的上游交付物与 main 上的实际不一样（函数名、目录、命令）：以实际为准照做，在状态文件“偏差”记一句，不停下来。

### 7.5 两条鉴权链给接口包的约定

- 后台接口：处理器用 W1-01a 交的 `defineAdminHandler(路由, { module, need }, 处理函数)` 登记并声明模块等级；接口测试的登录态用 `signInAsStaff`；权限矩阵黄金文件只增自己路由的行。
- 商家端接口：标了 `trimmed`、`same` 的路由各交一份店员回放样例，响应经 `respondByRole` 出；黄金文件只增条目（框架由 W1-04 的 ② 交）。
- 路由的 `x-rate-limit`、`x-three-phase` 两类声明，W0-10 接管时都没带（路线图里没有）：各域第一个后端 PR 给自己的路由补上，档位名照 W0-22b 的说明。
- 同层没有白名单的读取（如 order 读渠道账号，publish 读工单与订单项的几列，approval、profile 读员工的展示列）：在本模块的仓储里只读查表，不 import 对方模块；写入一律走端口，定义方先合并并给空实现。06 第 3.6 节没写这一条，是任务书定的默认。

## 8. W1-23 的三里程碑拆包交付

W1-23a交[分配表](../changes/W1-23-m2-m4-package-map.md)、M2共25本（01–19、21–24、30–31）与M2/M3/M4全部64状态；原环境25–29保留。W1-23b交齐M3 19本与M4 20本；以实际合入任务书和各包具体依赖开工，不得仅凭状态或未合分支开工。各组具体接口/页/x01/桩责任以分配表第2–4节为准。

| 移交方 | 接收方 | 内容与边界 |
| --- | --- | --- |
| W1-23a | W2-01/02 | 回调单机制与共用构件优先，供M3/M4接入；下游不重写框架/通用件 |
| W1-23a | W2-03/17/22 | 激活码短信经注入端口，staff不直接同步导入notify；实际短信由driver接 |
| W1-23a | W2-24 | PR1独立kernel.detach；PR2 actual后再probe/alerts，整包两PR齐才完成 |
| W1-23a | W2-18/24、W2-27 | 错误转发与探针告警为代码包；环境接通分别等18与24第二PR，未真实部署不称已验 |
| W2-24 PR2 | W2-17 | actual合入后复用owned notify.sendSystemAlert(tx,{alertId,fingerprint,severity,recovered,noticeNo,at})、s.system_alert/N0/vars/模板与唯一去重；notification/staff_message/inbox delivery同TX真实写；不另造告警producer/第二框架 |
| W2-24 PR2 | W2-31拆G7-A企业微信包、W2-22 | actual合入后真实driver实现WecomProvider.sendRobotMessage({title,content,mentionAll})；群机器人不能拿sendAppMessage冒充；独立值班SMS仍走SmsProvider.sendOncallAlert。当前unconfigured/fake证明独立发送/失败，不证明云端到达 |
| W2-24 PR2 | W3-01、W2-27 | actual合入后StorageProvider备份专用backupPutStream/head/copy有界方法与显式目标；四业务桶枚举不变。部署挂只读URL_FILE/公钥/桶、明确证书DNS；真实COS/备份恢复/域名证书/告警到达另授权验 |
| W2-24 PR2 | G7-B/M7工作台读侧包（尚未拆编号） | 实现四admin.workbench聚合后扩P95真实HTTP样本；当前逐项excluded无假0。D7-16仍待预发机器完整清单验收 |
| W1-23a → 本段b | W2-01/02及M3/M4各包 | 39本已覆盖全部分配与既有后台页增量、冻结媒体事实及权限/版本；Q8/Q10/Q13按既定默认；G2-0 actual后按本书依赖开工 |

W3-06同编号先交甲级session advisory mutex公开能力与必要工厂接线，后交乙级文件恢复/彻删；领域段必须等待前置PR实际合入，两PR齐才完成。正式a01规定全用例持锁，不能用普通事务行锁或领域裸连接替代；b任务书按此展开。
