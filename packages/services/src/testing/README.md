# 测试支架

并行的会话与并行的 Vitest worker 连同一份 PostgreSQL 与 Redis 而互不干扰；另带可拨时钟与四种故障注入工具。由 W0-05b 交付。依据：[开发计划](../../../../docs/08-development-plan.md) 第 5.4、5.6、9.3 节；[01](../../../../docs/01-architecture.md) 第 12 节；任务书 `docs/plan/tasks/W0-05b.md`。

全部从 `@liyoxi/services/testing` 引（`packages/db` 自己的用例从 `./testing` 引：db 不能依赖 services）。只给测试用，不进生产装配。十二个 Provider 替身也在这个出口，说明见 [../providers/README.md](../providers/README.md)。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `packages/db/src/testing/database.ts` | 测试库的名字与守卫；建库、删库、重置、连接四个入口；清理的挑选规则 |
| `packages/db/src/testing/global-setup.ts` | Vitest 的 globalSetup：每轮测试开始时建本会话的模板库并跑全部迁移，结束时删掉 |
| `packages/db/src/testing/worker.ts` | `useTestDatabase`：每个 worker 一个库 |
| `packages/db/src/testing/prune.mjs` | `pnpm test:db:prune` |
| `redis.ts` | `useTestRedis`：每个 worker 一个键前缀；“清空”只清自己的 |
| `clock.ts` | `createClock`：可拨时钟 |
| `fault/` | 四种故障注入：`deliverRepeatedly`、`runUntilCrash` 与 `crashPoint`、`createRedisOutage`、`createCallInterrupter` |
| `isolation.mjs` | `pnpm test:isolation` |
| `global-setup.ts` | 转导出上面那个 globalSetup，给本包与应用层挂 |
| `assembly.ts` | `assembleForTest`：测试装配（W0-07b） |
| `data/` | 测试数据支撑（W0-25）：带种子的干净库 `useSeededDatabase`、造数据的工厂 `createFactories`、表快照比较器、假 Provider 支架。说明在 [data/README.md](data/README.md) |

## 2. 测试库

隔离单位是“库”，不是 schema（开发计划 第 5.4 节）。原因三条：底稿里有写死 `search_path = public` 的函数（如 `lyx_03_purge_auth_event`），换 schema 隔不开；扩展是库级的；只增表有触发器拦 TRUNCATE、应用角色也没有删除权，清表这条路走不通。

```ts
import { useTestDatabase } from "@liyoxi/services/testing";

const db = useTestDatabase("services"); // 测试文件顶层；包名取 db、services、api、worker

it("……", async () => {
  const prisma = await db.prisma(); // 首次取连接时才建库
  // ……
  await db.reset(); // 要一个干净的库：删库重建。之后重新 await db.prisma()
});
```

