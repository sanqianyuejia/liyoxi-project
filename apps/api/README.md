# apps/api：接口进程的骨架

W0-22 交付骨架，W0-22b 交付限流与中间件的装配顺序。各域的接口包往后只写“一条契约路由配一个薄壳处理器”，其余由骨架给。依据：[约定](../../docs/api/00-conventions.md) C1、C7、C17–C27、C47–C50、C75；[h01](../../docs/api/h01-hooks.md) 第 2.5、3.11–3.15 节；D7 第 2.2、2.3、3.1、9.1、9.5 节；任务书 `docs/plan/tasks/W0-22.md`。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `src/server.ts` | 进程入口：读环境变量 → 建运行时 → 建应用 → 启动自检 → 监听；收到 SIGTERM 排空后退出 |
| `src/check-env.ts` | 只校验环境变量的入口（发布时先跑它） |
| `src/app.ts` | 应用的装配：全局中间件、探活、四组、出错与 404 |
| `src/http/` | 请求编号、访问日志、客户端 IP、Host 判断、入参校验、错误映射与成功体、限流与额度表、幂等上下文 |
| `src/routing/` | `defineHandler`、挂载与“声明即挂载”的核对、装配顺序与登记表（`pipeline.ts`）、规则表 |
| `src/routes/index.ts` | 全部处理器的清单，各域加一行 |
| `src/probes.ts` | 探活 5 条 |
| `src/testing/` | 接口测试支架 |
| `scripts/build.mjs` | 构建 |

业务逻辑不在这里：数据库、Redis、事务入口、配置、健康检查的取数都在 `@liyoxi/services` 的进程运行时（`packages/services/src/runtime.ts`）。本包不引 `@liyoxi/db`。

## 2. 写一条接口

```ts
// src/routes/<域>.ts
export const orderHandlers = [
  defineHandler(orderCreateRoute, async (c) => {
    const input = c.req.valid("json"); // 已按契约校验
    const { runtime, identity } = c.var;
    const order = await submitOrder(runtime, identity, input, { idem: idemOf(c) });
    return ok(c, order); // { code: 0, message: "ok", data }
  }),
];
// src/routes/index.ts 里加一行：...orderHandlers
```

- 路由对象取自 `@liyoxi/contract`（构造器的产出），元数据与结构都以契约为准。
- 出错就抛 `AppError("符号名")`：状态码、数值码、可否重试按契约的表出。别的错误一律 500 `INTERNAL`，不带内部信息。
- 写用例把 `idemOf(c)` 交给 `runtime.tx.run(fn, { idem })`。`required` 的路由没交即报错（防漏用）。一个上下文只进一次 `tx.run`；接口层不在进程内重试 `BUSY`，由端上重试。
- 接口层测试放本包的 `*.test.ts`，用 `useTestApi()`；用例里以字符串字面量写出 operationId（“已落地”的判定按它认）。

## 3. 声明即挂载与装配顺序

建应用时逐条核对：路由声明了什么，它的中间件链里就得有对应的槽位（`src/routing/requirements.ts`）。漏了即抛 `MountError`，进程起不来，问题一次列全。

| 声明 | 要有的中间件（槽位） | 现状 |
| --- | --- | --- |
| `x-auth` 不是 `public`、`signed` | `auth` | 没到（鉴权链，M1） |
| `x-auth: signed` | `signature` | 没到（回调验签） |
| 设了能力点或权限点（不含 `assert-in-handler`） | `authz` | 没到（M1） |
| 限流档位（每条路由都有，见 3.2） | `rateLimit` | 有 |
| `x-idempotent`；三段式（`x-three-phase` 或约定 C51 的登记） | `idempotency` | 有 |
| 后台的非 GET 路由（约定 C4） | `csrf` | 有（W1-01a） |
| 后台路由的 `x-permission` 标了再验证、没有声明 `x-step-up: skip` | `stepUp` | 有（W1-01a） |

后台这一组的 `auth`、`authz` 已随 W1-01a 到位（第 7 节）；上表这两行的“没到”指商家端、下载页与回调。

