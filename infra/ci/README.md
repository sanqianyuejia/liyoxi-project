# infra/ci：检查脚本与门禁

依据：[开发计划](../../docs/08-development-plan.md) 第 5.3 节“门禁改动”行、第 5.5 节、第 10.1 节；W0-03 任务书。
脚本都是 `.mjs`，不引依赖，用法写在各自开头的注释里。用例在 `test/`（Vitest 的 `infra` 项目），真 git、真子进程，在仓库外的临时目录里造反例。

## 1. 这里有什么

| 文件 | 做什么 | 谁在跑 |
| --- | --- | --- |
| `check-rename.mjs` | 换名检查 | `pnpm check:rename`；CI |
| `check-release-age.mjs` | 锁文件里的版本都发布满 7 天 | CI（`--since` 只查新增的） |
| `check-layers.mjs`、`layers.json` | 模块分层登记与目录一一对应 | `pnpm depcheck`；CI |
| `check-env-example.mjs` | `.env.example` 的键集合等于 `loadEnv` 的键集合，值都是占位 | CI |
| `check-colors.mjs`、`colors-allowlist.txt` | 页面不写色值：三个前端的 `src` 里出现十六进制、颜色函数或 Sass 的颜色运算即失败。白名单初始为空，按 `frozen` 登记，加条目走单独的 `gate-change` PR | `pnpm lint:colors`；CI |
| `check-untracked.mjs` | 给定目录下没有 git 未跟踪的文件（生成物都已入库） | `pnpm design:check` 的第三步；CI |
| `secret-scan.mjs` | 密钥扫描：gitleaks 官方镜像的固定标签，扫 HEAD 能到的全部提交，合并提交按它相对第一个父提交的差异扫（别的分支上的提交由它自己的 PR 扫）。放行项只在仓库根的 `.gitleaks.toml`，逐条写原因；写在被扫文件里的行内放行注释（`gitleaks:allow`）不认。所有文件都按文本出差异（`--text`），`.gitattributes` 里把一类文件标成 `-diff`、`binary` 也照扫。git 历史没读全（gitleaks 报了 git 的错误）按没跑完算，不报通过 | CI；本机要有 Docker |
| `classify-gate-changes.mjs`、`gate-files.json` | 门禁改动分类：只增（`gate-touch`）与放松（`gate-change`） | CI 的 `gate-classify` 任务 |
| `ci-required.mjs` | 汇总任务 `required`：判定必过任务的结论，统计耗时，出 `ci-duration.json` | CI 的 `required` 任务 |
| `status-summary.mjs` | 核对各包的状态文件合不合规；生成状态汇总 `docs/plan/status/SUMMARY.md`（不入库，要看时现生成） | CI 用 `--check` 只核对状态文件；`pnpm status:summary` 在本地现生成（第 6 节） |
| `selftest/run.mjs`、`selftest/cases/` | 门禁自测：一个反例一个文件 | `pnpm gates:selftest`；CI |
| `db-catalog-diff.mjs`、`db-lib.mjs` | 系统目录比对（W0-05）：由底稿建的参照库与首版迁移建的库逐项 0 差异，数量两组口径对得上；出报告。`db-lib.mjs` 是连库、读系统目录、计数的共用部分 | `pnpm db:catalog-diff`；CI |
| `db-verify-managed.mjs` | 托管库验证（W0-05）：两个扩展可建、迁移跑通、数量对得上；不打印连接串 | `pnpm db:verify-managed`；业主在托管库上跑 |
| `db-verify-grants.mjs`、`db-grants-rules.mjs` | 角色与授权的核对（W0-06a）：两个角色在、成员与属主合规、授权生效、分区表可写可查；只读系统目录（另有一处插完即回滚的写入），不打印连接串。前一份是命令，后一份是不连库的判定规则（拆开是为了用例能不动实例就验到成员那几条）。期望的授权不写在脚本里，读 `packages/db/src/grants.expected.json`（与权限测试共用，不是门禁文件）：加表、加函数、改一张表的授权的包往那里加行、改行，脚本与它的用例不用改，用例里不写数量、不点名表的权限（[packages/db/README.md](../../packages/db/README.md) 第 9 节）。缺省只认 `lyx_` 开头的库名，核对别的库名加 `--database <库名>`；要 PostgreSQL 16 及以上。没有改 `db-verify-managed.mjs`（改已有的检查脚本是放松类改动），做成它的后置步骤 | `pnpm db:verify-grants`；根脚本 `postdb:verify-managed` 让 `pnpm db:verify-managed` 成功后自动接着跑（要经 pnpm 跑才有这一步；`test/db-verify-managed-hook.test.ts` 把它钉住，核对不通过时整条命令的退出码也钉住） |
| `grants-floor.txt` | 授权下限清单（W0-06a）：受限的表上应用角色最多能有什么权限，一行一张表。期望数据不是门禁文件，这一份是：按 `append` 判，加行（新登记一张受限的表）算只增，删行、改行（放开）算放松，要走单独的 `gate-change` PR。期望与库里的授权都不得超过它，受限的表都得登记。写法与放开的走法见文件开头 | `db-verify-grants.mjs`；`test/grants-floor.test.ts`（不连库） |
| `fixtures/` | tsconfig 预设的最小工程；依赖方向与分层的反例夹具 | `pnpm typecheck`；用例与门禁自测 |
| `pages/generate.mjs`、`pages/sources/` | 页面清单：由后台菜单登记表与下载页页面清单生成 `docs/plan/pages.md`。一个端一个数据源文件，自动收集；小程序的由 W0-27a 往 `sources/` 里加 | `node infra/ci/pages/generate.mjs`；CI 用 `--check` 核对无差异 |
| `apps/admin/scripts/check-build.mjs`（不在本目录） | 后台与下载页的构建产物检查：文件名带内容哈希、写入了构建号、是生产构建、不含夹具的标记 | 两个应用各自的 `build` 脚本，即 `pnpm admin:build`、`pnpm portal:build`；CI |
| `apps/admin/scripts/e2e-affected.mjs`（不在本目录） | 后台冒烟的受影响范围判断：PR 改到后台或它依赖的部分才跑，推到 main 一律跑 | CI 的“后台冒烟要不要跑”一步 |
| `check-type-hoist.mjs` | 类型解析不靠提升：写 JSX 的工程解析类型时，不许经 pnpm 的私有提升目录落到各工程装得不一样的包上；工程自己声明的类型包在程序里只许出现自己装的那一份（第 7 节） | `pnpm check:type-hoist`；CI |
| `landed.mjs`、`landed-baseline.txt` | 已落地判定与待落地清单（W0-10）：一条 V1.0 接口“已落地”= 挂了真实处理器 + 有接口层测试引用它的 operationId + 不在留桩清单；待落地数高于基线即失败（第 7 节） | CI（`--check --report`）；里程碑退出时加 `--require` |
| `plan-routes.mjs` | 计划 第 8.2 节的表由路由清单生成（W0-10）：V1.0 的接口都有里程碑，表与清单无差异；另出业主评审用的归属汇总 | CI（`--check --summary`）；改了归属后本地跑 `--write` |
| `natural-constraints.mjs` | natural 幂等的约束名核对（W0-10）：契约里写的每个约束名在迁移后的库里都找得到 | CI；只读 `lyx_migrate_check` |
| `api-check.mjs` | api-check 进 CI（W0-10）：跑 `tools/api-check/check.py`，“表.列”一项未核对按失败算；通过后用两个生成脚本重新生成三份登记文档（`docs/api/registry-*.md`），`git diff --exit-code` | CI；只读 `lyx_migrate_check` |