- 名字：`lyx_test_<包>_<会话标识>_<worker 编号>`；同一个文件要第二个库时写 `useTestDatabase("services", { label: "b" })`，名字末尾多一段 `_b`。模板库是 `lyx_test_tpl_<会话标识>`。
- 会话标识：环境变量 `LYX_TEST_SESSION`（1–12 位小写字母与数字）；没设就取本检出根路径的短哈希，所以每个 worktree 天然各用各的。worker 编号取 Vitest 给的 `VITEST_POOL_ID`（1 到并行数）。
- 生命周期：每轮测试开始，globalSetup 重建模板库并 `prisma migrate deploy`，建完关掉它的连接入口；测试文件第一次取连接时从模板库拷一份（约 0.2 秒）；文件里的用例全过，收尾时删库；有失败，库改名为 `<库名>_k<时间戳>` 留下，名字打印在输出里，看完用 `pnpm test:db:prune` 清掉。用例失败、钩子（`beforeAll`、`afterAll`、`beforeEach`、`afterEach`）失败都算失败：收尾挂在 `aroundAll` 上，把这一组用例连同它的钩子整个包在里面，跑完看结果。
- 守卫：建库、删库、重置、连接四个入口都先过 `assertTestDatabaseName`，名字不是 `lyx_test_` 开头即抛错，一句 SQL 都不发。装配测试用的服务容器之前，用 `assertTestDatabaseUrl(连接串)` 给连接串把关。
- 重置 = 删库重建，不清表。重置之前取的 Prisma 客户端作废，要重新取。
- 角色：给用例的连接缺省切到应用角色 `lyx_app`（W0-06a 的授权迁移建的；W0-05b 任务书 第 11 节第 8 项，由两个包里后合并的 W0-06a 改）。登录的仍是 `DATABASE_URL` 的账号，靠启动参数切过去，等同于连上之后 `SET ROLE lyx_app`，断了重连也还是它。用例看到的权限因此与 api、worker 一样：只增表只能插入与查询，`file_object` 删不了，建不了表，读不到 `_prisma_migrations`，在 `pg_stat_activity` 里看不到别的会话处在什么状态。逐表的权限见 [packages/db/README.md](../../../db/README.md) 第 9 节。
  - 要属主身份时写 `role: null`：不切角色，用 `DATABASE_URL` 的账号（本地与 CI 是管理账号，也是表的属主）。只在应用角色做不了的事上用：建探针表、造应用角色写不进去的数据、读迁移记录表、看别的会话的状态、验触发器那一道。
  - 写在哪：`useTestDatabase("services", { role: null })` 管这个句柄给出的连接串与 Prisma 客户端；`connectTestDatabase(db.name, { role: null })`、`testDatabaseUrl(db.name, { role: null })` 只管这一条连接。同一个库上可以两种身份各开一条：用例照常走缺省的连接，只有那一两句用属主的连接。
  - 也可以写别的角色名，如 `{ role: "lyx_readonly" }`。
  - 建库、删库、重置、改名、建模板库与跑迁移是支架自己的管理动作，一直用 `DATABASE_URL` 的账号，不受这个选项影响。
  - `DATABASE_URL` 的账号要切得过去：是超级用户，或是那个角色的成员（本地与 CI 的管理账号是超级用户）。
  - 缺省由 `packages/db/src/testing/worker.test.ts` 里的一条用例钉住：缺省拿到的连接 `current_user` 是 `lyx_app`，只增表上改、删、清空都报 `42501`；写 `role: null` 才是 `DATABASE_URL` 的账号。
- 同一个会话标识同一时刻只许一轮测试：globalSetup 用一把咨询锁占着，第二轮会报“会话标识 … 已经有一轮测试在跑”。同一个检出里要同时跑两轮，各给一个 `LYX_TEST_SESSION`。清理命令判断“会话在不在跑”只看 `pg_locks`，不去抢这把锁。
- 连库的时限：删库要等数据库做一次检查点，实例上别的会话正在大批建表时会慢到十几秒。收尾钩子的时限已放到 120 秒；自己的用例里连库的那几条也建议写明 `{ timeout: … }`，不要用缺省的 5 秒。

### 清理：`pnpm test:db:prune`

```sh
pnpm test:db:prune              # 删本会话留下的测试库
pnpm test:db:prune --dry-run    # 只列出要删的
pnpm test:db:prune --session <会话标识>
pnpm test:db:prune --all        # 实例上全部 lyx_test_ 开头的库
```

- 只删 `lyx_test_` 开头的库，每个名字再过一遍守卫；别的库一个不动。
- 所属的会话正有一轮测试在跑（会话锁被占着）的库不删，列在“没删”里。
- `--all` 连别的会话的 infra 用例自己建的 `lyx_test_infra_…` 也删（它们不按本支架命名，认不出属于哪个会话）：别人正在跑测试时不要用。

## 3. Redis

按键前缀隔离，不按库号（库号只有 16 个，会话数乘 worker 数不够分）。前缀是 `lyx:test:<会话标识>:<worker 编号>:`，落在 D7 第 2.5 节的 `lyx:{env}:` 之下。

