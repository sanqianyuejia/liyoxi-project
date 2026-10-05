# @liyoxi/db

唯一的数据访问层：Prisma schema、迁移、客户端工厂。依据：[06](../../docs/06-data-model.md) 第 8 节、[开发计划](../../docs/08-development-plan.md) 第 5.7 节、W0-05 任务书。表结构以这里的迁移为准；`docs/data-model/` 下的 `schema.prisma` 与 `constraints/` 是首版迁移的底稿，接管后冻结。

## 1. 这里有什么

| 路径 | 内容 |
| --- | --- |
| `prisma/schema.prisma` | 由底稿迁入，模型一字未改；只改了文件头注释与 `generator` 的输出目录 |
| `prisma/migrations/20261005000000_init/migration.sql` | 首版迁移：166 张表与 00–15 的手写约束。拼出来的，不手改（第 4 节） |
| `prisma/migrations/20261005060000_grants/migration.sql` | 第二个迁移：角色与授权。手写的，不改结构（第 9 节） |
| `prisma.config.ts` | Prisma 的配置。连接串只取环境变量 `DATABASE_URL`，不读 `.env`，没有默认值 |
| `src/index.ts` | `createPrismaClient`：客户端的唯一构造入口（第 5 节） |
| `src/grants.expected.json` | 期望的授权：逐表的权限、例外列、以属主身份执行的函数。权限测试与核对脚本共用一份，手写（第 9 节） |
| `scripts/build-init-migration.mjs` | 拼首版迁移的脚本，可重跑核对 |
| `dist/generated/` | 生成的客户端。不入库（根 `.gitignore` 的 `dist/`），由 `pnpm db:generate` 生成 |

## 2. 命令

根脚本，在仓库根目录跑。连库的三个都要 `DATABASE_URL`（本地的取值见 `CLAUDE.md` 第 9 节）。

| 命令 | 做什么 | 连库 |
| --- | --- | --- |
| `pnpm db:generate` | 生成客户端到 `dist/generated/`。类型检查、测试之前要先有它：`pnpm install` 不会顺带生成 | 否 |
| `pnpm db:validate` | `prisma validate` | 否 |
| `pnpm db:deploy` | `prisma migrate deploy`：对 `DATABASE_URL` 指的库跑全部待执行的迁移。可重复跑，没有待执行的迁移时什么都不做 | 是 |
| `pnpm db:catalog-diff` | 系统目录比对（第 6 节） | 是 |
| `pnpm db:verify-managed` | 托管库验证（第 7 节） | 是 |
| `pnpm db:verify-grants` | 角色与授权的核对（第 7、9 节）。`pnpm db:verify-managed` 成功后会自动接着跑它 | 是 |

本包自己的脚本：`pnpm --filter @liyoxi/db migration:build`（重拼首版迁移；加 `--check` 只核对、不写文件）、`pnpm --filter @liyoxi/db test`。

不用 `prisma migrate dev`、`migrate reset`、`db push`（`CLAUDE.md` 第 6 节规则 21）。

`pnpm db:deploy` 遇到不存在的库，不报“库不存在”（2026-10-05 本机实测，Prisma 7.9.1）：连接串的主机写 `127.0.0.1` 时，Prisma 自己建出这个库再跑迁移，退出码 0；写 `localhost` 时报 P1001“Can't reach database server”，退出码 1。库名写错时两种表现都容易看走眼：跑之前核对库名，预发与生产上尤其如此。

迁移中途失败（2026-10-05 本机实测，PostgreSQL 17.11，Prisma 7.9.1）：授权迁移是整个放在一个事务里执行的，中途出错整体回滚。试过两种：跑到最后一组授权时出错；跑迁移的账号不能建角色、实例上又没有那两个角色。两种都是库里不留一句授权、缺省授权、模式授权，这次新建的角色也不留。`pnpm db:deploy` 报 `P3018` 并给出数据库的报错；`_prisma_migrations` 里留一行未完成的记录。把原因修好之后直接再跑，报 `P3009`（库里有失败的迁移，不再往下跑）。处置：

