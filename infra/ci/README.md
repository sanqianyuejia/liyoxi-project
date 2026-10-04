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
| `secret-scan.mjs` | 密钥扫描：gitleaks 官方镜像的固定标签，扫 HEAD 能到的全部提交（别的分支上的提交由它自己的 PR 扫）。放行项只在仓库根的 `.gitleaks.toml`，逐条写原因 | CI；本机要有 Docker |
| `classify-gate-changes.mjs`、`gate-files.json` | 门禁改动分类：只增（`gate-touch`）与放松（`gate-change`） | CI 的 `gate-classify` 任务 |
| `ci-required.mjs` | 汇总任务 `required`：判定必过任务的结论，统计耗时，出 `ci-duration.json` | CI 的 `required` 任务 |
| `status-summary.mjs` | 生成 `docs/plan/status/SUMMARY.md` | `pnpm status:summary`；CI 用 `--check` 核对无差异 |
| `selftest/run.mjs`、`selftest/cases/` | 门禁自测：一个反例一个文件 | `pnpm gates:selftest`；CI |
| `fixtures/` | tsconfig 预设的最小工程；依赖方向与分层的反例夹具 | `pnpm typecheck`；用例与门禁自测 |

工作流在 `.github/workflows/`：`ci.yml`（每个 PR 与推到 main）、`nightly.yml`（每晚，Node 26，失败只告警）。

## 2. CI 的结构

| 任务 | 内容 | 备注 |
| --- | --- | --- |
| `verify` | 冻结安装 → lint、格式、换名、类型 → 依赖方向与五层 → 测试 → 构建 → `.env.example` 核对 → 密钥扫描、依赖审计、新增依赖发布时长 → `gates:selftest` → 状态汇总无差异 | 挂 PostgreSQL 17 与 Redis 7.4 两个服务容器，端口与账号同 `infra/compose/local.yml` |
| `gate-classify` | 门禁改动分类；把清单写进 PR 描述顶部两个标记之间；有只增项就打 `gate-touch` | 只在 PR 上跑；只有它能写 PR |
| `required` | 依赖上面全部任务；任何一个没成功即失败；出时长统计 | 业主在 main 的保护规则里只把它设为必过 |

- PR 上按分支分组：同一个分支的新提交会取消在途的运行。推到 main 时一个提交一组：不取消，也不会因为排队被后一次合并顶掉，每次合并都跑完。
- 执行机只写在 `ci.yml` 的一处（`verify` 的 `runs-on` 带锚点 `&runner`），`nightly.yml` 另有一处。改成自托管执行机时改这两处；自托管机器上要有 Docker 与 `gh`。
- 第三方 Action 固定到提交 SHA，行尾注明版本；升级单独成 PR。
- CI 里不放密钥。工作流里的连接串是本地开发的固定值，只对当次运行的服务容器有效。
- 时长：`required` 的运行摘要与产物 `ci-duration.json` 列出各必过任务的耗时与合计。预算 15 分钟，超了只标出、不阻断（M0 退出时由 W0-30 核对）。

## 3. 怎么加一步检查

1. 检查脚本放本目录，新增文件；用例放 `test/`。
2. 在 `ci.yml` 的 `verify` 里新增一个完整的步骤（`- name:` 开头的一整段）。要单独成任务时，新增一个完整的任务，并在 `required` 的 `needs` 里加一行。`needs` 一行一个，不要写成方括号的行内列表。
3. 同一个 PR 里加一个反例（第 4 节）。CLAUDE.md 第 8 节：每加一道门禁，同包加一个反例进 `gates:selftest`。
4. 新的门禁文件不在 `gate-files.json` 已有条目的范围内时，登记进去（第 5 节）。
5. 根脚本要加命令时只新增，不改已有的；命令补进 `CLAUDE.md` 第 9 节。