工作流在 `.github/workflows/`：`ci.yml`（每个 PR 与推到 main）、`nightly.yml`（每晚，Node 26，失败只告警）。

## 2. CI 的结构

必过任务并行跑（执行机 2 核，串成一个任务时要十多分钟）。各任务各自检出、装依赖（pnpm 的仓库有缓存），只挂自己用得到的服务容器，端口与账号同 `infra/compose/local.yml`；连接参数（`APP_ENV`、`DATABASE_URL`、`REDIS_URL`）写在工作流顶层一处，全部任务相同。

| 任务 | 内容 | 备注 |
| --- | --- | --- |
| `verify` | 静态检查：lint、格式、换名、页面不写色值 → 生成数据库客户端 → 类型、类型解析不靠提升 → 依赖方向与五层 → `prisma validate` → `contract:check`、登记表对账、状态机迁移表对照、接口侧注册表对账、路由元数据对账、设计生成物无差异（上传预览页）→ `.env.example` 核对、状态文件核对 | 不挂服务容器：这里的步骤都不连库 |
| `test` | 生成数据库客户端 → 首版迁移的等价性证明（由底稿建参照库、空库跑全部迁移、系统目录比对、再跑一遍、上传报告）→ 枚举与库 CHECK 一致 → 起 MinIO、MinIO 驱动的用例 → 测试（`pnpm test --project '!infra'`：infra 以外的全部测试项目）→ api-check、natural 幂等的约束名核对、待落地数只减不增、里程碑归属与计划 第 8.2 节的表（上传两份清单） | 挂 PostgreSQL 17 与 Redis 7.4；MinIO 用 compose 文件起 |
| `test-infra` | 建迁移库 → 测试（`pnpm test --project infra`：本目录 `test/` 下的用例） | 挂 PostgreSQL 17：连库的几份用例自己建临时库，约束名核对的用例只读迁移库 |
| `test-isolation` | 生成数据库客户端 → 建迁移库 → 起 MinIO → `test:isolation` | 挂 PostgreSQL 17 与 Redis 7.4；MinIO 同上 |
| `web` | 构建 → 后台与下载页的单测、构建、页面清单 → 后台冒烟（按受影响范围跑；浏览器有缓存）→ 上传截图 | 不挂服务容器 |
| `gates` | 密钥扫描、依赖审计、新增依赖发布时长 → 建迁移库 → `gates:selftest` | 挂 PostgreSQL 17 |
| `gate-classify` | 门禁改动分类；把清单写进 PR 描述顶部两个标记之间；有只增项就打 `gate-touch` | 只在 PR 上跑；只有它能写 PR |
| `required` | 依赖上面全部任务；任何一个没成功（失败、被取消、被跳过）即失败；出时长统计 | 业主在 main 的保护规则里只把它设为必过 |