```sh
# 只把那一行记录标成“已回滚”，不动库里别的东西；之后照常跑迁移
DATABASE_URL=<那个库> pnpm --filter @liyoxi/db exec prisma migrate resolve --rolled-back 20261005060000_grants
DATABASE_URL=<那个库> pnpm db:deploy
```

这是拿授权迁移试出来的。以后的迁移若带显式的事务语句，或带不能放进事务的语句，失败之后是不是整体回滚没有试过：先查库里实际留下了什么，再标记。

## 3. 本地准备

装完依赖后做一次；迁移有新增时重做后两步。Docker 要在运行。

```sh
pnpm infra:up
export DATABASE_URL=postgresql://liyoxi:lyx-local-dev@localhost:5442/liyoxi   # 出处：infra/compose/local.yml
pnpm db:generate
# 建迁移库 lyx_migrate_check 并跑迁移（库已存在就不用建；要重来就先 DROP DATABASE）
PGPASSWORD=lyx-local-dev psql -X -h localhost -p 5442 -U liyoxi -d postgres -c "CREATE DATABASE lyx_migrate_check"
DATABASE_URL=postgresql://liyoxi:lyx-local-dev@localhost:5442/lyx_migrate_check pnpm db:deploy
```

- 那套 PostgreSQL 是几个 worktree 共用的：`lyx_migrate_check` 建一次，所有检出都能用。别的会话可能正连着它，没有必要就不要删。
- `pnpm typecheck` 报找不到 `../dist/generated/client.js`：还没跑 `pnpm db:generate`。
- `pnpm test` 会跑到本包的用例与 `infra/ci/test/db-*.test.ts`，它们要连库，连不上就失败，不跳过：
  - 报“DATABASE_URL 未设置”：照上面导出环境变量。
  - 报“迁移库 lyx_migrate_check 连不上，或还没跑过迁移”：`pnpm infra:up`，再做上面最后两步。
  - 本包的用例连的是迁移库：主机与账号取 `DATABASE_URL`，库名换成 `lyx_migrate_check`，只读不写。
  - `infra/ci` 的用例与 `gates:selftest` 的反例自己建库（`lyx_test_infra_*`、`lyx_selftest_*`），用完删掉，不碰迁移库。
  - 权限测试 `src/grants.test.ts` 自己建库（`lyx_test_db_grants_<进程号>`），跑两遍迁移，用完删掉，不碰迁移库。它要 `DATABASE_URL` 的账号能建库、能切换角色（本地与 CI 的管理账号都可以）。
- 每个会话、每个测试进程一个库的测试支架由 W0-05b 交付；在那之前不要往迁移库里写数据。

## 4. 首版迁移是怎么来的

迁移文件由脚本机械拼出：`prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` 的输出，接上 `docs/data-model/constraints/` 下的 00–15（文件名顺序）。语义一字不改，只加了注释：文件头、每个来源前的分隔行、四类语句前各一行 `-- lyx:allow <理由>`（D7 第 8.3 节第 5 条：`DROP`、`RENAME`、`ALTER … TYPE`、不带默认值的 `SET NOT NULL`）。

```sh
pnpm --filter @liyoxi/db migration:build --check   # 重拼的结果应与入库的文件逐字节相同；并列出带 lyx:allow 的语句
```

- 这条核对在 `pnpm test` 里（`src/migration.test.ts`）。迁移一旦在任何库上跑过就不能再改：Prisma 按文件的校验值认迁移。
- 拼接时出现四类语句而脚本里没有登记理由，脚本报错，不让它漏标。
- 迁移执行时按当天的日期建埋点事件表的分区（兜底、当月、未来 3 个月），分区子表的名字随月份变。
- 首版迁移不建角色、不写授权：那是第二个迁移（第 9 节）。之后的结构变更走新的迁移文件，一个结构变更包一个 PR；草稿怎么出、哪些要人工删改补，见第 9 节末尾指的 ADR。

