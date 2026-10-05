# staff：员工的凭据与会话

后台登录的服务层，由 W1-01a 的第二个 PR 交付；第三个 PR 接上接口、命令行与演示员工（第 8 节）。依据：[a01](../../../../docs/api/a01-system.md) 第 2.3、2.4、3.1–3.8、3.11 节；[约定](../../../../docs/api/00-conventions.md) C4；[03 分组](../../../../docs/data-model/03-staff-authz-audit.md) 第 2.2–2.5、2.11 节；D4 第 6.2–6.5 节。判权（模块等级、权限点、数据范围、再验证的窗口判断）在 `authz`；接口与中间件在 `apps/api`（它的说明第 7 节）。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `password.ts` | scrypt 哈希与校验（哈希串自带参数）、白跑一次的 `burnPasswordCheck`、口令规则 `passwordViolations` |
| `totp.ts` | RFC 6238 的动态口令、Base32、扫码地址 |
| `codes.ts` | 恢复码（10 个）与激活码（8 位）的生成与哈希 |
| `ticket.ts` | 登录前的三种票据、设备 Cookie：HMAC 签名的短串，都不是会话 |
| `lockout.ts` | 两个桶的失败计数与锁定 |
| `session.ts` | 会话的建、每请求校验、续写、吊销；两个 Cookie 的名字 |
| `login.ts`、`activation.ts`、`bootstrap.ts` | 九个接口对应的用例与命令行引导 |
| `roles.ts` | 角色行与本组成员的加载，进程内缓存 5 秒 |
| `service.ts` | 装配入口 `createStaffAuth` |
| `register.ts` | `staff.status` 的守卫与随迁列；三条清理项 |
| `seed.ts` | 8 个角色（W0-21）与各自的默认组 |
| `me.ts` | 已登录的员工 → 判权用的上下文 `staffContextOf`、当前员工 `buildStaffMe`、员工摘要 `staffBriefOf` |
| `demo-seed.ts` | 7 位演示员工（只进本地、测试与预发） |

## 2. 装配与用法

```ts
const authKeys = security.loadAuthKeys(env); // 票据、设备 Cookie、MFA 三把密钥，启动时加载并自检
const staff = createStaffAuth({
  tx, db: prisma, clock, keyring, authKeys, flow, alerts: alertsOf(assembly),
}); // 进程运行时里已经装好：应用层取 runtime.staffAuth（第一次取时才加载密钥并装配）

// 登录两步
const first = await staff.login({ phone, password, deviceCookie, meta }); // AuthNext：mfa 或 enroll_totp 票据
const signedIn = await staff.verifyMfa({ ticket, method: "totp", code, deviceCookie, meta });
// signedIn.sessionToken、signedIn.deviceCookie 由接口层写进 Set-Cookie；signedIn.principal 拼 StaffMe

// 每请求（会话中间件）
const principal = await staff.authenticate(cookieValue); // 失效即 401 SESSION_INVALID

// 激活四步
await staff.activate({ phone, activationCode }); // → set_password 票据
await staff.setPassword({ ticket, newPassword, meta }); // → enroll_totp 票据；绑过动态口令的回 login
await staff.enrollTotp({ ticket }); // → 密钥与扫码地址
await staff.confirmTotp({ ticket, code, meta }); // → 会话 + 10 个恢复码（只出现这一次）

await staff.stepUp({ principal, method: "totp", code, meta }); // 再验证
await staff.logout({ principal, meta });
await staff.bootstrap({ name, phone }); // 命令行引导：建第一位超级管理员，激活码只在返回值里出现一次
```