```ts
import { useTestRedis } from "@liyoxi/services/testing";

const redis = useTestRedis(); // 测试文件顶层

it("……", async () => {
  const client = await redis.client(); // ioredis，键自动套上本 worker 的前缀
  await client.set("k", "v"); // 实际的键是 lyx:test:<会话>:<worker>:k
  await redis.flush(); // 清空自己前缀下的键
});
```

- “清空”只用 `SCAN` 加 `UNLINK`，不用 `FLUSHDB`、`FLUSHALL`：共享的那份 Redis 上还有别的会话、别的 worker 与本地开发的键。前缀同样有守卫（`assertTestRedisPrefix`）。
- 首次取连接时先清掉这个前缀下上一轮的残留；测试文件跑完，自动断开并清空。收尾挂在 `aroundAll` 上（与测试库同一个办法）：测试文件自己的 `afterAll` 先抛了错，收尾照样执行，键不留在共享的 Redis 上。
- 收尾返回时，发出去的连接都已经真的断开，状态是 `end`。例外一种：收尾那一刻正等着重连的连接（Redis 不可用时就是这样），它的 socket 早就关了，收尾只取消重连，ioredis 不再发 `end` 事件，状态停在 `reconnecting`；它不会再连上，也发不出命令。
- 等一条连接断开最多 10 秒。到点还没断开（对端一直不关）：强行关掉它，本前缀下的键照样清空，清完再报错“Redis 连接 … 毫秒内没有断开（状态停在 …），已强行关掉”。
- 自己另建的连接（`new Redis(...)`）收尾时用 `await disconnectTestRedis(client)`，不要 `client.disconnect()` 完就当它断了：ioredis 的 `disconnect()` 只是发起断开，状态要等对端把连接关掉才变，机器忙的时候晚到几十毫秒是常事。断言连接状态之前先等它；它返回时的状态与上面两条相同。
- BullMQ 不认 ioredis 的 `keyPrefix`，要用它自己的 `prefix` 选项：写 `` `${redis.prefix}bull` ``，连接用 `await redis.raw()`（不带前缀的连接）。
- 连接串取环境变量 `REDIS_URL`。

## 4. 可拨时钟

```ts
import { createClock } from "@liyoxi/services/testing";

const clock = createClock(); // 缺省起点 2026-01-05 12:00（北京时间）；也可以传一个 Date
clock.advance(60_000); // 往前拨一分钟
clock.set(new Date("2026-03-01T00:00:00+08:00")); // 直接拨到某个时刻，可以往回拨
```

不拨就不走。形状是 `{ now(): Date }` 加 `advance`、`set`；kernel 的 `Clock` 接口由 W0-07 定义，与它同形。它可以直接传给十二个替身：`createFakeProviders({ clock })`。

## 5. 故障注入

四种工具，各有自测（`fault.test.ts`）。这里只交工具；拿它们去压内核是 W0-13、W0-20、W0-23、W0-30 的事。

| 工具 | 造什么 | 要点 |
| --- | --- | --- |
| `deliverRepeatedly(handler, message, { times, mode })` | 重复投递：同一条消息投 N 次，`serial` 一次处理完再投下一次，`concurrent` N 次同时投出去 | 每次给处理函数的是消息的一份深拷贝；处理函数抛错不打断后面的投递，结果里分 `fulfilled`、`rejected` |
| `runUntilCrash({ module, crashAt, payload })` 与 `crashPoint(name)` | 进程中断：起子进程跑一段场景，到指定断点由父进程发 SIGKILL | 场景是一个模块导出的函数（TypeScript 也行），在想断的位置写 `await crashPoint("名字")`。子进程拿不到父进程里的对象，连接串之类经 `payload` 传。`onReach` 在子进程停在断点上、被杀之前执行，可以查一眼未提交的状态。场景模块不要引 Vitest 的钩子 |
| `createRedisOutage()` | Redis 不可用：在客户端一侧造，不停共享的那份 Redis | 返回的 `url` 是本机的一个转发口，客户端连它；`await outage.down()` 之后连接被拒，`await outage.up()` 之后恢复。别的会话连的是真的 Redis，不受影响 |
| `createCallInterrupter()` | 外部调用前、中、后中断 | `arm("before" \| "during" \| "after")` 布置，`call(fn)` 或 `wrap(fn)` 包住外部调用。`before`：没发出去；`during`：发出去了，调用方立刻拿到错，外部一侧照常处理完（`await inFlight()` 等它）；`after`：应答回来了，挂在错误的 `result` 上 |