## 5. 客户端工厂

```ts
import { createPrismaClient } from "@liyoxi/db";

const prisma = createPrismaClient({
  connectionString, // 由装配方从 loadEnv 的 DATABASE_URL 取
  max: 10,
  statementTimeoutMs: 8_000,
  lockTimeoutMs: 3_000,
  idleInTransactionSessionTimeoutMs: 15_000,
});
```

- 五个参数：连接串、连接数上限、三个会话超时（毫秒）。取值照 D7 第 8.3 节“应用侧的数据库会话设置与连接池”那张表，由 W0-22、W0-23 装配时传；本包不读环境变量、不写默认值。超时不给即沿用服务器的设置。
- 一个连接池一个实例。隔离单位是库：连接串不带 `?schema=`，工厂不设 `search_path`。
- 应用层（api、worker、前端）不直接引本包，只在进程装配时由 services 引工厂（`CLAUDE.md` 第 6 节规则 5）。

## 6. 系统目录比对

证明“首版迁移建出来的库”与“由底稿建的参照库”结构相同（任务书 第 7 节第 2、4、5 条）。CI 的 `verify` 里每次都跑，报告是产物 `db-catalog-diff`。

```sh
# 参照库 lyx_schema_check：由底稿建。校验工具有自己的锁文件，先按它装一次
(cd tools/schema-check && npm ci --ignore-scripts)
PGHOST=localhost PGPORT=5442 PGUSER=liyoxi PGPASSWORD=lyx-local-dev python3 tools/schema-check/check.py --keep
# 迁移库 lyx_migrate_check：见第 3 节
pnpm db:catalog-diff
```

- 四段，任何一段不过即退出码 1：两个库都在 PostgreSQL 17 上；两份 `schema.prisma` 去掉文件头注释与 `generator` 块后逐字节相同；系统目录逐项相同；数量等于 06 第 1 节的两组口径。
- 逐项比的是表、列、约束定义、索引定义、触发器、函数体六类，另加一类：序列（连当前值与持久性）、扩展（名字与版本）、视图与物化视图（定义）、外部表、类型（枚举、域、范围、独立的复合类型）、模式、策略、规则、统计对象、事件触发器、注释。`_prisma_migrations` 不计。口径与查询在 [db-lib.mjs](../../infra/ci/db-lib.mjs)。
- 几处容易漏的也在比的范围里（第一轮复审试出来后补上的，各有一条反向用例）：表的 TOAST 选项；列的压缩方式与列选项；外键名下内部触发器的启停（停用之后外键的定义不变，但不再校验）；视图上的触发器、物化视图上的索引、外部表的列、独立复合类型的属性；域的默认值与 CHECK；聚合的定义；序列的持久性。
- 不比的，改了查不出，报告里的“0 差异”不含这些：
  - 属主、授权、默认授权（迁移里不建角色、不写 GRANT，归 W0-06a）；
  - 统计信息；列与索引列的存储方式、统计目标；表里的数据行（序列的当前值除外）；
  - 表空间、表的访问方法、类型化的表（`CREATE TABLE … OF`）所属的类型；库级、角色级的设置（`ALTER DATABASE … SET`）；
  - 排序规则、运算符与运算符类、类型转换、全文检索配置、过程语言、外部数据包装器、外部服务器、外部表的选项、发布与订阅、安全标签、大对象；
  - 基础类型、范围类型的子类型、域的排序规则；视图与物化视图的存储选项、物化视图是否已填充；
  - 扩展带进来的函数、类型、运算符（只比扩展的名字与版本）。
  - 上面点了名要比的才比；没列到的对象种类也按不比看待。这些在首版迁移里都不出现：2026-10-05 在两个库上各查过一遍，上面各种对象用户自建的都是 0 个，没有授权，没有改过存储方式、统计目标的列，表里都没有数据行（查法与结果在 W0-05 的 PR 证据里）。