- `meta` 是 `{ ip, userAgent?, requestId? }`，IP 由接口层解析。
- `StaffPrincipal` 里的角色行是库里的原样（`moduleLevels`、`actions` 两个 jsonb 没规整）：缺键取默认、丢注册表外的键、算生效的权限点与数据范围归 `authz`。`groupMemberIds` 是本组成员（含本人），“本组”数据范围用。
- 错误都是 `AppError`，符号名照 a01：登录两步与激活第 1 步的失败一律 `AUTH_FAILED`；票据类 `AUTH_TICKET_INVALID`；`PASSWORD_POLICY_VIOLATED`（`details.rules`）；`TOTP_ALREADY_ENROLLED`；`MFA_CODE_INVALID`；会话失效 `SESSION_INVALID`；已有启用的超级管理员时引导 `STATE_NOT_ALLOWED`。
- 给后面的包用的函数都收事务句柄，与调用方的业务写同事务：`revokeStaffSessions(tx, { staffId, reason, now })`（禁用、重置密码、重置第二因子、改手机号）、`revokeSession`、`issueActivationCode(tx, { … })`（新增、启用、重置、重新生成）、`lockStaff(tx, staffId)`。

## 3. 要点

| 事 | 做法 |
| --- | --- |
| 口令 | scrypt，N = 16384、r = 8、p = 1；哈希串 `scrypt$N$r$p$盐$哈希`，校验时从串里解析参数并显式给 `maxmem`，旧参数的哈希照样能校验。规则：至少 10 位、同时含字母与数字、不含登录手机号、不在内置弱口令表里 |
| 登录第一步 | 账号不存在、未启用、待激活、桶锁定、密码错一律 401 `AUTH_FAILED`、同一文案；每条路恰好跑一次同参数的 scrypt。锁定中密码正确也是 401。密码正确时不写库 |
| 分桶锁定 | 带验签通过且员工相符的设备 Cookie 走 `trusted` 桶，否则 `untrusted`；各自连续失败 5 次锁 15 分钟，第二步失败累加同一个桶，成功后两桶清零。锁定中不再计数、不顺延；到期后从头计。计数、锁定、`auth_event` 写在一个独立的事务里 |
| 告警 | `untrusted` 桶被锁、同一员工当天（北京时间）满 3 次：经告警端口报 `auth.staff_untrusted_locked`（P2，维度是员工 id）；端口失败不抛给登录流程 |
| 动态口令 | HMAC-SHA1、30 秒、6 位，前后各容一步；通过的时间步记在 `totp_last_step`，只认严格大于它的。密钥用 MFA 密钥加密（AAD 是所在的列），待确认的放 `totp_pending_*`，确认时重新加密转正 |
| 恢复码 | 10 个，展示成 `XXXXX-XXXXX`，库里只存 sha256，用掉即移除 |
| 票据 | `mfa` 5 分钟；`set_password`、`enroll_totp` 15 分钟。无状态，过期之前可重复出示；重放由各用例自己挡（时间步、激活码的 `used_at`、`totp_enrolled_at`） |
| 激活码 | 8 位，只存哈希，24 小时有效，错满 5 次作废；同一员工至多一个有效的码。已绑过动态口令的账号，激活码只能用来设密码 |
| 会话 | 令牌是 32 字节随机数，库里只存 sha256。空闲 60 分钟滑动、绝对 12 小时；每请求校验未吊销、未过期、员工仍是启用；距上次续写超过 60 秒才再写。登录成功即 `stepup_at` = 现在 |
| 加锁 | 改凭据之前先 `lockStaff`（`FOR NO KEY UPDATE`，过锁序断言）：并发的两次校验逐个来，同一个动态口令、同一个恢复码、同一次确认绑定各只成功一个 |
| 引导 | 事务开头取咨询锁 `lyx:staff:bootstrap`，并发的两次排队；经 `flow.transition` 写状态历史、ops 审计（操作人是系统，任务名 `cli.staff.bootstrap`）、`staff.created` |
| Cookie 名 | `local`、`test`：`lyx_admin`、`lyx_dev`，不带 `Secure`；其余环境 `__Host-lyx_admin`、`__Host-lyx_dev`（`staffCookieNames`） |
| 常量 | 时长与阈值是代码常量（60 分钟、12 小时、10 分钟、5 次、15 分钟、90 天），不进后台参数 |

## 4. 密钥