## 6. 命令

| 命令 | 做什么 |
| --- | --- |
| `pnpm test` | 全量测试。`packages/db`、`packages/services` 两个项目挂了 globalSetup：只跑其中不连库的用例，也要本地的 PostgreSQL 在运行并给出 `DATABASE_URL`；连 Redis 的用例另要 `REDIS_URL`（取值见 `CLAUDE.md` 第 9 节） |
| `pnpm test --maxWorkers=4` | 指定并行数。参数直接跟在后面，**不要写 `--`**：`pnpm test -- --maxWorkers=4` 里 `--` 之后的参数会被 Vitest 忽略（2026-10-05 实测，pnpm 10.34.5、Vitest 4.1.11） |
| `pnpm test:isolation` | 两个会话同时跑全量测试，都要绿，且两边用的库名与 Redis 前缀没有交集。本地出验收证据用它 |
| `pnpm test:isolation --scope connected` | 同上，但只跑连 PostgreSQL、Redis 的测试项目。CI 的 `verify` 里的那一步是这一条 |
| `pnpm test:db:prune` | 清理测试库，见第 2 节 |

### `pnpm test:isolation` 的参数

```sh
pnpm test:isolation                      # 两个会话各跑一遍全量测试
pnpm test:isolation --scope connected    # 只跑连库的测试项目（CI 用）
pnpm test:isolation --workers 4          # 每个会话 4 个 worker，不按核数定
pnpm test:isolation --keep               # 通过了也留着日志与用量记录
pnpm test:isolation --dry-run            # 只打印要跑什么，不跑
```

- 怎么知道两边用了什么：环境变量 `LYX_TEST_USAGE_FILE` 给了文件路径时，支架每建一个库、每发一个 Redis 前缀往里追加一行 JSON。平时不设这个变量，什么都不记。
- 核对的内容：两份记录都有库、有 Redis 前缀、有一条“4 个 worker 同时在场、4 个互不相同的库”的记录（`parallel.test.ts` 嵌套跑一轮确定的 4 个 worker 写的，不随 `--workers` 变）；两边的库名、Redis 前缀没有交集。
- 每个会话几个 worker：缺省按本机的核数定，两个会话合起来不超过可用核数，每个会话最多 4 个、至少 1 个（10 核各 4 个，4 核各 2 个，2 核各 1 个）。worker 开得比核数多，别的用例会被挤到超时：CI 的执行机只有 2 核，第一次各开 4 个时，`infra` 里一条 60 秒时限的用例跑了 65 秒。要照任务书的字面“各 4 个”跑，就在 8 核以上的机器上跑，或者显式给 `--workers 4`。
- `--scope connected` 跑哪些项目：挂了 globalSetup 的项目都算，问的是 Vitest 解析出来的配置，不在脚本里列名字。现在是 `packages/db`、`packages/services`。隔离出问题只可能出在连库、连 Redis 的用例上，纯计算的用例跑两遍证明不了什么。
- CI 为什么只跑 connected：给时长预算留余量（开发计划 第 5.5 节，PR 必过检查合计 ≤15 分钟），不是全量放不进。两个会话各跑一遍全量，等于把全量测试再跑两份，以后不管加的是什么用例，这一步都跟着多付两份；只跑连库的项目，多付的只有连库的那部分。执行机上量到的两组数（执行机 2 核，两个会话各 1 个 worker；预算 900 秒）：只跑连库的项目（现在的做法；运行 37289835462，提交 `e3d1f8d`）这一步 113 秒，`verify` 8 分 42 秒，必过检查合计 534 秒；全量（实验 PR #36，已关闭；运行 37293784179）这一步 304 秒，`verify` 11 分 40 秒，必过检查合计约 11 分 51 秒。本 PR 第一次运行（37281679968）是两个会话各开 4 个 worker 跑全量，那一步 305 秒后失败，红在用例超时上，不在预算上。这一处与任务书验收第 2、10 条的字面（CI 里跑全量）有出入：业主 2026-10-05 定了用现在的做法，记在 `docs/plan/status/W0-05b.md` 偏差 12。`infra` 里两份连库的用例（`db-catalog-diff`、`db-verify-managed`）不在 connected 里：它们不走本支架，库名带进程号，自己建、自己删；不带 `--scope` 的全量里有它们（另见第 9 节）。
- connected 这一步的开销跟着连库的用例涨：服务包的连库用例多起来之后，它也会接近“测试”一步的时长。到时候的办法是计划 第 5.5 节写的那两个：按受影响的包跑，或挪到“合并后”一栏。
- 日志与用量记录放在系统临时目录：通过即删；没过的留着，位置打印在输出里。

