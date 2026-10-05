# ADR-待分配 迁移草稿由 migrate diff（库 → schema）出，手写对象与授权人工补，漂移靠结构快照把关

| 项 | 内容 |
| --- | --- |
| 状态 | 提议。实验都在本地的 PostgreSQL 17.11 与 Prisma 7.9.1 上做（2026-10-05）；托管库上的表现留给 V5 |
| 日期 | 2026-10-05（起草日；合并日不同则改成合并日） |
| 工作包 | W0-06a |
| 取代 | 无 |
| 关联 | ADR-041（托管库改到建生产时验）；V5（扩展）；计划 第 11 节风险 3；W0-06b（结构快照、迁移规范检查）；G2-C（建分区的周期任务）；G2-D（环境初始化、迁移容器） |
| 回写 | 03 分组 第 2.8 节、08 分组 第 2.12 节、14 分组 第 2.3 节（各补一句授权说明）；`packages/db/README.md` 第 9 节；`docs/plan/status/W0-06a.md` |

## 背景

- 表结构有两个来源：`schema.prisma`（Prisma 看得懂的部分）与手写 SQL（CHECK、部分索引、排他约束、触发器、函数、分区）。首版迁移把两者拼在一起（W0-05）。之后每个结构变更包都要再出迁移，得先知道 Prisma 遇到手写对象会怎样（计划 第 11 节风险 3；06 第 8 节“没有验证的”）。
- 计划 第 5.3 节“禁止”行：不用 `prisma migrate dev` 的自动产物。D7 第 8.3 节第 1 条写的是“用 `prisma migrate dev --create-only` 生成 SQL 后允许手改”，两处说法不一致（D7 是附录草案，以计划为准）。
- 本包加了第二个迁移：角色与授权。授权不在 `schema.prisma` 里，Prisma 一概不管，以后加表时要有人记得补。
- 任务书 第 10 节第 4 步要回答五个问题，第 11 节第 5、7 项另有两件事要写清：`lyx_archiver` 要不要、建分区的函数由谁执行。

## 决定

1. 出下一版迁移的草稿，固定用“库 → schema”的 `prisma migrate diff`，只当草稿用，人工删改补全后入库。不用 `prisma migrate dev`（含 `--create-only`）、`migrate reset`、`db push`。
2. 手写对象（CHECK、部分索引、表达式索引、排他约束、触发器、函数、分区）与授权，Prisma 不出、也不比：一律人工写进迁移。它们有没有被误伤，靠结构快照与约束清单比对（W0-06b）和权限测试、角色与授权的核对脚本（本包；两者共用一份期望 `packages/db/src/grants.expected.json`）把关，不靠 Prisma。
3. 授权随迁移走：新表在建它的那个迁移里逐表授给 `lyx_app`；`lyx_readonly` 靠缺省授权自动带上。全部迁移由同一个账号执行：这是缺省授权成立的前提（第 3 节“谁来跑”一行）。
4. V1.0 不建 `lyx_archiver`。建分区的函数建议改成“以属主身份执行”再授给 `lyx_app`，落地在 G2-C；本包不改函数。

### 1. 出下一版迁移的固定做法