- 参数：`--ref <库>`、`--target <库>`、`--report <文件>`（默认 `packages/db/dist/catalog-diff/report.md`）。两个库只读不写，库名只认 `lyx_` 开头。
- 校验工具的 Prisma 用 npm 按它自己的锁文件装，不执行安装脚本：本地写 `--ignore-scripts`，CI 里写成环境变量 `NPM_CONFIG_IGNORE_SCRIPTS`，效果相同。不跑安装脚本时迁移引擎的二进制没有随安装下载，Prisma 命令行第一次用到时自己下载，与 pnpm 给本包装的是同一个文件。
- 两个库要在同一个月里建：分区子表的名字随建库时的月份变（按库的时钟、北京时间）。跨月建的两个库会差在分区上，多报差异，不会漏报；CI 里两个库前后只隔几秒。本地那个长期留着的 `lyx_migrate_check` 过了月初要删掉重建（第 3 节），否则拿它与新建的参照库比，`pnpm db:catalog-diff` 会红。
- 差异多于 40 处时报告只列前 40 处；各类各有几处看第 2 段表里的“差异”一列。
- 首版之后结构一变，这项比对就不再成立；去留见 W0-06b 任务书 第 11 节。

## 7. 托管库验证

业主在托管 PostgreSQL 到位的当天跑（计划 第 8.6 节 V5“扩展”一项）：在自己的终端里把 `DATABASE_URL` 指到托管实例上一个 `lyx_` 开头的空库，运行 `pnpm db:verify-managed`，把输出回传。

- 报告：两个扩展（`btree_gist`、`pg_trgm`）在实例上可装、迁移跑通后已建出；迁移全部完成；数量两组口径。
- 不打印连接串：输出里只有库名与服务器版本。迁移工具的输出只在失败时给出，并先抹掉主机、账号、口令。
- 只动 `DATABASE_URL` 指的那一个库：库名不是 `lyx_` 开头、或库里已经有表，一律拒绝。
- 上面几项通过之后，报告末尾接着出“角色与授权”一段（W0-06a）：两个角色在不在、是不是不可登录；两个角色进不进得了模式 `public`、有没有模式与库的 `CREATE`；`lyx_app` 在每张逻辑表上的表级权限逐张与期望相同（期望在 `src/grants.expected.json`，第 9 节），列级授权只有期望里的例外列，只增表恰好是 `INSERT`、`SELECT`，`file_object` 不给删除；序列；以属主身份执行的函数由谁执行；`lyx_readonly` 全库只读与缺省授权；有没有带转授权（`WITH GRANT OPTION`）的授权；只增表与不给改、删的表上别的角色有没有查询以外的权限（别的角色在其余表上的授权只列出来，请人过目）；往埋点事件表插一行、读回来、回滚（分区表可写可查，库里不留数据）；另报当前账号是不是超级用户、能不能建角色、是不是表的属主、能不能切换到 `lyx_app`。这一段只读系统目录，不切换角色。
- “角色与授权”一段由另一个脚本 `infra/ci/db-verify-grants.mjs` 出：根脚本 `postdb:verify-managed` 是 pnpm 的后置钩子，`pnpm db:verify-managed` 成功后自动执行，前面不通过就不跑。对一个已经跑完迁移的 `lyx_` 开头的库单独核对：`DATABASE_URL=<那个库> pnpm db:verify-grants`（预发、生产上那个库以后也用它核对，不限于空库）。
- 这一段要经 pnpm 跑才有，靠的是 pnpm 缺省会执行前后置脚本。两种跑法没有这一段，前面那段照样报“结论：通过”，也没有任何提示（2026-10-05 本机实测，pnpm 10.34.5）：直接 `node infra/ci/db-verify-managed.mjs`；关掉了前后置脚本（命令行带 `--config.enable-pre-post-scripts=false`，本仓库的配置里没有关）。回传的输出里要看得到“## 角色与授权”与它后面的“结论：通过”才算数。`infra/ci/test/db-verify-managed-hook.test.ts` 经 pnpm 把整条命令跑一遍，把这一段钉住。
- 本地演练：