这些都是“只增”类改动：CI 打 `gate-touch`，差异列在 PR 描述顶部。不要在已有的步骤里加行、改行，也不要改已有的检查脚本与反例（加一行也算）：那会被判成放松，要改就走单独的 `gate-change` PR。

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
- 三个反例要用到外部条件：`secret-scan-fake-key`、`secret-scan-history` 要本机 Docker 在运行，`audit-vulnerable-dep` 要能连 `registry.npmjs.org`。条件不具备时这几例会红，不会被悄悄跳过。

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
| `frozen` | 新建，且它的条目在 main 的清单里还没登记（门禁与放行文件同一个 PR 建立） | 其余任何改动；条目已登记后的新建（放行文件、安装设置、格式规则） |
| `manifest` | 新增依赖；已有的 `typecheck`、`test`、`lint` 脚本由占位（`echo`）换成真实命令，或去掉 `--passWithNoTests` | 依赖版本有变、删除依赖（升级要单独成 PR）；已有的 `typecheck`、`test`、`lint` 脚本被删、改成空转（`true`、`echo`、后面接 <code>&#124;&#124; true</code>）或换了别的写法。`build` 与其余脚本不管 |
| `root-manifest` | 新增依赖；新增根脚本 | 依赖同上；改、删已有的根脚本；改 `engines`、`packageManager`、`pnpm`、`resolutions`、`overrides`（加也算） |
| `lockfile` | `packages` 段新增条目 | 条目被移除或替换；已有条目的内容有变（来源、校验值）；头部设置有变 |
| `layers` | 新增模块登记 | 改已登记模块的层；改同层策略或白名单；改非模块目录名单 |
| `registry` | `gate-files.json` 新增条目 | 改、删已有条目 |

- 删除任何门禁文件都算放松。判不出的按放松算。
- 一个文件命中几条就按几条各判一遍。`except` 里的路径（本目录下的 `.md`）不逐行判，但仍算门禁路径。
- 有放松项而 PR 没有 `gate-change` 标签：`gate-classify` 失败。带 `gate-change` 的 PR 改了门禁文件以外的路径：也失败。
- 标签是在任务运行时从 PR 上读的。开 PR 之后才补打 `gate-change` 的，重跑 `gate-classify` 任务即可。
- `gate-touch`、`gate-change` 两个标签由业主建。仓库里没有 `gate-touch` 时任务报错，不自己建。
- 已知的限度：PR 上跑的是 PR 自己那份工作流文件。分类脚本与清单取自 main，PR 改不了它们对自己的判定；但一个 PR 若把 `gate-classify` 任务连同 `required` 里的那一行一起删掉，就没有任务来判它了。所以改 `.github/workflows/` 的 PR，业主要直接看工作流的差异，不只看顶部的清单。
- 已知的限度：`append` 类文件（lint 装配与规则片段、tsconfig 预设、依赖方向配置、测试配置、提交钩子、用例与夹具）里加行，只靠关键字拦“关掉、降级”的写法，拦不全。清单里写“新增 N 行”的，业主要看差异。新步骤里的命令写了什么（比如 <code>&#124;&#124; true</code>）也不判，同样要看差异。
- 还没登记的：工作区包自己的 `tsconfig.json` 与 `vitest.config.ts`。在里面关 `strict`、收窄 `include` 现在判为“没有门禁改动”。按 `append` 登记会把正常的改写（一行拆成多行、往 `include` 里加一项）也判成放松；登记不登记、按什么口径，待业主定（`docs/plan/status/W0-03.md` 偏差 6）。

登记新的门禁文件：往 `gate-files.json` 的 `files` 末尾加一条（`pattern`、`kind`、`note`）。`pattern` 里 `**` 跨目录、`*` 不跨目录。白名单、基线、黄金文件这类“一动就该让业主看”的用 `frozen`；规则与配置用 `append`。`infra/ci/` 下的检查脚本（`.mjs`）与 `selftest/` 已经被现有条目按 `new-file` 盖住，不用再登记；放在别处的检查脚本按 `new-file` 登记。

## 6. 状态汇总

`docs/plan/status/SUMMARY.md` 是生成物。改了自己的状态文件（包括开 PR 后填 PR 编号），重新跑 `pnpm status:summary` 并提交；冲突时变基后重新生成，不手工合并。规则见 [docs/plan/status/README.md](../../docs/plan/status/README.md) 第 5 节。