| 步 | 做什么 |
| --- | --- |
| ① 改模型 | 改 `packages/db/prisma/schema.prisma` |
| ② 出草稿 | 找一个跑完现有全部迁移的库（本地的 `lyx_migrate_check`，或新建一个 `lyx_` 开头的库先 `pnpm db:deploy`），执行：`DATABASE_URL=<那个库> pnpm --filter @liyoxi/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`。只读那个库，不写；输出在标准输出 |
| ③ 落文件 | 新建 `prisma/migrations/<UTC 时间戳，14 位>_<名>/migration.sql`，贴进草稿。时间戳不要取未来的时刻：Prisma 按目录名的字典序认先后 |
| ④ 必删 | `DROP INDEX "ix_store_asset_search";`。这一句每次都会出现（见“理由”第 1 问） |
| ⑤ 逐条核对 | 草稿里凡 `DROP`、`RenameIndex`，不是本次要做的一律删。已知的假动作：schema 里新加的普通索引与某个手写的部分索引同列时，Prisma 出的不是 `CREATE INDEX`，而是把那条部分索引改名，要改写成 `CREATE INDEX` |
| ⑥ 必补 | Prisma 不会出的：新表、新列上的 CHECK、部分索引、表达式索引、排他约束、触发器、函数；标量数组列的 `SET NOT NULL`；新表的授权（第 3 节）；四类语句前的 `-- lyx:allow <理由>`（D7 第 8.3 节第 5 条） |
| ⑦ 删列、改列类型之前 | 先查这一列上有没有手写的 CHECK、部分索引、触发器参数。`DROP COLUMN` 会连带把引用它的 CHECK 与索引一起删掉，不报错；触发器留下，参数里还写着已经不存在的列名 |
| ⑧ 核对 | 空库上 `pnpm db:deploy` 跑通，再跑一遍没有待执行的迁移；再出一次草稿，输出只剩第 ④ 步那一句（多出别的，说明迁移与模型不一致）；`pnpm --filter @liyoxi/db exec vitest run src/grants.test.ts`（新表没补授权会红：在 `packages/db/src/grants.expected.json` 里给新表加一行）；手写对象的增减看结构快照的差异（W0-06b 交付之前没有这道检查，靠评审逐条读迁移） |

删列三步、CHECK 替换三句、大表加索引等写法照 D7 第 8.3 节第 2 条，本条不重复。

### 2. 客户端怎么用手写对象

| 对象 | 能直接用的 | 要写原始语句的 |
| --- | --- | --- |
| 分区表 `analytics_event`（复合主键） | `create`、`createMany`（含 `skipDuplicates`）、按复合主键 `findUnique`、`findMany`、`count`。经父表读写，行自动落到分区 | 不要直接读写分区子表：应用角色在子表上没有权限 |
| 只增表 | `create`、`createMany`、查询 | `upsert` 用不了：冲突时走 `UPDATE`，应用角色没有这个权限（报 42501）。要“有就跳过”用 `createMany({ skipDuplicates: true })` |
| 部分唯一索引（如 `uq_param_value_key_effective_at`） | 撞上时 `create` 报唯一冲突（23505）；`createMany({ skipDuplicates: true })` 会跳过。按这组列查找用 `findFirst` 带上谓词 | 指明冲突目标（`ON CONFLICT (…) WHERE … DO …`）只能用 `$executeRaw` / `$queryRaw`；`findUnique`、`upsert` 的唯一条件里没有这组列（schema 里没有它） |
| 例外列（只增表上放行“写一次”的列） | `update` 的 `data` 里只给放行的列：客户端只把给了的列写进 `SET`。多带一列就报 42501 | — |

### 3. 授权怎么跟