## 7. 给一个新的包挂上

1. 包的 `vitest.config.ts` 里加 `globalSetup: ["@liyoxi/services/testing/global-setup"]`（`packages/db`、`packages/services` 写的是相对路径）。几个项目都挂了它时，同一轮里模板库只建一次。**只连 Redis、不连库的包也要挂。**
2. 测试文件里 `useTestDatabase("<包>")`。包名只能取 `db`、`services`、`api`、`worker`：要加新的，改 `packages/db/src/testing/database.ts` 的 `TEST_PACKAGES`。
3. 没挂 globalSetup 就用 `useTestDatabase` 或 `useTestRedis`，文件一加载就报“本包的 vitest.config.ts 没有挂测试支架的 globalSetup”。
4. 挂上之后不用再改别处：`pnpm test:isolation --scope connected`（CI 的那一步）按“挂没挂 globalSetup”认项目，新的包自动进来。CI 的步骤、`infra/ci/test/workflows.test.ts` 的命令清单都不用动。

## 8. 共享实例上的规矩

本地的 PostgreSQL、Redis、MinIO 只有一份，所有 worktree 共用（`pnpm infra:up`，见 `CLAUDE.md` 第 8、9 节）。

- 不另起一套 Compose（会抢端口）；别的会话在跑测试时不要 `pnpm infra:down`。
- 不直接删别人的库、清别人的键：清理只用 `pnpm test:db:prune`；Redis 不用 `FLUSHDB`、`FLUSHALL`。
- 不往 `liyoxi`、`lyx_schema_check`、`lyx_migrate_check` 这些库里写测试数据：连库的用例一律用 `useTestDatabase`。

## 9. 已知的限度