新的声明（开关、再验证等）由交付它的包往规则表里加行。入参校验不在表里：它由 `app.openapi()` 按契约的 `request` 结构自带。

### 3.1 装配顺序：只在 `src/routing/pipeline.ts` 一处

- `PIPELINE_ORDER` 是槽位的先后（约定 C7，加上 D4 第 7.4 节的后台三件）：`versionGate` → `surface` → `auth` → `signature` → `membership` → `consent` → `csrf` → `authz` → `stepUp` → `featureFlag` → `rateLimit` → `idempotency`。全局的四件（请求编号 → 访问日志 → 客户端 IP → Host 判断）在 `app.ts`，排在它们之前；入参校验排在它们之后。
- `ROUTE_MIDDLEWARES` 是登记表，一件一行：槽位、适用的组（不写即四组都给）、工厂。链的先后只看槽位，不看登记在第几行。
- 加一件中间件：在 `src/http/` 下写自己的文件，导出一个 `RouteMiddlewareFactory`（`(route, runtime) => 处理函数 | null`，这条路由用不着就返回 `null`，配置不对就抛错），在 `ROUTE_MIDDLEWARES` 末尾加一行。鉴权按组各一条链：商家、后台、下载页各登记一行并写 `groups`。不改 `PIPELINE_ORDER`，不在别处 `app.use()`（`test/pipeline.test.ts` 会扫）。
- 同一个槽位同一组登记了两件、槽位不在顺序表里：建应用即失败。要加一种新的中间件，先在 `PIPELINE_ORDER` 里给它排位。
- 鉴权链除了 `c.var.identity`，把会话行的 id 放进 `c.var.sessionId`（按会话限流的档位用它）；客户端 IP 取 `c.var.clientIp`，不自己读转发头。

### 3.2 限流

- 档位按 operationId 登记在契约里（`packages/contract/src/routes/rate-limits.ts`，对应约定 C68 的表）。一条路由的生效档位 = 名下登记了它的专用档位 + 它自己写的 `x-rate-limit` + 所在组的缺省档位（`m.global`、`admin.global`、`portal.global`；回调是 `hooks.ip`），同时生效。根路径探活不限流。
- 额度在 `src/http/rate-limit-quotas.ts`（初始值照约定 C68）：每个档位几条规则，各写按什么数（来源 IP、用户、会话、路径参数）、一个窗口几次。档位没有额度，api 起不来。
- 超限回 429 `RATE_LIMITED`，带 `Retry-After`（超限窗口的剩余秒数），并记一条 `evt: ratelimit.hit` 的日志（带档位）。限流排在幂等上下文之前。
- 计数在 `runtime.rateLimiter`（`packages/services/src/rate-limit.ts`）：Redis 上的固定窗口。Redis 命令报错或 200 毫秒没回：改用进程内计数、限额减半，随后 5 秒不再试 Redis（日志 `ratelimit.degraded`、`ratelimit.restored`）。
- 加一条要单独限流的接口：把 operationId 写进契约里对应的档位；新档位另在额度表里加一项，同 PR 改约定 C68 的表。
- 用例里：每个 `testApi.start()` 出来的应用有自己的来源 IP，互不挤占额度；`rateLimitQuotas` 换小额度，`request(path, { peer })` 换来源，`redisUrl` 配故障注入的转发口（`createRedisOutage`）验降级。

## 4. 探活

| 路径 | 语义 |
| --- | --- |
| `/healthz` | 进程能应答即 200 |
| `/readyz` | 启动完成且未在排空才 200，否则 503；不看数据库与 Redis |
| `/health` | 聚合状态；`degraded` 回 503 |
| `/internal/health/finance`、`/internal/health/flow` | 只有框架：各指标为 `null`，回 503。留桩见 `docs/plan/stubs/` |

## 5. 命令