| 项 | 规则 |
| --- | --- |
| 新表 | 建它的迁移里逐表写 `GRANT … TO lyx_app`。常规表给 `SELECT, INSERT, UPDATE, DELETE`；行不物理删除的不给 `DELETE`；只增表只给 `INSERT, SELECT`，触发器放行的列另授列级 `UPDATE`。同一个 PR 在 `packages/db/src/grants.expected.json` 的 `tables` 里给它加一行（只增表另加进 `appendOnly`，例外列写进 `columnUpdate`）：权限测试与核对脚本都读这一份，不加就红 |
| 新的自增列 | 背后的序列授 `USAGE`，否则插不进去 |
| 新的 `SECURITY DEFINER` 函数 | 先 `REVOKE ALL … FROM PUBLIC`，再授给要用它的角色；并在 `grants.expected.json` 的 `definerFunctions` 里登记由谁执行 |
| `lyx_readonly` | 不用写：授权迁移里的缺省授权让“跑迁移的账号”以后建的表与序列自动对它只读 |
| 谁来跑 | 全部迁移由同一个账号执行：本地与 CI 是管理账号，预发与生产是 `lyx_migrator`（D7 第 8.3 节第 6 条）。换一个不是属主的账号来跑，授权语句报“permission denied”。它也是 `lyx_readonly` 缺省授权成立的前提：那两条缺省授权只挂在跑授权迁移的那个账号名下、只在这个库里，只对这个账号以后建的表与序列生效。实测：换一个账号在这个库里建一张表，`lyx_readonly` 读不到它，以 `lyx_readonly` 身份做的逻辑备份（`pg_dump`）整个失败（`permission denied for table …`），核对脚本报“`lyx_readonly` 的权限不是恰好 SELECT 的表”。所以后面的迁移、建分区都不要换账号；真要换，属主与缺省授权都得跟着换，那是一次要单独设计的操作，本条没有试 |
| 登录账号 | 迁移建的两个角色不可登录、不带口令，之后也不要把它们改成可登录。登录账号另建（名字与口令由环境初始化定，G2-D），加为这两个角色的成员（`GRANT lyx_app TO <应用的登录账号>`），不进迁移。核对脚本与权限测试都把“`lyx_app`、`lyx_readonly` 可登录”判为不通过。D7 第 7.5 节与 `docs/plan/runbook.md` 写的“`lyx_app` 的数据库口令”因此指的是那个登录账号的口令（两份文档本包没有改，列在偏差里） |
| 迁移中途失败 | 授权迁移是整个放在一个事务里执行的：中途出错整体回滚，库里不留一句授权、缺省授权、模式授权，这次新建的角色也不留（2026-10-05 实测两种：先只跑首版迁移，再让授权迁移在最后一组授权上出错；跑迁移的账号没有 `CREATEROLE`、实例上又没有这两个角色）。`pnpm db:deploy` 报 `P3018`，`_prisma_migrations` 里留一行未完成的记录；把出错的原因修好之后直接再跑报 `P3009`，要先 `pnpm --filter @liyoxi/db exec prisma migrate resolve --rolled-back 20261005060000_grants`（只把那一行记录标成已回滚），再 `pnpm db:deploy`。之后的迁移若带显式的事务语句或不能放进事务的语句，失败后是不是整体回滚没有试过：先查库里留下了什么再标记 |

### 4. `lyx_archiver` 与建分区的函数

- `lyx_archiver`：V1.0 不建。D7 第 2.5、7.5 节把它列为“分区归档”的角色，出处是 D4 的审计日志分区；而 D4 定稿时审计日志在 V1.0 不分区。埋点事件的归档是整分区 `DETACH` 再 `DROP`，那是属主才能做的 DDL，头一次发生在上线 25 个月之后（14 分组 第 2.9 节）。到真要归档时，由当时的结构变更包决定要不要这个角色。
- 建分区：14 分组 第 2.9 节写周期任务 `analytics.partitions` “用迁移账号执行”，而 worker 拿不到迁移账号的口令（D7 第 7.5 节）。实测 `lyx_app` 调 `lyx_14_analytics_event_ensure_partition` 报 42501，原文是 `permission denied for schema public`：先卡在它在模式 `public` 上没有 `CREATE`；就算给了，下一层报 `must be owner of table analytics_event`（建分区要是父表的属主）。两层都不该放开。建议（落地在 G2-C，要改函数，走结构变更包）：把这个函数改成 `SECURITY DEFINER`，收回 PUBLIC 的执行权，只授给 `lyx_app`（并在 `grants.expected.json` 的 `definerFunctions` 里加一行）。函数只会建名字固定的月分区，参数只有一个日期；新分区的属主是函数的属主，也就是跑迁移的账号，`lyx_readonly` 的缺省授权照样生效。在那之前：首版迁移已预建到未来 3 个月（按建库那天算）；G2-C 落地前要更远的分区，由结构变更包在迁移里再调一次这个函数，迁移是以属主身份执行的。