```sh
PGPASSWORD=lyx-local-dev psql -X -h localhost -p 5442 -U liyoxi -d postgres -c "CREATE DATABASE lyx_verify_managed"
DATABASE_URL=postgresql://liyoxi:lyx-local-dev@localhost:5442/lyx_verify_managed pnpm db:verify-managed
PGPASSWORD=lyx-local-dev psql -X -h localhost -p 5442 -U liyoxi -d postgres -c "DROP DATABASE lyx_verify_managed"
```

## 8. 生成的客户端为什么放在 `dist/generated/`

任务书的默认是 `src/generated/`。实测 Prisma 生成的客户端自身有循环引用，放在 `src/` 下 `pnpm depcheck` 的“无循环依赖”一条会报 168 处；依赖方向检查只把 `dist/`、`coverage/` 当构建产物排除。放进 `dist/generated/` 后，lint、格式、依赖方向、git 的已有忽略范围都盖得住，不用新增任何忽略项（`docs/plan/status/W0-05.md` 偏差）。

## 9. 角色与授权

第二个迁移 `20261005060000_grants` 建两个角色并写授权（W0-06a）。只增表从此有两道：应用角色没有改、删的权限；触发器照旧拦（表的属主也改不了）。

| 角色 | 谁用 | 权限 |
| --- | --- | --- |
| `lyx_app` | api 与 worker | 逐表授权，下表 |
| `lyx_readonly` | 逻辑备份与排障 | 全部表与序列只读，含分区子表与 `_prisma_migrations`；跑迁移的账号以后建的表与序列自动带上 |
| 跑迁移的账号 | 迁移（预发与生产是 `lyx_migrator`） | 表的属主。不由迁移创建 |

| `lyx_app` 的权限 | 哪些表 |
| --- | --- |
| `SELECT, INSERT` | 16 张只增表：`outbox_event`、`status_transition`、`assignment_history`、`audit_log`、`auth_event`、`drama_copyright_revision`、`price_tier_revision`、`subscription_event`、`ledger_operation`、`point_ledger_entry`、`finance_config_revision`、`delivery_download_log`、`manual_reminder_log`、`agreement_consent`、`param_value`、`analytics_event`；另有 `service_ticket_entry` |
| 列级 `UPDATE`（只增表上触发器放行“写一次”的列） | `outbox_event.published_at`；`assignment_history` 的 `contact_due_at`、`sla_snapshot`、`contacted_at`、`contacted_by_staff_id`、`contact_voided_at`、`updated_at`；`finance_config_revision.effective_at`；`delivery_download_log` 的 `client_ack`、`client_ack_at`；`param_value.cancelled_at` |
| `SELECT, INSERT, UPDATE`（不给删除） | `file_object`；08 分组的 11 张（`billing_order`、`payment_txn`、`transfer_proof`、`refund_request`、`refund_txn`、`payment_exception`、`wx_bill_file`、`wx_bill_line`、`recon_day`、`invoice_request`、`invoice_doc`）；`service_ticket` |
| `SELECT, INSERT, DELETE` | `service_ticket_ref` |
| `SELECT, INSERT, UPDATE, DELETE` | 其余 135 张 |
| 序列 `USAGE` | 14 个自增列背后的序列与 `audit_no_seq` |
| 函数 `EXECUTE` | `lyx_03_purge_auth_event`（已收回所有人的执行权，只授给它） |
| 没有任何权限 | 分区子表（经父表 `analytics_event` 读写）、`_prisma_migrations` |