- 嵌套跑的一轮（`packages/db/src/testing/__fixtures__/`）不挂 globalSetup，用外层那一轮的模板库；不要单独拿它当入口跑。
- “4 个 worker 同时在场”是在嵌套的一轮里验证的（确定的 4 个 worker、4 个文件），不随外层的并行数变；外层那一轮用了哪些库记在用量记录里。
- 失败留库看的是这一组用例与钩子的结果。测试文件自己另挂的 `aroundAll` 失败时，支架收尾那一刻还看不到，库会被当成全过删掉。
- 每个连库的测试文件多付一次建库与删库。实例忙的时候删库可以慢到十几秒（等检查点）；连库的文件多了之后要不要改成“worker 的库留着、用前重置”，到时候再看。
- 进程中断工具的子进程用 Vitest 带的 Vite 加载场景模块，起一个要零点几秒。
- Redis 故障注入只转发不加密的 `redis://` 连接。
- CI 的 `test:isolation` 一步（`--scope connected`）跑哪些项目，靠的是一条约定：用支架就得挂 globalSetup。拦的只有 `useTestDatabase`、`useTestRedis` 两个入口；不经这两个入口连库、连 Redis 的用例，它看不到。今天全仓只有 `infra/ci/test/` 下的 `db-catalog-diff`、`db-verify-managed` 两份是这样：自己起 `psql` 建库，库名带进程号（`lyx_test_infra_catdiff_<进程号>`、`lyx_test_infra_managed_<进程号>`），两个会话同时跑互不相干；CI 的“测试”一步与不带 `--scope` 的全量里照跑。`infra` 或别的没挂支架的项目里再加连库的用例：库名带上进程号，或改用支架并挂 globalSetup。直接用 `TestDatabaseHandle`、`TestRedisHandle`、`connectTestDatabase` 而不挂 globalSetup，同样会被漏在这一步之外。
- `pnpm test:db:prune --all` 会删到别的会话正在用的库。判断“正在用”只有会话锁这一个办法：按本支架命名的库查得到所属的会话，正有一轮测试在跑的不删；不按本支架命名的 `lyx_test_` 库（`infra` 用例自己建的 `lyx_test_infra_…`）没有会话标识，查不了锁，别的会话正用着也照删，那边的用例会红。共享实例上用 `--all` 之前，先确认没有别的会话在跑测试。
- 缺省切到应用角色是为了让用例看到与线上一样的权限，不是隔离手段：登录的仍是 `DATABASE_URL` 的账号，用例里发一句 `SET ROLE NONE`（或 `SET ROLE <那个账号>`）就换回去了；`RESET ROLE` 换不回去，它回到的是连接时定下的角色。要属主身份就明写 `role: null`，不要在用例里自己切（2026-10-05 本机实测，PostgreSQL 17.11）。这个缺省还要 `DATABASE_URL` 的账号切得过去：切不过去时（既不是超级用户、也不是 `lyx_app` 的成员），缺省的连接一连就报错。连库的用例只在本地与 CI 跑，那里的管理账号是超级用户。

## 10. 测试装配

```ts
import { assembleForTest } from "@liyoxi/services/testing";

const assembly = assembleForTest({ entry: "worker", extra: [sampleRegistration] }); // appEnv 缺省 test
```

真实模块的登记之外，再追加用例自己的样例登记（W0-07b）；查重名与缺实现的口径与生产装配相同，两处例外（W0-24）：样例登记实现了某个单实现的端口（如 `createRecordingPorts()` 的告警、违规上报）时，真实模块对同一个端口的实现让位；写 `omitReal: ["recurringJobs"]` 这样的选项时，真实模块的那几类登记不带（只想跑样例周期任务的用例这么写，真实的不变量与清理任务就不会被补登记、被扫描循环领走）；写的是 `portImplementations` 时，没有默认实现的单实现端口（如 tenant 的计费账户端口）照旧带着真实实现，不带就装配不起来，要看它缺实现时的行为用 `withoutRealPorts` 点名。样例的名字用 `lyxtest` 前缀（模块名 `lyxtest_…`，订阅者、kind、事件 `lyxtest.…`），不进契约的正式登记。要看预发专用的登记项写 `appEnv: "stg"`；只装样例写 `isolated: true`。登记怎么写见 [../kernel/assembly/README.md](../kernel/assembly/README.md)。

## 11. 任务进程的样例（W0-23）

```ts
import { createWorkerSample, workerSampleCounts } from "@liyoxi/services/testing";

const sample = createWorkerSample(); // 两个订阅者（关键类、非关键类）、两个定时器处理器、三个周期任务
const assembly = assembleForTest({ entry: "worker", extra: [sample.registration] });
sample.control.failing.add("lyxtest.onPlacedPlain"); // 让它被调到即抛错
(await workerSampleCounts(prisma))["lyxtest.onPlacedPlain"]; // 它已提交的执行次数
```

样例处理器的业务副作用是 `biz_sequence` 里的一行计数，用例据此断言“恰好一次”。订阅者不做幂等（恰好一次由派发序号与行锁保证）；定时器与周期任务的样例处理器照真实处理器的规矩自己守。`control` 另可让定时器返回 `skipped`、在业务写的前后插一脚（卡住处理器、安排进程中断）。名字与 W0-15、W0-17 的样例登记相同，不能与它们同时装配。