## 理由

五个问题的实验。命令都在 `packages/db` 下执行，`DATABASE_URL` 指向跑完两个迁移的库；输出收在本包 PR 的证据里，其中第 3 问固化成了用例。

| # | 问题 | 做了什么 | 结果 |
| --- | --- | --- | --- |
| 1 | 库 → schema 的 `migrate diff` 有没有针对手写对象的 `DROP` 或重建 | `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` | 只有一句：`DROP INDEX "ix_store_asset_search"`（`--exit-code` 为 2）。它是手写的 GIN 三元组索引，既不是部分索引也不是表达式索引，Prisma 认得出、而 schema 里没有。其余手写对象都不出现：183 个部分索引、3 个表达式索引、1,284 条 CHECK、1 个排他约束、126 个触发器、函数、5 个分区子表、标量数组列的 `NOT NULL`。分区后的 `analytics_event` 本身没有差异 |
| 1（续） | 反方向，与四种假设的改动 | schema → 库方向；另拿一份改过的 schema 试四种改动：给带手写约束的表加可空列、加新表、给分区表加可空列、加一个与已有部分索引同列的普通索引 | 反方向多出一句假的 `RenameIndex`（把 schema 里的索引改名成同列的手写部分索引）。四种改动里前三种的草稿正确；第四种出的是给手写部分索引改名，不是建新索引 |
| 2 | `migrate deploy` 会不会因手写对象报漂移或失败 | 空库上连跑两遍 `migrate deploy`；再手工删掉一个部分索引、一个触发器、一条 CHECK，重跑 `migrate deploy`、`migrate status`、`migrate diff` | 不会。两遍都成功，第二遍“No pending migrations to apply.”。删掉手写对象之后三条命令照旧报正常，`diff` 的输出一字不变：Prisma 看不出手写对象少了 |
| 3 | 客户端读写分区表、遇到部分唯一索引 | `packages/db/src/grants.test.ts` 末尾三例，以 `lyx_app` 身份 | 见“决定”第 2 节的表，每一格都有断言 |
| 4 | 之后出迁移的固定做法 | 比了三种出草稿的办法 | `--from-config-datasource`：只读一个已有的库，不要额外配置，选它。`--from-migrations`：报错，要在 `prisma.config.ts` 里配影子库。`migrate dev --create-only`：草稿内容相同，但它直接往迁移目录落文件（实测），按 Prisma 的文档还要自己建、删影子库，计划 第 5.3 节禁用 |
| 5 | 托管库上建角色与授权可能受什么限制 | 在另一个临时实例上，用一个不是超级用户、只有 `CREATEROLE` 与 `CREATEDB` 的账号跑两个迁移 | 跑得通：两个扩展是可信扩展，建库的账号就能建；角色、授权、缺省授权都生效。限制见下表 |

留给 V5 在托管库上实测的项（本地试出来的表现写在后面，托管平台可能不同）：