`AUTH_KEYS_FILE`（只认文件路径，写法见仓库根 `.env.example`）里三把：`ticket`、`device` 各一把，`mfa` 带 `kid` 可轮换（加新 `kid`、改 `current`，旧的留到全部重新加密之后）。换掉 `ticket`、`device`：在途的登录要重来、设备要重新认。加载与自检在 `security` 的 `loadAuthKeys`；本地与 CI 用测试里现造的假密钥（`fakeAuthKeys`）。

## 5. 登记

- 状态机 `staff.status`：随迁列 `disabled_at`、`disabled_reason`、`disabled_by_staff_id`、`handover_to_staff_id`；守卫登记了“命令行引导”“新增”三行。启用、禁用三行的守卫随 G2-A，在那之前迁移这三行即抛 `FlowError`。
- 清理项：`staff.staff_session`、`staff.staff_activation`（过期、吊销、已用满 30 天，每日）；`staff.totp_pending`（生成满 1 小时未确认即清空，每小时）；`audit.auth_event`（早于 12 个月，每日，在 `audit`）。调度在 `ops.retention`。

## 6. 测试

```sh
pnpm --filter @liyoxi/services exec vitest run src/staff/                         # 全部
pnpm --filter @liyoxi/services exec vitest run src/staff/auth.concurrency.test.ts # 并发：独立连接加栅栏，每种 20 轮
LYX_FC_RUNS=5000 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/staff/lockout.property.test.ts
pnpm --filter @liyoxi/services exec vitest run src/audit/auth-event                # auth_event 的写、清理、告警
```

连库的两份（`auth.db.test.ts`、`auth.concurrency.test.ts`）用带种子的库：要本地的 PostgreSQL 与 `DATABASE_URL`（`CLAUDE.md` 第 9 节）。

写别的包的用例时，从 `@liyoxi/services/testing` 引：

```ts
const t = createTestStaffAuth(prisma); // 测试库上的凭据用例 + 可拨时钟 + 假密钥；t.alerts 是收到的告警
const { headers, staff } = await signInAsStaff(prisma, { roleKey: "finance", isLead: true });
// headers = { cookie: "lyx_admin=…", "x-lyx-admin": "1" }：接口测试的登录态，直接建员工与会话行
totpNow(secret, t.clock); // 按时钟算当下的动态口令
```

`signInAsStaff` 的会话从可拨时钟的缺省起点算起（接口测试支架的时钟从那里起）；时钟拨过 60 分钟不活动或 12 小时，会话照常过期，要别的时刻传 `now`。

## 7. 已知的限度

- `StaffPrincipal` 里的角色行是库里的原样；规整与 `StaffMe` 的拼装在 `me.ts`（`staffContextOf`、`buildStaffMe`），会话中间件每请求调一次前者。
- 再验证的窗口判断（权限点标了再验证且 `stepup_at` 超过 10 分钟）在 `authz`；这里只管写 `stepup_at` 与给出 `stepUpValidUntil`。10 分钟这个数只有 `authz` 的那一个常量（`STEP_UP_TTL_MS`），本模块引它并原样再导出。
- 再验证失败不计入登录失败桶，也没有自己的计数：穷举靠 `admin.login` 档的限流（W0-22b）。
- 登录失败不论账号存不存在都写一行 `auth_event`：量由按 IP 的限流封顶。
- 耗时只对齐了 scrypt 这一大头；几条失败路之后写库的语句数不同，差在毫秒以内。
- 激活码短信不发（M2）：引导命令只在终端输出，其余下发入口随 G2-A。
- 角色行里写坏的键（规整时丢弃或退回默认值的，`RoleConfig.issues`）现在没有打日志。

## 8. 接进进程、命令行与演示员工（第三个 PR）

