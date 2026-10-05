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
| `fixtures/` | tsconfig 预设的最小工程；依赖方向与分层的反例夹具 | `pnpm typecheck`；用例与门禁自测 |

工作流在 `.github/workflows/`：`ci.yml`（每个 PR 与推到 main）、`nightly.yml`（每晚，Node 26，失败只告警）。

## 2. CI 的结构

| 任务 | 内容 | 备注 |
| --- | --- | --- |
| `verify` | 冻结安装 → lint、格式、换名、类型 → 依赖方向与五层 → 测试 → `contract:check` → 构建 → `.env.example` 核对 → 密钥扫描、依赖审计、新增依赖发布时长 → `gates:selftest` → 状态文件核对 | 挂 PostgreSQL 17 与 Redis 7.4 两个服务容器，端口与账号同 `infra/compose/local.yml` |
| `gate-classify` | 门禁改动分类；把清单写进 PR 描述顶部两个标记之间；有只增项就打 `gate-touch` | 只在 PR 上跑；只有它能写 PR |
| `required` | 依赖上面全部任务；任何一个没成功即失败；出时长统计 | 业主在 main 的保护规则里只把它设为必过 |

- PR 上按分支分组：同一个分支的新提交会取消在途的运行。推到 main 时一个提交一组：不取消，也不会因为排队被后一次合并顶掉，每次合并都跑完。
- 执行机只写在 `ci.yml` 的一处（`verify` 的 `runs-on` 带锚点 `&runner`），`nightly.yml` 另有一处。改成自托管执行机时改这两处；自托管机器上要有 Docker 与 `gh`。
- MinIO 不是服务容器（W0-19 加）：`verify` 在“测试”之前有两步，先用 compose 文件只起 `minio` 一个服务（镜像、端口、账号只写在 `infra/compose/local.yml` 一处），再带 `LYX_TEST_MINIO=required` 跑本地存储驱动的用例，MinIO 连不上即失败。不带这个变量时（“测试”一步、每晚任务、本机没起依赖）那份用例里要连 MinIO 的几组只跳过。每晚任务不起 MinIO。
- 格式那一步跑的是 `pnpm format:check --ignore-path .prettierignore`：忽略项只认 `.prettierignore`（门禁文件）。Prettier 缺省把 `.gitignore` 也当忽略文件读，往 `.gitignore` 加一行就能让已入库的文件不查格式，而 `.gitignore` 不是门禁文件。本地直接跑 `pnpm format:check` 仍会读 `.gitignore`（本机的 `.vscode/` 之类不用查）；两者只在“已入库又被 `.gitignore` 盖住”的文件上有差别，以 CI 为准。
- `contract:check`（W0-08）排在“测试”之后，两步都在必过里，缺一不可。`contract:check` 先重新生成、再 `git diff --exit-code`：`git diff` 看不到未跟踪的文件，新增一种生成物却忘了 `git add` 时它不会红；这由契约自测里问 git 索引的那一条拦，所以 `pnpm test` 要在 git 检出里跑。契约自测另有一条拿提交的生成物与现生成的逐字节比对，要赶在 `contract:check` 把文件重新写出来之前跑。
- 工作流的写法有约束，`test/workflows.test.ts` 按行读、认不出就失败：顶格的键与任务下面四格缩进的键不带引号；`jobs:` 逐字一行；任务编号写成两格缩进的 `<编号>:`，冒号后面不带注释；每个任务恰好一行 `name: <编号>`，检查名与任务编号相同。必过检查名 `required` 在全部工作流里只有一个。哪个工作流都不给令牌 `checks`、`statuses` 的写权限（有了它能经接口造出任意名字的检查）。
- 第三方 Action 固定到提交 SHA，行尾注明版本；升级单独成 PR。
- CI 里不放密钥。工作流里的连接串是本地开发的固定值，只对当次运行的服务容器有效。
- 时长：`required` 的运行摘要与产物 `ci-duration.json` 列出各必过任务的耗时与合计。预算 15 分钟，超了只标出、不阻断（M0 退出时由 W0-30 核对）。
- 设计地基（W0-26）在 `verify` 里加了三步：换名检查之后的“页面不写色值”（`pnpm lint:colors`）；测试之后的“设计生成物无差异”（`pnpm design:check`）与“上传设计预览页”。预览页是产物 `design-preview`（`packages/shared/dist/design-preview/`，不入库），目录里没有文件时上传那一步失败；业主合并前在运行页面的 Artifacts 里下载来看。
- 首版迁移（W0-05）在 `verify` 里加了七步。“类型”之前一步：生成数据库客户端（`pnpm db:generate`；客户端不入库）。“依赖方向与五层”之后、“起 MinIO”之前六步：`prisma validate`；由底稿建参照库 `lyx_schema_check`（校验工具按自己的锁文件用 npm 装，带 `NPM_CONFIG_IGNORE_SCRIPTS` 不执行安装脚本，再跑 `check.py --keep`）；空库 `lyx_migrate_check` 上跑全部迁移；系统目录比对；再跑一遍迁移与比对；上传比对报告（产物 `db-catalog-diff`，比对没过时也传）。排在“测试”之前，是因为 `pnpm test` 里 `packages/db` 的用例要连迁移库。用法与口径见 [packages/db/README.md](../../packages/db/README.md) 第 6 节。
- 每晚任务（`nightly.yml` 的 `node26`）跟着补了四步，都是新增的整步。“类型”之前一步：生成数据库客户端（`pnpm db:generate`）。“类型”与“测试”之间三步：起 PostgreSQL 与 Redis；把连接参数（`APP_ENV`、`DATABASE_URL`、`REDIS_URL`，取值与 `verify` 的相同）写进 `$GITHUB_ENV`，后面的“测试”读得到；空库 `lyx_migrate_check` 上跑全部迁移。它不挂服务容器：往已有的任务里加 `services`、`env` 算放松类改动（第 5 节），所以库用 compose 文件起，与 `verify` 的“起 MinIO”同一种写法，镜像、端口、账号取 `infra/compose/local.yml`。`verify` 里的 `prisma validate`、由底稿建参照库、系统目录比对它不跑：那是首版迁移的等价性证明，`pnpm test` 用不到参照库 `lyx_schema_check`。执行机上要有 Docker（带 compose）与 `psql`，与 `verify` 相同。往每晚任务加一步时，在 `test/workflows.test.ts`“nightly.yml”一组的命令清单里同一位置加一行（只增）。