- 两个角色不可登录、不带口令，实例上已有同名角色就不再建（也不改它的属性）。登录账号另建，加为这两个角色的成员（`GRANT lyx_app TO <应用的登录账号>`）；账号的名字、口令、怎么加，由环境初始化做，不进迁移。
- 跑迁移的账号不能建角色时（没有 `CREATEROLE`），先由控制台或管理账号把两个角色建好，再跑迁移。预建的必须是不可登录、不带口令的角色（`CREATE ROLE lyx_app NOLOGIN`、`CREATE ROLE lyx_readonly NOLOGIN`），不要直接建成带口令的登录账号：那样迁移照样跑通，但 `pnpm db:verify-grants` 报“角色的属性不对”，改回 `NOLOGIN` 才通过（2026-10-05 本机实测）。
- `auth_event` 的删除没有触发器拦：清理函数要删 12 个月以前的行。拦应用的是权限，清理函数自己卡 12 个月的下限。
- 期望的授权只写在一处：`src/grants.expected.json`（手写，不是生成物；各项的含义见文件开头的“说明”）。它与迁移里的授权语句各写各的；库里多一张表而它里面没有、少授、多授，即失败。读它的有两处：
  - 权限测试 `pnpm --filter @liyoxi/db exec vitest run src/grants.test.ts`（也在 `pnpm test` 里）：验“迁移在空库上建出来的”授权，并以各角色的身份实际去改、去删。
  - 核对脚本 `pnpm db:verify-grants`（`infra/ci/db-verify-grants.mjs`）：只读系统目录，核对一个已经部署的库，逐表与同一份期望比。
  - 系统目录比对（第 6 节）不比授权。
- 以后怎么跟。在建它的那个迁移里写授权，同一个 PR 改 `src/grants.expected.json`：
  - 加表：`tables` 里加一行（表名与 `lyx_app` 的表级权限，权限按字母序、逗号连接）。只增表另加进 `appendOnly`；触发器放行的例外列写进 `columnUpdate`。
  - 加以属主身份执行的函数（`SECURITY DEFINER`）：先收回 PUBLIC 的执行权，`definerFunctions` 里加一行，写明由谁执行。
  - 加自增列：迁移里给背后的序列授 `USAGE`。序列按规则核对（全部只给 `lyx_app` 的 `USAGE`），不用登记；`src/grants.test.ts` 里另有一张自增列的清单（`SERIAL_COLUMNS`）与几处写死的数量（166 张表、16 张只增表、15 个序列、11 列），跟着改。
  - `lyx_readonly` 不用写：缺省授权自动带上。
  - 不用改的：`infra/ci/db-verify-grants.mjs` 与它的两份用例（`infra/ci/test/db-verify-grants.test.ts`、`db-verify-managed-hook.test.ts`）。它们是门禁文件，改已有的行要走单独的门禁 PR；所以里面的数量都是现查的，期望都读上面那一份。`src/grants.expected.json` 与 `src/grants.test.ts` 不是门禁文件，随工作包 PR 改。
  - 改一张已有表的授权也是这两处一起改：新迁移，加上期望里那一行。只改期望而没有对应的迁移，权限测试就红。
- 以应用角色的身份连库（排查权限问题时用；要管理账号）：连接串后面加 `?options=-c%20role%3Dlyx_app`，等同于连上之后 `SET ROLE lyx_app`。
- 权限测试插夹具行时靠 `session_replication_role = replica` 绕开外键，要超级用户；在不是超级用户的托管库上跑不了，那里用 `pnpm db:verify-grants`：它逐表核对的是同一份期望，只是不以应用角色的身份实际去改、去删。
- Prisma 遇到手写的约束、索引、触发器、分区会怎样，之后出下一版迁移的固定做法，建分区的函数由谁执行：见 [ADR（待分配编号）](../../docs/adr/draft-W0-06a-迁移草稿由migrate-diff从库到schema出-手写对象与授权人工补.md)。