- 进程运行时：`runtime.staffAuth` 就是 `createStaffAuth` 的结果，第一次取时才加载三份密钥并装配。密钥没配全即抛 `SecurityError`：本地与用例里不配密钥进程也起得来，只是后台登录用不了。启动自检：字段加密的两份照旧（`security.crypto`）；后台登录的一份只有 api 进程查（`security.auth_keys`），`stg`、`prod` 下没配即起不来。
- 包入口：`import { staff, authz } from "@liyoxi/services"`，按模块名取用（`staff.staffCookieNames(env)`、`staff.buildStaffMe(deps, principal, ctx)`、`staff.staffContextOf(principal)`）。
- 接口层用的两个函数：

```ts
const ctx = staff.staffContextOf(principal); // authz 的员工上下文：模块等级、生效的权限点、数据范围、再验证时刻
const me = await staff.buildStaffMe({ config: runtime.config, clock: runtime.clock }, principal, ctx); // a01 第 2.3 节 StaffMe
```

### 8.1 建第一位超级管理员

```sh
# 库要先跑完迁移与 pnpm db:seed；三份密钥文件各放一份自己生成的（写法见仓库根的环境变量样例），不入库
APP_ENV=local DATABASE_URL=… REDIS_URL=… DATA_KEYS_FILE=… BIDX_KEYS_FILE=… AUTH_KEYS_FILE=… \
  pnpm staff:bootstrap --name 张三 --phone 13800000000
# 服务器上（server 镜像里）：node apps/worker/dist/staff-bootstrap.js --name … --phone …
```

- 只在库里没有启用的超级管理员时可执行：第二次执行被拒绝。建出来是“待激活”（启用、没有口令），激活码只在终端输出这一次，24 小时内有效；到后台的激活页用手机号加激活码设密码、绑动态口令。激活码 24 小时内没用就过期，而这位管理员已经算“启用”，引导命令不会再执行：M1 还没有重新生成激活码的入口（接口随 G2-A），所以引导之后要在一天内完成激活。
- 退出码：0 建好了；1 被拒绝（已有启用的超级管理员、手机号被占用、姓名或手机号不合规、参数不对）；2 环境变量或密钥不对、连不上库。连接串、口令、密钥不打印。
- 入口 `apps/worker/src/cli/staff-bootstrap.ts`（本体在同目录的 `staff-bootstrap-command.ts`），随 worker 的构建产物。

### 8.2 演示员工

`pnpm db:seed:demo` 跑演示种子的运行器（`../demo-seed.ts`），第一步就是这里的 `seedDemoStaff`：

| 键 | 姓名 | 角色 | 主管 | 分配池 | 登录手机号 |
| --- | --- | --- | --- | --- | --- |
| `cs` | 演示客服 | 客服 | 否 | — | 19900000001 |
| `delivery_manager` | 演示交付经理 | 交付经理 | 是 | `delivery_manager`（不限城市） | 19900000002 |
| `editor` | 演示剪辑师 | 剪辑师 | 否 | `editor` | 19900000003 |
| `publisher` | 演示发布专员 | 发布专员 | 否 | `publisher` | 19900000004 |
| `content_ops` | 演示内容运营 | 内容运营 | 否 | — | 19900000005 |
| `finance_lead` | 演示财务主管 | 财务 | 是 | — | 19900000006 |
| `finance` | 演示财务 | 财务 | 否 | — | 19900000007 |

- 都建成待激活，各出一枚激活码，终端只显示一次；仓库里没有任何固定口令。演示全程也可以只用引导出来的超级管理员。
- 可以反复跑：按登录手机号认人，已有的不重建、不重发码。只进本地、测试与预发，`APP_ENV=prod` 拒绝。
- 每位员工一个事务，经 `flow.transition` 写状态历史、ops 审计（操作人是系统任务 `cli.db.seed.demo`）、`staff.created`；`staff.status`“新增（立即启用）”一行的守卫除了员工，另认这个系统任务。
- 发布专员的数据范围：角色的代码默认是“本人”，演示里要他看得到全部门店的核验队列，所以新建这位员工时把库里发布专员那一行角色的 `data_scope` 改成 `all`（代码默认配置不动；之后在后台改回去的，再跑不覆盖）。
- 别的模块的演示种子按键取人：`staff.demoStaffId(state.staff, "content_ops")`。