## 3. 怎么加一步检查

1. 检查脚本放本目录，新增文件；用例放 `test/`。
2. 在 `ci.yml` 的 `verify` 里新增一个完整的步骤（`- name:` 开头的一整段）。要单独成任务时，新增一个完整的任务，并在 `required` 的 `needs` 里加一行。`needs` 一行一个，不要写成方括号的行内列表。任务照已有的写：两格缩进的 `<编号>:`，下面一行 `name: <编号>`，键不带引号（第 2 节）。
3. 同一个 PR 里加一个反例（第 4 节）。CLAUDE.md 第 8 节：每加一道门禁，同包加一个反例进 `gates:selftest`。
4. 新的门禁文件不在 `gate-files.json` 已有条目的范围内时，登记进去（第 5 节）。
5. 根脚本要加命令时只新增，不改已有的；命令补进 `CLAUDE.md` 第 9 节。

这些都是“只增”类改动：CI 打 `gate-touch`，差异列在 PR 描述顶部。不要在已有的步骤里加行、改行，也不要改已有的检查脚本与反例（加一行也算）：那会被判成放松，要改就走单独的 `gate-change` PR。

`test/workflows.test.ts` 的“verify 的步骤齐全”一条逐条列了 `verify` 里的命令：往 `verify` 加一步时，在那张清单的同一位置加一行，否则 `pnpm test` 会红。只加这一行是“只增”（用例按 `append` 判）。

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
- `contract-check-stale-generated` 在仓库外的副本里跑真的 `pnpm contract:check`：要 pnpm 在 PATH 上、本仓库的依赖已安装（副本的依赖用符号链接指回 `packages/contract/node_modules`）。它改的是 `DictRef`：提交的生成物里只有 `DictRef`、`ErrorBody`、`SentryEnvelope` 三个组件，改别的结构生成物不变。

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