- 一道检查只放在一个任务里，放哪个看它要什么：不连库的放 `verify`；要迁移库、Redis、MinIO 的，或要排在“测试”之后的（读测试留下的产物），放 `test`；本目录 `test/` 下的用例自动进 `test-infra`；前端的放 `web`；扫描、审计与门禁自测在 `gates`。一个任务没过，其余的照跑完，`required` 最后一起判。
- 根上的 `pnpm test` 在 CI 里分两个任务跑：`test` 跑 infra 以外的全部测试项目（写成排除 `--project '!infra'`，以后新加的测试项目自动落在这一边），`test-infra` 跑 infra 项目，合起来是全量。本地照旧跑 `pnpm test`。两条命令由 `test/workflows.test.ts` 钉住。
- 迁移库 `lyx_migrate_check` 由用到它的任务各建一份（`test`、`test-infra`、`test-isolation`、`gates`），命令相同。数据库客户端也只在用到它的任务里生成（`verify` 的类型检查、`test`、`test-isolation`）；`test-infra`、`web`、`gates` 用不到。
- PR 上按分支分组：同一个分支的新提交会取消在途的运行。推到 main 时一个提交一组：不取消，也不会因为排队被后一次合并顶掉，每次合并都跑完。
- 执行机只写在 `ci.yml` 的一处（`verify` 的 `runs-on` 带锚点 `&runner`），`nightly.yml` 另有一处。改成自托管执行机时改这两处；自托管机器上要有 Docker 与 `gh`。
- MinIO 不是服务容器（W0-19 加）：`test` 在“测试”之前有两步，先用 compose 文件只起 `minio` 一个服务（镜像、端口、账号只写在 `infra/compose/local.yml` 一处），再带 `LYX_TEST_MINIO=required` 跑本地存储驱动的用例，MinIO 连不上即失败。不带这个变量时（“测试”一步、每晚任务、本机没起依赖）那份用例里要连 MinIO 的几组只跳过。`test-isolation` 同样先起 MinIO，两个会话里那份用例照跑。每晚任务不起 MinIO。
- 格式那一步跑的是 `pnpm format:check --ignore-path .prettierignore`：忽略项只认 `.prettierignore`（门禁文件）。Prettier 缺省把 `.gitignore` 也当忽略文件读，往 `.gitignore` 加一行就能让已入库的文件不查格式，而 `.gitignore` 不是门禁文件。本地直接跑 `pnpm format:check` 仍会读 `.gitignore`（本机的 `.vscode/` 之类不用查）；两者只在“已入库又被 `.gitignore` 盖住”的文件上有差别，以 CI 为准。
- `contract:check`（W0-08）在 `verify` 里，`pnpm test` 在 `test`、`test-infra` 里，都在必过里，缺一不可。`contract:check` 先重新生成、再 `git diff --exit-code`：`git diff` 看不到未跟踪的文件，新增一种生成物却忘了 `git add` 时它不会红；这由契约自测里问 git 索引的那一条拦，所以 `pnpm test` 要在 git 检出里跑。契约自测另有一条拿提交的生成物与现生成的逐字节比对：它与 `contract:check` 不在同一个任务里，各用各的检出，谁先谁后不相干（在同一份检出里跑时，要赶在 `contract:check` 把文件重新写出来之前）。
- 工作流的写法有约束，`test/workflows.test.ts` 按行读、认不出就失败：顶格的键与任务下面四格缩进的键不带引号；`jobs:` 逐字一行；任务编号写成两格缩进的 `<编号>:`，冒号后面不带注释；每个任务恰好一行 `name: <编号>`，检查名与任务编号相同。必过检查名 `required` 在全部工作流里只有一个。哪个工作流都不给令牌 `checks`、`statuses` 的写权限（有了它能经接口造出任意名字的检查）。
- 第三方 Action 固定到提交 SHA，行尾注明版本；升级单独成 PR。
- CI 里不放密钥。工作流里的连接串是本地开发的固定值，只对当次运行的服务容器有效。
- 时长：`required` 的运行摘要与产物 `ci-duration.json` 列出各必过任务的耗时，另给两个数。跨度（`wallSeconds`）是从最早开始到最晚结束，也就是一个 PR 要等多久；合计（`totalSeconds`）是各任务耗时之和，也就是占用的执行机时间。预算 15 分钟比的是跨度（`overBudget`），超了只标出、不阻断（M0 退出时由 W0-30 核对）；任务书验收里写的“`ci-duration.json` 的合计 ≤15 分钟”，拆成并行任务之后按跨度核对。合计不设预算：每个任务各付一遍检出、装依赖、起容器的开销，拆得越细它越大，等的时间却越短。
- 设计地基（W0-26）在 `verify` 里有三步：换名检查之后的“页面不写色值”（`pnpm lint:colors`）；“设计生成物无差异”（`pnpm design:check`）与紧跟着的“上传设计预览页”。预览页是产物 `design-preview`（`packages/shared/dist/design-preview/`，不入库），目录里没有文件时上传那一步失败；业主合并前在运行页面的 Artifacts 里下载来看。
- 首版迁移（W0-05）的七步分在两处。生成数据库客户端（`pnpm db:generate`；客户端不入库）：`verify` 的“类型”之前、`test` 与 `test-isolation` 的开头各一步。`prisma validate` 在 `verify`（不连库）。其余五步在 `test` 的“测试”之前：由底稿建参照库 `lyx_schema_check`（校验工具按自己的锁文件用 npm 装，带 `NPM_CONFIG_IGNORE_SCRIPTS` 不执行安装脚本，再跑 `check.py --keep`）；空库 `lyx_migrate_check` 上跑全部迁移；系统目录比对；再跑一遍迁移与比对；上传比对报告（产物 `db-catalog-diff`，比对没过时也传）。排在“测试”之前，是因为 `packages/db` 的用例要连迁移库。用法与口径见 [packages/db/README.md](../../packages/db/README.md) 第 6 节。
- 后台与下载页骨架（W0-28）的七步在 `web` 的“构建”之后：“后台与下载页单测”（`pnpm --filter @liyoxi/admin --filter @liyoxi/portal test`；根上的 `pnpm test` 不含这两个应用，它们的单测与构建共用各自的 `vite.config.ts`）；“后台与下载页构建”（`pnpm admin:build && pnpm portal:build`，产物检查在各自的 `build` 脚本里）；“页面清单无差异”；“后台冒烟要不要跑”（`apps/admin/scripts/e2e-affected.mjs`，结论写进步骤输出）；它后面几步带条件，只在结论为要跑时执行：装浏览器、“后台冒烟”（`pnpm admin:e2e`）、“上传后台冒烟截图”，以及装浏览器之前的两步缓存（取 Playwright 的版本当键、`actions/cache` 缓存 `~/.cache/ms-playwright`：命中时装浏览器那一步不再下载，只补系统依赖）。截图是产物 `admin-e2e-shots`（都是 1440 × 900：01–04 是外壳与三种骨架，05–12 是空、出错、处理后、冲突、上传失败、二次确认、403、已处理的事项几个状态；用例失败时另有现场），业主合并前在运行页面的 Artifacts 里下载来看。冒烟不跑的 PR（没改到后台的受影响范围）没有这个产物。写法由 `test/admin-ci.test.ts` 钉住。
- x01 名称登记与枚举（W0-09a）的两步分在两个任务里。“登记表对账”（`pnpm registry:check`）在 `verify`，排在 `contract:check` 之后：由契约的登记数据重新生成归属表 `docs/plan/x01-map.md` 后 `git diff --exit-code`，再拿登记数据与 x01 对账；不连库。“枚举与库 CHECK 一致”（`pnpm enums:check`）在 `test`：读前面“空库跑全部迁移”一步建的 `lyx_migrate_check`，只读。两个检查脚本在 `packages/contract/scripts/`，不在本目录：`infra/` 不在工作区里，按包名引不到契约。归属表是单个文件，`generated` 口径只认“目录/**”（第 5.1 节），所以它按“算门禁路径、不逐行判”登记（条目的 `except` 盖住它自己）：重新生成不进 PR 顶部的清单，删掉它分类也不报；它与登记数据一致由 `registry:check` 与契约自测（`pnpm test`）把关。
- 每晚任务（`nightly.yml` 的 `node26`）跟着补了四步，都是新增的整步。“类型”之前一步：生成数据库客户端（`pnpm db:generate`）。“类型”与“测试”之间三步：起 PostgreSQL 与 Redis；把连接参数（`APP_ENV`、`DATABASE_URL`、`REDIS_URL`，取值与 `ci.yml` 顶层的相同）写进 `$GITHUB_ENV`，后面的“测试”读得到；空库 `lyx_migrate_check` 上跑全部迁移。它不挂服务容器：往已有的任务里加 `services`、`env` 算放松类改动（第 5 节），所以库用 compose 文件起，与 `test` 的“起 MinIO”同一种写法，镜像、端口、账号取 `infra/compose/local.yml`。`ci.yml` 里的 `prisma validate`、由底稿建参照库、系统目录比对它不跑：那是首版迁移的等价性证明，`pnpm test` 用不到参照库 `lyx_schema_check`。执行机上要有 Docker（带 compose）与 `psql`，与 `test` 相同。往每晚任务加一步时，在 `test/workflows.test.ts`“nightly.yml”一组的命令清单里同一位置加一行（只增）。
- 状态机迁移表（W0-12）在 `verify` 里有一步，排在“登记表对账”之后：“状态机迁移表对照”（`pnpm machines:check`）。拿 `packages/shared/src/machines` 的 25 张迁移表与数据模型分组文档的状态机表逐行对照（当前状态、事件码、新状态、有无守卫），并核对状态机与状态列的清单与契约登记、01 分组 第 3.2 节、`catalogue.json` 一致；只读文件，不连库，本机约 1 秒。脚本在 `packages/shared/scripts/machines-check.ts`，不在本目录，理由同 W0-09a 那一条；口径写在脚本开头的注释与 [packages/shared/src/machines/README.md](../../packages/shared/src/machines/README.md) 第 4 节。脚本与迁移表都没有登记成门禁文件（照 W0-09a 两个对账脚本的先例）：对照被削弱由门禁自测的反例拦，改迁移表的 PR 靠这一步保证分组文档同步改了。覆盖检查（`pnpm machines:coverage`）现在只出报告，不在 `verify` 里，M1 起才进门禁（计划 第 5.5 节）。
- 接口侧注册表（W0-09b）在 `verify` 里有一步，排在“状态机迁移表对照”之后。“接口侧注册表对账”（`pnpm api-registries:check`）：拿契约里的领域错误码、权限点、能力点、资源登记、通知场景、订阅点位、埋点事件与登记文档、`docs/api/working/` 的底稿逐字段比；只读文件，不连库，约 2 秒。检查脚本在 `packages/contract/scripts/`，理由同 W0-09a 那一条。数量不写在脚本与反例里：取登记文档各节标题里写的数，同表格行数、契约条数三方比。场景键、埋点事件名两种写法另并进 W0-09a 的 `pnpm enums:check`，同库里的 CHECK 正则逐字比。
- `verify` 的“类型”之后有一步“类型解析不靠提升”（`pnpm check:type-hoist`）。它不看类型检查这一次过没过，看的是结果会不会随 pnpm 提升了哪一份而变，所以两步都要。来历、口径与失败了怎么办见第 7 节。每晚任务没有加这一步：它查的是结果会不会随安装变，与 Node 版本无关。它的用例（`test/type-hoist.test.ts`）只摆小树，不对本仓库再跑一遍。
- 路由元数据接管（W0-10）的六步分在两个任务里，五步检查加一步上传，都只读，合计几秒。“路由元数据对账”（`pnpm contract:docs-check`，脚本在 `packages/contract/scripts/`，理由同 W0-09a 那一条）在 `verify`，排在“接口侧注册表对账”之后：不连库。其余五步在 `test` 的“测试”之后：“api-check”；“natural 幂等的约束名核对”；“待落地数只减不增”；“里程碑归属与计划 第 8.2 节的表”；“上传里程碑归属汇总与待落地清单”（产物 `route-milestones`，两份 Markdown，写在 `packages/contract/dist/`，不入库）。前两步读前面“空库跑全部迁移”建的 `lyx_migrate_check`：任务书原定给 api-check 另建一个 `lyx_api_check`，为省时长改成共用，两个库的内容相同。后两步不连库，放在 `test` 是因为“待落地数只减不增”要排在“测试”之后（已挂载处理器的清单 `apps/api/dist/mounted-operations.json` 由 `apps/api` 的测试装配导出，W0-22 接上），它出的清单又与“里程碑归属”那一步的由同一步上传。约束名核对的用例（`test/routes-gates.test.ts`）只读迁移库，所以 `test-infra` 在“测试”之前也建一份。口径见第 7 节。

## 3. 怎么加一步检查

1. 检查脚本放本目录，新增文件；用例放 `test/`。
2. 在 `ci.yml` 里用得上它的那个任务里新增一个完整的步骤（`- name:` 开头的一整段）。放哪个任务见第 2 节：不连库的放 `verify`，要迁移库、Redis、MinIO 的放 `test`，前端的放 `web`；放在任务末尾，或挨着同类的步骤。要单独成任务时，新增一个完整的任务，并在 `required` 的 `needs` 里加一行；新任务照已有的自己检出、装依赖，要连库就自己挂服务容器。`needs` 一行一个，不要写成方括号的行内列表。任务照已有的写：两格缩进的 `<编号>:`，下面一行 `name: <编号>`，键不带引号（第 2 节）。
3. 同一个 PR 里加一个反例（第 4 节）。CLAUDE.md 第 8 节：每加一道门禁，同包加一个反例进 `gates:selftest`。
4. 新的门禁文件不在 `gate-files.json` 已有条目的范围内时，登记进去（第 5 节）。
5. 根脚本要加命令时只新增，不改已有的；命令补进 `CLAUDE.md` 第 9 节。

这些都是“只增”类改动：CI 打 `gate-touch`，差异列在 PR 描述顶部。不要在已有的步骤里加行、改行，也不要改已有的检查脚本与反例（加一行也算）：那会被判成放松，要改就走单独的 `gate-change` PR。

`test/workflows.test.ts` 里每个任务各有一张命令清单（`STEPS`），逐条列了那个任务里的命令：往哪个任务加一步，就在它那张清单的同一位置加一行，否则 `pnpm test` 会红；新增任务时加一张清单。只加行是“只增”（用例按 `append` 判）。

## 4. 怎么加一个反例

在 `selftest/cases/` 新增一个 `.mjs` 文件，不改已有文件。写法见 `selftest/run.mjs` 开头的注释，照着已有的反例抄：

```js
export default {
  gate: "哪一道门禁",
  mutation: "这个反例造了什么",
  reason: /检查失败时输出里必须出现的内容/,
  run(ctx) {
    const dir = ctx.gitRepo({ "路径": "内容" }); // 或 ctx.tempDir()、仓库里的夹具
    return ctx.node("infra/ci/某个检查.mjs", [], { cwd: dir });
  },
};
```

- 判定是“检查的退出码非 0，且输出对得上 `reason`”。`reason` 写具体（规则名、报错里的关键句），不要写成任何失败都对得上的字。
- 形似密钥、真实配置、旧名的字符串在运行时拼出来，不作为字面量入库。
- 本地跑单个反例：`node infra/ci/selftest/run.mjs --only <文件名里的一段>`。
- 有几例要用到外部条件：名字以 `secret-scan-` 开头的要本机 Docker 在运行，`audit-vulnerable-dep` 要能连 `registry.npmjs.org`。条件不具备时这几例会红，不会被悄悄跳过。
- `db-catalog-diff-dropped-check`（W0-05）要本地那套 PostgreSQL 在运行（`pnpm infra:up`），并给出 `DATABASE_URL` 或 `PG*` 环境变量（`CLAUDE.md` 第 9 节）。它自己建两个 `lyx_selftest_` 开头的库，用完删掉；连不上时这一例会红。
- `db-verify-grants-extra-delete`、`db-verify-grants-floor-opened-ledger`（W0-06a）同样要本地那套 PostgreSQL 与连接参数。后一例把核对脚本、它引的两份与下限清单拷到仓库外的临时目录，换上一份改过的期望数据，在副本里跑。它自己建一个 `lyx_selftest_` 开头的库，把全部迁移跑一遍，用完删掉；迁移会在实例上建 `lyx_app`、`lyx_readonly` 两个角色（不可登录，已有就不建）。
- `contract-check-stale-generated` 在仓库外的副本里跑真的 `pnpm contract:check`：要 pnpm 在 PATH 上、本仓库的依赖已安装（副本的依赖用符号链接指回 `packages/contract/node_modules`）。它改的是 `DictRef`：提交的生成物里只有 `DictRef`、`ErrorBody`、`SentryEnvelope` 三个组件，改别的结构生成物不变。
- `registry-check-missing-subscriber`、`enums-check-extra-value`（W0-09a）同样在仓库外的副本里跑真的根脚本（`pnpm registry:check`、`pnpm enums:check`），条件同上一条。后一例另要本地那套 PostgreSQL 在运行、`lyx_migrate_check` 已跑过迁移（[packages/db/README.md](../../packages/db/README.md) 第 3 节），并给出 `DATABASE_URL` 或 `PG*` 环境变量；它只读那个库，不建库。连不上时这一例会红。
- `machines-check-missing-row`（W0-12）同样在仓库外的副本里跑真的根脚本（`pnpm machines:check`），条件同 `contract-check-stale-generated`；不连库。删哪一行迁移是现挑的（第一份迁移表里第一条单占一行、`ref` 只出现一次的），迁移表随各域的包改动时不用改这个反例。
- `api-registries-check-wrong-error-code`、`api-registries-check-missing-permission`（W0-09b）在仓库外的副本里跑真的根脚本（`pnpm api-registries:check`），条件同 `contract-check-stale-generated`；不连库。副本里要带对账读的那些文档：清单取自对账脚本导出的 `SOURCE_PATHS` 与 `FRAG_DIR`，脚本以后多读一份文档不用改反例。改哪个码、删哪个权限点也不写死，各取所在文件里登记的第一个。后一例引前一例导出的两个函数（造副本、取 CI 里那一步的命令）。
- `type-hoist-paths-overridden` 在仓库外摆一棵照 pnpm 装出来的小树（`selftest/lib/type-hoist-tree.mjs`，手工摆的目录与链接，不真的安装），再跑 `check-type-hoist.mjs`：要本仓库的依赖已安装（检查脚本用根上的 `typescript`）。
- `docs-check-wrong-permission`、`docs-check-golden-missing`（W0-10）在仓库外的副本里跑真的根脚本（`pnpm contract:docs-check`），条件同 `contract-check-stale-generated`；不连库。副本用 W0-09b 那一例的 `contractCopy`，另带对账读的文档（清单取自对账脚本导出的 `SOURCE_PATHS`）。改哪条路由、删黄金文件的哪一条都不写死。前一例另导出 `ciCommand`（取 `ci.yml` 里以某条命令开头的那一步，不论它在哪个任务）与 `docsCheckCopy`，本包其余几例引它。
- `landed-above-baseline`、`plan-routes-stale-table`（W0-10）不连库：各把一份输入（路由清单加一条、计划文档改一个数）另存到仓库外，用脚本的参数换路径，判定用的其余输入是仓库里真的那几份。待落地数、基线、表里的数都是现读的，不写死。
- `natural-constraints-wrong-name`、`api-check-unverified`、`api-check-stale-registry`（W0-10）要本地那套 PostgreSQL 与连接参数，第一、三例另要 `lyx_migrate_check` 已跑过迁移；都只读，不建库。后两例要 `python3` 与 `psql` 在 PATH 上；第三例在仓库外建一个临时 git 仓库，拷进校验工具与它读的 `docs/api`、`docs/data-model`，改路线图里一条摘要后跑副本里的包装脚本。

## 5. 门禁改动分类

脚本与清单以 main 上的版本为准：CI 从 main 检出它们来判 PR 的差异，PR 改它们不影响对自己的判定。本地试跑：

```sh
node infra/ci/classify-gate-changes.mjs --base origin/main            # 看本分支会被怎么判
node infra/ci/classify-gate-changes.mjs --base origin/main --labels gate-change
```

`gate-files.json` 列出哪些路径算门禁文件、各按哪种口径判：

| kind | 只增（`gate-touch`） | 放松（须单独的 `gate-change` PR） |
| --- | --- | --- |
| `append` | 新增文件；在已有文件里加行 | 删改已有行；加的行像是忽略、豁免、白名单（按关键字判，如 `ignore`、`exclude`、`allow`、`skip`、`eslint-disable`），或像是关掉、降级检查（规则级别 `"off"`、`"warn"`、数字 0 与 1，`process.exit`、`exit 0`、`doNotFollow`、`passWithNoTests`） |
| `new-file` | 新增文件 | 改已有的文件，加一行也算（检查脚本、门禁自测的框架与反例：加一行就能让它空转，逐行判不出） |
| `workflow` | 新增工作流文件；新增整个步骤或任务；`needs` 里加一行 | 删改已有行；往已有的步骤或任务里加行；新增的一段里夹带步骤或任务之外的行（比如跟在新步骤后面的任务级 `if:`）；`continue-on-error`、`paths-ignore` 之类 |
| `frozen` | 新建，且它的条目是同一个 PR 的差异里新登记的（门禁与放行文件同一个 PR 建立）：分支头的清单里有，共同祖先与目标分支头（`--base`）的清单里都没有 | 其余任何改动；条目已登记后的新建（放行文件、安装设置、格式规则、会遮蔽已登记配置的文件）；目标分支上已经登记、落后的分支把清单拷进来再新建的 |
| `tsconfig` | 新增文件；新增键、往数组里加项；把严格性开关由松改严。按解析后的键值判（允许注释与行尾逗号），只改排版不算改动 | 删、改已有的键值；把严格性开关关掉（新增 `"noImplicitAny": false`、`skipLibCheck` 由 `false` 改 `true` 之类）；新增 `exclude`、`include`、`files`、`extends`，往 `exclude` 里加项；新增的键或项命中 `append` 的关键字；解析不了 |
| `manifest` | 新增依赖，写精确版本（工作区内部包写 `workspace:`）；已有的 `typecheck`、`test`、`lint` 脚本由占位（`echo`）换成真实命令，或去掉 `--passWithNoTests` | 新增的依赖不是精确版本（`^`、`~`、`*`、`latest`、区间、别名、`catalog:`）；依赖版本有变、删除依赖（升级要单独成 PR）；已有的 `typecheck`、`test`、`lint` 脚本被删、改成空转（`true`、`echo`、后面接 <code>&#124;&#124; true</code>）或换了别的写法；动了 `prettier`、`lint-staged`、`commitlint`、`eslintConfig` 这几个键。`build` 与其余脚本、其余的键不管 |
| `root-manifest` | 新增依赖（同上）；新增根脚本 | 依赖同上；改、删已有的根脚本；改 `engines`、`packageManager`、`pnpm`、`resolutions`、`overrides`（加也算）；已知集合以外的顶层键有变，新增也算（已知集合：依赖、脚本、上面五个字段，以及 `name`、`version`、`private`、`description`、`type`、`license` 等说明性的键） |
| `lockfile` | `packages` 段新增条目（`importers`、`snapshots` 两段跟着新增的不单列） | `packages` 段的条目被移除或替换，已有条目的内容有变（来源、校验值）；头部设置有变；`importers` 段里已有依赖的 specifier、解析版本有变或被删；`snapshots` 段里已有条目的依赖版本有变或被删。版本后面括号里的 peer 解析不比（加一个依赖就会让它变）。`snapshots` 的条目按完整的键（带 peer 解析）逐个比；键本身变了的，退回与同名的几份并在一起比；新出现的同名条目（多一份 peer 解析）里，依赖版本与基线上同名条目不一致也算放松，这个包自己声明的 peer 依赖除外 |
| `layers` | 新增模块登记 | 改已登记模块的层；改同层策略或白名单；改非模块目录名单 |
| `registry` | `gate-files.json` 新增条目 | 改、删已有条目 |
| `generated` | 入库的生成物：内容有变（重新生成）、新增文件。不逐行判；清单里逐个文件列出加了几行、删了几行，并写明由哪道检查把关它与源码一致 | 删除已有的生成物；条目没写 `check`（判不出）；内容没变而文件属性有变、文件类型有变（换成符号链接之类，判不出） |

- 删除任何门禁文件都算放松。判不出的按放松算。
- 一个文件命中几条就按几条各判一遍。`except` 里的路径不按那一条判，但仍算门禁路径：本目录下的 `.md` 没有别的条目，不逐行判；检查脚本与 `selftest/` 由各自的 `new-file` 条目判。
- 有放松项而 PR 没有 `gate-change` 标签：`gate-classify` 失败。带 `gate-change` 的 PR 改了门禁文件以外的路径：也失败。
- 标签是在任务运行时从 PR 上读的。开 PR 之后才补打 `gate-change` 的，重跑 `gate-classify` 任务即可。
- `gate-touch`、`gate-change` 两个标签由业主建。仓库里没有 `gate-touch` 时任务报错，不自己建。
- 已知的限度：PR 上跑的是 PR 自己那份工作流文件。分类脚本与清单取自 main，PR 改不了它们对自己的判定；但一个 PR 若把 `gate-classify` 任务连同 `required` 里的那一行一起删掉，就没有任务来判它了。所以改 `.github/workflows/` 的 PR，业主要直接看工作流的差异，不只看顶部的清单。
- 遮蔽：ESLint 从被检文件所在目录向上找配置；Prettier、commitlint、lint-staged 先读 `package.json` 里的同名键，再按一串文件名找。新增一个文件或一个键，就能让已登记的那份配置不再生效，而已登记的文件一行没动。所以 `eslint.config.*`、`.prettierrc*`、`prettier.config.*`、`.commitlintrc*`、`commitlint.config.*`、`.lintstagedrc*`、`lint-staged.config.*` 在任何目录下都按 `frozen` 登记（根上已登记为 `append` 的那三份除外），新增即算放松；`package.json` 里的工具配置键见上表。
- 已知的限度：`append` 类文件（lint 装配与规则片段、依赖方向配置、测试配置、提交钩子、用例与夹具）里加行，只靠关键字拦“关掉、降级”的写法，拦不全。清单里写“新增 N 行”的，业主要看差异。新步骤里的命令写了什么（比如 `|| true`）也不判，同样要看差异。
- 已知的限度：`tsconfig` 的严格性开关是照 TypeScript 5.9 列的一张表（脚本里的 `TS_STRICT_WHEN_TRUE`、`TS_STRICT_WHEN_FALSE`）。表外的新增键只列出、不判松紧，业主要看；升级 TypeScript 时这张表要跟着看一遍。
- 已知的限度：遮蔽只登记了上面几个文件名与 `package.json` 的几个键。没盖到的有：`apps/*`、`packages/*` 之外的目录里新增的 `package.json`（里面同样可以写 `prettier` 键）、`package.yaml`、`.editorconfig`（Prettier 会读，只影响缩进一类的格式）。
- 已知的限度：锁文件只判“已有的有没有变”。`packages` 段新增的条目只列名字，不看来源（写成 `tarball:` 网址的也只算“新增 1 个版本”）；往已有的 `snapshots` 条目里加一个依赖、新出现的同名条目里多一个依赖，都不列。清单里写“锁文件新增 N 个版本”的，业主要看锁文件的差异。
- 已知的限度：gitleaks 的默认规则自带一份按路径的放行（`useDefault = true` 带进来的，不是本仓库写的）。实测私钥放在 `deploy/key.svg`、`deploy/.gitleaks.toml`、`deploy/pnpm-lock.yaml` 里都不命中（放在 `deploy/key.txt` 里命中）。
- 已知的限度（第二次独立检验试出、本包没有再堵的写法；看到相关改动时业主要看差异）：
  - 锁文件里新出现的同名条目换一种写法（行内写法、换缩进、把依赖挪到 `optionalDependencies`、干脆不写这个依赖），分类读不到它的依赖，判成“没有门禁改动”，而冻结安装通过、装上的版本变了。
  - 锁文件的头部只查 `importers:` 之前的部分，同样的行写到文件末尾不查；`.pnpmfile.cjs` 还没登记成门禁文件。两者合起来，一个 PR 能装上安装钩子而不被判。
  - `required` 汇总脚本 `ci-required.mjs` 跑的是 PR 自己检出里的那一份。PR 改它就能让 `required` 变绿；这种改动会被分类判成放松、`gate-classify` 会红，但平台只看 `required`。所以凡是动 `infra/ci/` 下已有脚本的 PR，业主直接看差异，并同时看 `gate-classify` 的结论。
  - 工作流的用例按换行符分行。注释里夹 U+2028、U+0085 这类字符时，有的 YAML 解析器会把它当换行，可能藏下一个任务；GitHub 一侧怎么解析没有核实。用例也只读小写的 `.yml`、`.yaml`，检查名比较区分大小写；GitHub 认不认大写扩展名、检查名比不比大小写同样没有核实。
  - `.gitattributes` 把文件交给 LFS 的过滤器时，入库的是指针，密钥扫描看不到本体。本仓库不用 LFS。
- 被新提交顶掉的运行：整次运行的结论是“已取消”，但其中 `required` 任务自己记成失败（它带 `if: always()`，前面的任务被取消时照样跑并判不通过）。被顶掉的是旧提交，PR 上看的是最新提交的结果；运行历史里会留一条红的 `required`，属预期。
- 还没登记的：工作区包自己的 `tsconfig.json` 与 `vitest.config.ts`。在里面关 `strict`、收窄 `include` 现在判为“没有门禁改动”。`vitest.config.ts` 按 `append` 登记会把正常的改写（一行拆成多行、往 `include` 里加一项）也判成放松；`tsconfig.json` 现在可以按 `tsconfig` 登记，没有这个问题。登记不登记、按什么口径，待业主定（`docs/plan/status/W0-03.md` 偏差 6）。

登记新的门禁文件：往 `gate-files.json` 的 `files` 末尾加一条（`pattern`、`kind`、`note`）。`pattern` 里 `**` 跨目录、`*` 不跨目录。白名单、基线、黄金文件这类“一动就该让业主看”的用 `frozen`；规则与配置用 `append`；tsconfig 用 `tsconfig`；入库的生成物目录用 `generated`，另写 `check`，前提见第 5.1 节。新依赖一律写精确版本，写成范围会被判成放松。`infra/ci/` 下的检查脚本（`.mjs`）与 `selftest/` 已经被现有条目按 `new-file` 盖住，不用再登记；放在别处的检查脚本按 `new-file` 登记。

### 5.1 生成物（`generated`）

来历：计划 第 5.3 节把“重新生成的生成物”列在只增类，分类脚本第一版没有这一种口径。契约生成物当时登记成“算门禁路径、不逐行判”（条目的 `except` 盖住整个匹配式：重新生成不进清单，删掉一份也不报）；设计生成物按 `append` 登记（改一个已有变量的取值就判成放松，而来源 `design/tokens.json` 不是门禁文件，带 `gate-change` 的 PR 也放不进去）。业主 2026-10-05 同意加这一种口径（原话：“生成物的门禁口径、状态汇总不入库：两个减少摩擦的门禁改动。同意。”），两处登记统一到它上面。

| 目录 | `check` | 谁写它 |
| --- | --- | --- |
| `packages/contract/generated/**` | `pnpm contract:check` | `pnpm contract:generate` |
| `packages/shared/src/design/generated/**` | `pnpm design:check` | `pnpm design:generate` |

怎么判：名下的文件内容有变、新增文件，都算只增，逐个文件列进 PR 顶部的清单（如“重新生成的生成物，内容有变：加 3 行、删 1 行（与源码一致由 `pnpm design:check` 把关）”），CI 打 `gate-touch`。删除已有的生成物算放松。改这类条目（换检查命令、拿掉 `check`、加 `except`）与改别的条目一样，是放松。

前提：这个口径不看生成物里写了什么，它与源码一致不一致全靠条目的 `check` 写的那道检查。所以只有“CI 的 `verify` 里确实有一步在跑、重新生成后比对”的目录才配用它。`test/gate-generated.test.ts` 对清单里每个 `generated` 条目逐条核对，有一条不满足 `pnpm test` 就红：

- 写了 `check`，且它逐字是 `ci.yml` 的 `verify` 里单独的一步（一行 `run:`），那一步不带条件（`if`、`continue-on-error` 写在步骤开头的“`- if:`”也算）；
- `check` 是“`pnpm <根脚本>`”，根脚本的写法是“`pnpm <重新生成的根脚本> && git diff --exit-code -- <目录>`”（后面可以再用 `&&` 接别的步骤，不许出现 `||`、`;`、单个的 `&` 与换行）；
- 条目的匹配式就是“`<目录>/**`”，与根脚本比对的是同一个目录。

没有这样一道检查的目录不要登记成 `generated`。条目没写 `check` 的，分类把它名下的改动一律按放松算（门禁自测有反例）。

限度：

- 生成物与源码是否一致，完全靠那道检查，分类不重复判。检查那一步被拿掉、根脚本被改，由 `workflow`、`root-manifest` 两种口径判成放松，上面的用例也会红；除此之外，分类不知道那道检查还管不管用。
- 改生成脚本本身不归这个口径管。`packages/contract/scripts/`、`packages/shared/scripts/`、来源 `design/tokens.json` 与契约源码都不是门禁文件；工作区包 `package.json` 里的 `generate`、`design:generate` 脚本改了也不判（`manifest` 口径只管 `typecheck`、`test`、`lint`）。生成脚本改了输出再重新生成，检查是绿的，分类判只增。把包里的 `generate` 脚本改成空转会被用例拦下（契约自测与 `test/design-generated.test.ts` 不经它、直接调生成脚本来比对），改生成脚本的输出则没有东西拦。清单里出现“重新生成的生成物”时，业主要连同生成脚本与来源的差异一起看。
- `git diff --exit-code` 看不到未跟踪的文件：新增一种生成物却没入库，要靠别的兜底。契约是契约自测里问 git 索引的那一条（所以 `pnpm test` 与 `contract:check` 缺一不可，第 2 节），设计是 `design:check` 的第三步 `check-untracked.mjs`。新登记一个生成物目录时要带同样的兜底；用例不核对这一点。
- 删除算放松，而带 `gate-change` 的 PR 只许改门禁文件。重新生成后确实少了一份文件（比如去掉一种文档）的，工作包 PR 与 `gate-change` PR 都装不下“改源码 + 删生成物”。办法是分两个 PR：先用 `gate-change` PR 给条目加一条 `except` 把要删的那个文件划出去，再在工作包 PR 里改源码并删掉它。现有两个目录的文件集合是固定的（契约三份文档各两个文件，设计六个文件），还没遇到过。
- 内容没变而文件属性有变（加可执行位）、文件类型有变（换成符号链接）判不出，按放松算。内容有变的同时又改了属性的，只按内容判成只增，属性的变动不报。
- 生成物目录里多出一份已入库的手写文件，或把包里的生成脚本改成空转之后手改生成物：`pnpm contract:check` 自己是绿的，拦它的是 `pnpm test` 里的契约自测与门禁自测的反例。清单里“与源码一致由 `pnpm contract:check` 把关”这句话，要连同这两道兜底一起理解。
- 用例核对的是“根脚本长什么样”，不核对“重新生成”那个脚本实际做了什么（把它改成空操作，用例不红）；那由上一条说的兜底与生成脚本自己的用例管。

## 6. 状态文件核对与状态汇总

- CI 的“状态文件核对”一步跑 `node infra/ci/status-summary.mjs --check`：只查各包的状态文件合不合规（第一行的写法、字段表的键、状态取值、编号与文件名、依赖指向的包与里程碑），有问题即失败，并指出是哪个文件的哪一项。它不写文件，也不读、不比对任何已有的汇总。
- 状态汇总 `docs/plan/status/SUMMARY.md` 不入库（在 `.gitignore` 里）。要看时跑 `pnpm status:summary` 现生成；它是当前检出里那些状态文件的快照，换了分支、拉了 main 就重新跑。带不带 `--check`，状态文件不合规都一样失败。
- 改了自己的状态文件（包括开 PR 后填 PR 编号），不用再生成、提交汇总。各 PR 只改自己的状态文件，互不冲突。
- 规则见 [docs/plan/status/README.md](../../docs/plan/status/README.md) 第 5 节。

## 7. 类型解析不靠提升（两个 React 大版本）

小程序用 React 18，后台与下载页用 React 19（`CLAUDE.md` 第 5 节），所以 `@types/react`、`@types/react-dom` 在仓库里各装了两份。

`CLAUDE.md` 第 5 节那句“各自安装，不提升”说的是根上的 `node_modules`：那里没有 `react`，照旧成立。本节说的“提升”是另一处，pnpm 缺省在 `node_modules/.pnpm/node_modules` 下放的那一份（私有提升目录），供没把依赖声明全的包兜底用。

### 7.1 出过什么事

main 上 `apps/admin` 的类型检查偶尔红 4 条（`src/app/feedback.ts` 两条、`src/components/QueryTablePage.tsx` 两条），都是“React 19 的 `ReactNode` 不能赋给 `@types/react@18.3.31` 的 `ReactNode`”；删掉 `node_modules` 重装又通过。PR #34 的第三轮复审撞到一次，不放探针时几十遍全新安装只见一次。

根因是三件事叠在一起：

1. antd 一族（`antd`、`@rc-component/*`、`@ant-design/*`）与 `@tanstack/react-query`、`@tanstack/react-router` 的类型里写 `import "react"`，自己只把 `react` 声明成 peer，没有声明 `@types/react`。pnpm 给它们逐包接上的是 `react` 本体，本体不带类型。后台的程序里这样的包有四十多个。
2. tsc 在包自己的 `node_modules` 里找不到类型，就顺着目录往上找，走到 `node_modules/.pnpm/node_modules/@types/react`。这是 pnpm 的私有提升目录：虚拟仓库里的包各提升一份到这里，同名的只放一份。
3. 放哪一份是先到先得。各项目的直接依赖并成一层，按 pnpm 收集项目的先后取第一个（pnpm 10.34.5 的 `getHoistedDependencies`）；这个先后是各项目读本地配置谁先读完谁排前面，不保证。绝大多数时候排在前面的是 `apps/admin`，提升 19.3.0，类型检查通过。`apps/weapp` 排到前面时提升的是 18.3.31：后台自己的源码用它自己装的 19，antd 的类型却解析到 18，两份 `ReactNode` 不相容（19 多一个 `bigint`）。

复现：在检出里放两个只有一行注释的 `apps/admin/.npmrc`、`apps/portal/.npmrc`（只改变读配置的先后），删掉 `node_modules` 全新安装，提升的就是 18.3.31。

### 7.2 修法

`packages/config/tsconfig/` 下两份 React 预设（`web-react19.json`、`taro-react18.json`）加了 `compilerOptions.paths`，把 `react`、`react/*`、`react-dom`、`react-dom/*` 钉到 `${configDir}/node_modules/@types/…`，也就是用预设的工程自己装的那一份。`paths` 对程序里每个文件的导入都生效，第三方包类型里的 `import "react"` 也在内，于是不再往提升目录走；钉到的目录不存在时（`fixtures/` 下的最小工程没装 React）照原来的办法解析。

- 只影响 tsc。Vite、Vitest、dependency-cruiser 不读 tsconfig 的 `paths`；Playwright 加载用例文件时会读，但钉到的位置只有类型声明，它落回原来的解析（实测用例文件里 `import "react"` 拿到的是运行时的 19）。运行时的 `react` 由 pnpm 按各包声明的 peer 逐包接好，本来就不靠提升。
- **工程自己写 `paths` 时要把这四行抄上。** tsconfig 的 `paths` 不合并：应用在自己的 `tsconfig.json` 里写一条别名（比如 `"@/*": ["./src/*"]`），预设里的四行就整体被顶掉，隐患原样回来。忘了的话下面的检查会拦。构建工具也读 tsconfig 的 `paths` 时（比如装了 `vite-tsconfig-paths`，或打开 Vite 的 `resolve.tsconfigPaths`），要确认它没有把运行时的 `react` 解析到类型包上。
- 没有在 pnpm 一侧修，因为那边的办法都属“放松”类门禁改动（第 5 节），试过并用分类脚本判过：

| 办法 | 结果 |
| --- | --- |
| `.npmrc` 里用 `hoist-pattern` 把两个 React 类型包排除出提升 | `.npmrc` 按 `frozen` 登记，判放松。单用它也不行：antd 的类型找不到 `react`，属性退成 `any`，后台的类型检查红 25 条，还是得钉 `paths` |
| `pnpm-workspace.yaml` 里用 `packageExtensions` 给缺声明的包补 `@types/react` 的 peer | 判放松 3 项：`pnpm-workspace.yaml` 按 `frozen` 登记；锁文件头部多一行校验值；被补的包在锁文件里已有的条目跟着变。四十多个包要逐个列，antd 升级后还要跟着改 |

### 7.3 检查

`pnpm check:type-hoist`（`check-type-hoist.mjs`），`verify` 里排在“类型”之后。对工作区里每个写 JSX 的工程（展开后的 tsconfig 里有 `jsx` 选项的），照它的 tsconfig 建一遍程序：只读文件、解析导入，不做类型检查。然后查两条：

1. 经私有提升目录解析到的包，工作区各工程自己装的（`<工程>/node_modules/<包名>`）必须是同一份。不是同一份即失败，这一次提升的恰好是对的那一份也算：要拦的是“取决于提升”，不是“这一次错了”。所以它在每一次安装上的结论都一样，不像类型检查那样时过时不过。main 上没修之前，类型检查是绿的那些安装里它同样报 4 处。
2. 工程自己声明的类型包（`package.json` 里 `@types/` 开头的依赖），程序里只许出现它自己装的那一份。`paths` 钉错了地方、别的工程的那一份混进来时由这一条拦。

各工程装得一致的包、没有哪个工程直接装的包，经提升目录解析不算问题（现在有 `zod`、`punycode`、`@rc-component/trigger` 三个），检查通过时会列出来。

失败了怎么办：输出里写明是哪个工程、哪个包、哪几个工程各装的哪一份。多半是工程自己写了 `paths`、顶掉了预设里的四行，抄上即可；新出现的包（不是 React）在两个工程里装得不一样、又有人不声明就引它，同样在工程的 `paths` 里把它钉到自己装的那一份。要看是谁引进来的：`pnpm --dir <工程> exec tsc --noEmit -p tsconfig.json --explainFiles`。

- 反例 `type-hoist-paths-overridden`：应用继承真的预设、自己写了一条 `paths`，提升的恰好是它自己的那个大版本（这时 tsc 是绿的），检查必须失败。
- 用例 `test/type-hoist.test.ts`：对每一份写 JSX 的预设（从预设目录现取）摆一棵“提升的是另一个大版本”的树，必须通过，预设里的四行被删时这里红；另有 `paths` 被顶掉、钉错地方、只有一个工程直接装（不判）、不写 JSX 的工程、用法错误几组。对本仓库跑检查是 CI 里单独的那一步，用例不重复跑。
- 这个脚本用了根上装的 `typescript`（`pnpm typecheck` 用的同一个），是本目录里唯一引了包的检查脚本：解析的口径只有 tsc 自己说了算，不另写一套。

限度：

- 第 1 条只认“各工程直接装得不一样”的包，这正是出事的那一种：pnpm 把各项目直接声明的依赖排在最前、并成一层，同名的按项目的先后取第一个。没有哪个工程直接声明、只作为传递依赖装了几份的包，经提升目录解析到也不判：它们提升哪一份由 pnpm 按依赖的深度与名字排序定，不随项目的次序变（依赖图里同一个包在不同工程下深浅差很多时理论上仍可能变，没有遇到过）。判了会误伤：锁文件里多出一份不相干的传递依赖（比如第二个版本的 `zod`，Playwright 的类型经提升目录引它），就会让后台的这道检查红，而后台没法把一个自己没装的包钉到“自己那一份”上。
- 只查写 JSX 的工程。两个 React 大版本是仓库里唯一有意装两份的；服务端各包每个都要多建一遍程序，耗时跟着代码量涨，CI 里不查。要全查：`node infra/ci/check-type-hoist.mjs --all`（现在 9 个工程都通过）。
- 根上的 `tsconfig.json`、`infra/tsconfig.json` 与 `fixtures/` 下的最小工程不是工作区包，不查。
- 只看类型解析。一个包运行时不声明就引 `react`（不是类型）时，构建工具同样会落到提升目录里的那一份 `react` 上；现在的依赖里没有这样的包，这道检查也看不到。
- 工作区清单（`pnpm-workspace.yaml` 的 `packages`）只认“目录/\*”与不带通配符的目录两种写法，别的写法报错退出。
## 7. 路由元数据接管带来的检查（W0-10）
契约的路由清单 `packages/contract/generated/routes.json` 是生成物（`pnpm contract:generate` 写，`pnpm contract:check` 把关）：一条路由一行，带所属文档、版本、归属的里程碑，还没有 Zod 结构的路由也在内。本目录的三个脚本只读它，不引契约的代码。
| 检查 | 命令 | 读什么 | 失败是什么意思 |
| --- | --- | --- | --- |
| 路由元数据对账 | `pnpm contract:docs-check` | 契约的路由 ↔ `docs/api/working/routemap.json`；黄金文件 `packages/contract/golden/open-routes.json`；约定 C86 的登记表；资源登记 | 改接口没有同 PR 改路线图；新出现了没评审过的公开、可选、验签路由；`x-step-up: skip` 与登记表不一致；路径里的资源段、参数名与资源登记不符 |
| api-check | `node infra/ci/api-check.mjs` | 路线图、`working/frag/`、分组文档；“表.列”连 `lyx_migrate_check`；三份登记文档 | 三者不自洽；“表.列”一项没核对成；改了路线图、结构化清单或生成脚本却没有重新生成并提交登记文档 |
| 约束名核对 | `node infra/ci/natural-constraints.mjs` | `routes.json` 里 natural 路由的 `idempotentBy`；`lyx_migrate_check` 的唯一约束与唯一索引 | 承担去重的约束改了名或被删 |
| 待落地数只减不增 | `node infra/ci/landed.mjs --check` | `routes.json`；已挂载清单；接口层测试；留桩清单；基线 | 待落地数高于基线 |
| 计划 第 8.2 节的表 | `node infra/ci/plan-routes.mjs --check` | `routes.json`；`docs/08-development-plan.md` | 有 V1.0 接口没有里程碑，或改了归属没有重写那张表 |
- “已落地”的三个条件各从哪读：处理器取 `apps/api/dist/mounted-operations.json`（JSON 字符串数组，探活用登记键；由 `apps/api` 的测试装配导出，W0-22 接上，移交表第 3 行；文件不存在按空集算）；测试取 `apps/api` 下 `*.test.ts` 里以字符串字面量出现的 operationId；留桩取 `docs/plan/stubs/` 里状态为“留桩中”的文件“留桩内容”一行反引号括起的 operationId。
- 基线 `landed-baseline.txt` 一行一个数，脚本读最后一行。往下降是在末尾加一行（只增），不改、不删已有的行；后一行大于前一行脚本直接判不合规。谁来降：各里程碑的合流包必降；别的包落地了接口，`--check` 的输出会提示可以降到多少，降不降随意。里程碑退出条件“`milestone` 为本里程碑的 operationId 未落地数 = 0”用 `--require M0,M1` 这样的写法核对。
- 黄金文件按 `frozen` 登记：与清单不一致时，是该改路由还是该改黄金文件，由评审定；要改黄金文件走单独的 `gate-change` PR，用 `pnpm --filter @liyoxi/contract exec tsx scripts/docs-check.ts --write-golden` 重写。
- 改一条接口的里程碑归属：改 `packages/contract/src/routes/milestones.ts` 里那一行，跑 `pnpm contract:generate` 与 `node infra/ci/plan-routes.mjs --write`，并在 `docs/plan/changes/` 记一条（计划 第 5.7 节）。
- 登记文档与契约的关系：三份登记文档仍由 `tools/api-check` 的两个脚本从路线图与结构化清单生成，没有改成由契约反向生成（W0-10 任务书不许改那两个脚本的逻辑，而文档里“用到的接口”“来源”几栏契约里也没有）。漂移靠三道检查合围：契约 ↔ 路线图（`contract:docs-check`）、契约 ↔ 登记文档（`api-registries:check`）、路线图与清单 → 登记文档重新生成无差异（`api-check.mjs`）。
- 这几个脚本里不写条数：数取自路由清单、路线图与计划文档自己。条数钉在契约自测里（`packages/contract/src/routes/routes.test.ts`、`src/contract.test.ts`），各域补结构、加接口时改那两处。