| # | 项 | 本地的表现 |
| --- | --- | --- |
| 1 | 跑迁移的账号有没有 `CREATEROLE` | 没有时建角色报“permission denied to create role”，迁移失败。退路：先由控制台或管理账号建好 `lyx_app`、`lyx_readonly`，迁移见到已有就跳过。预建的必须是不可登录、不带口令、没有任何特权属性的角色（`CREATE ROLE lyx_app NOLOGIN`）；登录账号另建并加为成员。本地实测：这样预建之后，没有 `CREATEROLE` 的账号跑 `pnpm db:verify-managed` 两段都通过。预建成可登录的（控制台建带口令的账号通常就是这样）：迁移照样跑通、不改它的属性，但核对脚本报“角色的属性不对”，改回 `NOLOGIN` 才通过。平台若不让建不可登录的角色，那是要回到这里改决定的事，不是放宽核对 |
| 2 | 两个迁移是不是同一个账号跑的 | 换一个不是属主的账号跑授权迁移：`permission denied for table idempotency_record` |
| 3 | 跑迁移的账号是不是库的属主 | 不是时 `GRANT USAGE ON SCHEMA public` 只出警告、不失败；平台若收回了所有人对 `public` 的使用权，应用角色会进不了模式（表上的授权都在，却一张表也找不到）；核对脚本会报“进不了模式 public（没有 USAGE）的角色” |
| 4 | 管理账号能不能切换到 `lyx_app` | 16 起不能直接切：建角色的账号只拿到管理权。要先 `GRANT lyx_app TO <自己> WITH SET TRUE`。权限测试靠切换角色，所以它只在本地与 CI 跑；托管库验证脚本只读系统目录，不切换角色 |
| 5 | 缺省授权 | 同一个账号之后建的分区，`lyx_readonly` 自动可读，`lyx_app` 在子表上没有权限 |
| 6 | 逻辑备份 | `pg_dump --role=lyx_readonly` 成功；换成 `lyx_app` 失败（读不了 `_prisma_migrations` 与分区子表） |
| 7 | 平台对角色名、对控制台之外建的角色有没有限制；连接代理下启动参数里的 `role` 是否可用 | 没法在本地试 |

## 放弃的备选

| 备选 | 为什么不选 |
| --- | --- |
| `prisma migrate dev --create-only` 出草稿（D7 第 8.3 节第 1 条的写法） | 计划 第 5.3 节禁用它的自动产物；它直接往迁移目录落文件，目录名取当时的 UTC 时钟（实测）；按 Prisma 的文档，它要建库的权限来建影子库，发现漂移时会提示重置开发库 |
| `migrate diff --from-migrations`（由迁移目录推出起点） | 要在 `prisma.config.ts` 里配影子库；起点与“库 → schema”相同，没有多出来的好处 |
| 把手写的部分索引、GIN 索引写进 `schema.prisma`（Prisma 的预览特性） | 预览特性的行为随小版本变；CHECK、触发器、排他约束、分区仍然表达不了，两个来源并存的局面不变 |
| 授权用“全部表一把授”加缺省授权给 `lyx_app` | 新表默认就是可改可删，只增表的那道权限要靠人记得收回，方向反了 |
| 迁移里直接建可登录的账号并设口令 | 口令进仓库与迁移历史（D7 第 7.5 节） |
| 让 worker 持有迁移账号的口令去建分区 | 应用节点被攻破就拿到 DDL 权限，“只增表删不掉”的库层保证随之失效（D7 第 7.5 节） |

## 代价

- 每次出草稿都要人工删掉 `DROP INDEX "ix_store_asset_search"`，并逐条核对索引的改名。漏删会把素材搜索的索引删掉；W0-06b 交付之后，结构快照会多出差异，迁移规范检查也会因为那句 `DROP` 没带 `-- lyx:allow` 而失败。
- Prisma 对手写对象既不建也不查：少一个触发器、少一条 CHECK，`migrate deploy`、`migrate status`、`migrate diff` 都看不出来。W0-06b 合并之前只有评审这一道。
- 授权清单有两份：迁移里的语句、`packages/db/src/grants.expected.json` 里的期望（权限测试与核对脚本共用）。加表要改两处，这是有意的重复。期望那一份不是门禁文件：改它不用走单独的门禁 PR；但只改它而没有对应的迁移，测试就红，而迁移是甲类、要业主同意。
- 上面的结论只对 Prisma 7.9.1 成立。升级 Prisma 时把第 1、2 问的实验重做一遍：它对部分索引的处理不是文档里的承诺，是试出来的。
- 权限测试插夹具行时靠 `session_replication_role = replica` 绕开外键，要超级用户；它证明的是权限与触发器，不证明业务写入路径上的外键与触发器（那由各服务包的连库测试覆盖）。