```sh
pnpm exec vitest run --project api      # 本包的用例（要本地的 PostgreSQL、Redis 与连接参数，CLAUDE.md 第 9 节）
pnpm --filter @liyoxi/api build         # 出 dist/server.js、dist/check-env.js
node apps/api/dist/server.js --port 3000 --trusted-proxy-hops 1 --trusted-proxy-cidrs 10.0.0.0/8
```

- 构建：`@liyoxi/*` 内联，第三方包留给运行时从 `apps/api/node_modules` 解析，所以产物引到的第三方包都要写进本包的 `dependencies`（源码里不引；构建完会核对）。镜像标签取构建环境的 `LYX_BUILD`，没给即 `dev`。
- 已挂载清单 `dist/mounted-operations.json` 由 `test/probes.test.ts` 写出，随 `pnpm test` 生成；`node infra/ci/landed.mjs --check` 读它。文件不入库，没有它时探活 3 条按待落地算，所以待落地基线本包没有降（留在 613；状态文件偏差 13）。
- 监听端口走命令行参数（`--port`，缺省 3000；`--host`，缺省 `0.0.0.0`），不是环境变量。
- 客户端 IP 按可信代理的跳数取（D4 第 9.5 节）：对端在可信网段内才看 `X-Forwarded-For`，从右数第 N 个。`--trusted-proxy-hops` 缺省 1，`--trusted-proxy-cidrs`（逗号分隔）缺省回环与私有网段；负载均衡的回源网段在预发实测后照实填。

## 6. 已知的限度

- Host 判断只看域名的第一段（`api`、`admin`、`portal`），不比完整域名；完整的一层在网关。
- 回调的应答要按 Provider 的协议：处理器里自己接住错误再应答，抛出去的会变成通用的错误体。
- `fieldErrors` 的文案是 Zod 的原文（契约里没给中文文案的字段是英文）。
- 限流的额度是代码里的初始值（`rate-limit-quotas.ts`），还没接成按环境可调的配置；手机号登录的“每 openid”一条、短信的号码限频、账号锁定不在中间件里，由各自的域按数据库计数。
- 没有事件循环看门狗；排空时不等负载均衡摘节点，等待时长由发布编排定。

## 7. 后台接口（W1-01a）

后台的鉴权链登记在 `ROUTE_MIDDLEWARES`，文件在 `src/http/admin/`，先后照 D4 第 7.4 节：

| 槽位 | 文件 | 做什么 | 不过时 |
| --- | --- | --- | --- |
| `auth` | `session.ts` | 校验会话 Cookie（未吊销、未过期、员工仍是启用），把 `identity`、`sessionId`、`staff` 放进上下文；`x-auth: public` 的不挂 | 401 `AUTH_REQUIRED`、`SESSION_INVALID` |
| `csrf` | `csrf.ts` | 非 GET：`X-LYX-Admin: 1`，且 `Origin` 的主机名等于请求的 `Host` 的主机名、这个 Host 属于后台（端口不比：网关转来的 Host 不带端口）。登录前的公开接口也查 | 403 `ORIGIN_REJECTED` |
| `authz` | `authz.ts` | 模块等级 × 权限点（“仅主管”已算在内） | 403 `PERMISSION_DENIED` |
| `stepUp` | `authz.ts` | 权限点在注册表里标了再验证、会话的再验证超过 10 分钟；`x-step-up: skip` 的不挂 | 403 `STEP_UP_REQUIRED` |

四件都排在限流与幂等上下文之前：再验证之后拿原幂等键重放即可。

### 7.1 登记一条后台接口：`defineAdminHandler`

```ts
// src/routes/admin/<域>.ts；在 src/routes/index.ts 里加一行展开
export const refundHandlers = [
  defineAdminHandler(adminRefundExecute, { module: "finance", need: "view" }, async (c, staff) => {
    const body = c.req.valid("json");
    const refund = await executeRefund(c.var.runtime, c.var.identity, staff.scope, body, { idem: idemOf(c) });
    return ok(c, refund);
  }),
];
```

签名（合并后不轻易改，全部后台接口包都用它）：

```ts
defineAdminHandler(route, requirement: { module: AdminModuleKey; need: "view" | "edit" } | null, handler: (c, staff: AdminStaff) => Response)
```

- 要会话的后台路由（`x-auth: staff`）一律用它登记；没用它登记的，建应用即失败。公开的后台路由仍用 `defineHandler`。
- 第二个参数是模块等级的要求：`view` 要求等级不是 `n`，`edit` 要求 `e` 或 `o`；没有模块要求写 `null`。契约的路由元数据里没有“模块等级”这个键，所以在这里声明；权限点只取路由的 `x-permission`，这里不重复写。带权限点的路由通常只要求 `view`。
- 处理器不自己写判定。第二个入参 `staff`：

| 字段 | 用途 |
| --- | --- |
| `principal`、`ctx` | 会话校验的结果（员工、角色行、分组、当前会话）与判权用的上下文（`ctx.permissions`、`ctx.moduleLevels`） |
| `scope` | 数据范围，交给带范围的仓储函数（`authz.storeScope(scope)` 等）：范围之外与不存在都是 404 |
| `taskScope` | 声明的模块等级是“本人任务”（`o`）时只含本人、不带待分配池，否则同 `scope`。任务类资源的写操作（与约定 C58 的“本人任务”列表）一律用它取资源：`o` 级只能动分派给自己的任务，这一条只在这里定，处理器与仓储不另判 |
| `assertPermission(key)` | `x-permission: assert-in-handler` 的路由取到对象后调：没有这个权限点 403 `PERMISSION_DENIED`，标了再验证且已过期 403 `STEP_UP_REQUIRED` |

- 二次确认回显在事务里、锁住对象之后调 `authz.assertConfirm(body.confirm, { … })`，比哪几个字段由接口自己列。

### 7.2 接口测试的登录态与权限矩阵

```ts
import { signInAsStaff } from "@liyoxi/services/testing";

const testApi = useTestApi();
const { request } = await testApi.start();
const finance = await signInAsStaff(await testApi.db.prisma(), { roleKey: "finance", isLead: true });
const response = await request("/api/v1/admin/…", { method: "POST", json: {…}, headers: { ...finance.headers, "Idempotency-Key": key } });
```

- `signInAsStaff(db, { roleKey?, isLead?, now?, staffGroupId?, staff?, origin? })`：直接建员工与会话行（库里没有那个角色就照种子补上），返回 `{ staff, sessionId, sessionToken, headers }`；`headers` 是会话 Cookie、`X-LYX-Admin`、`Origin`，原样带上即可。会话从可拨时钟的缺省起点算起，时钟拨过 60 分钟不活动或 12 小时照常过期，要别的时刻传 `now`。
- 测试支架的运行时带现造的假密钥（`fakeKeyEnv`）：`runtime.staffAuth` 装得起来；字段加密那两份与测试数据工厂的密钥环同一组字节。要真走一遍登录（引导、激活、绑定）的照 `test/admin-auth.test.ts`，库要先播种（`runSeed`）。
- 权限矩阵回放 `test/admin-matrix.test.ts`：生产清单里全部要会话的后台路由 × 8 个角色 × 主管与否，期望由上面两处声明与角色的代码默认配置算出，先对黄金文件 `golden/admin-permission-matrix.txt`（一条路由一行），再逐格请求比“是不是 403 `PERMISSION_DENIED`”（回放时处理器换成空壳，不执行业务）。加了后台接口后重写黄金文件，只应多出自己路由的行，不手改：

```sh
LYX_UPDATE_GOLDEN=1 pnpm exec vitest run --project api test/admin-matrix.test.ts
```

### 7.3 已知的限度

- 密钥没配（本地默认）：进程起得来，`/api/v1/admin/auth/*` 与要会话的后台接口回 500；启动自检在 `local`、`test` 下只记一条告警，`stg`、`prod` 下不过。
- 后台来源 IP 白名单（槽位 `surface`、`IP_NOT_ALLOWED`）默认不启用，没有做；`X-Admin-Build` 响应头（约定 C18）没有加。
- 再验证失败不单独计数，穷举靠 `admin.login` 档按会话的限流。
