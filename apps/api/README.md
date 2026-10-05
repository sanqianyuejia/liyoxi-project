# apps/api：接口进程的骨架

W0-22 交付。各域的接口包往后只写“一条契约路由配一个薄壳处理器”，其余由骨架给。依据：[约定](../../docs/api/00-conventions.md) C1、C7、C17–C27、C47–C50、C75；[h01](../../docs/api/h01-hooks.md) 第 2.5、3.11–3.15 节；D7 第 2.2、2.3、3.1、9.1、9.5 节；任务书 `docs/plan/tasks/W0-22.md`。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `src/server.ts` | 进程入口：读环境变量 → 建运行时 → 建应用 → 启动自检 → 监听；收到 SIGTERM 排空后退出 |
| `src/check-env.ts` | 只校验环境变量的入口（发布时先跑它） |
| `src/app.ts` | 应用的装配：全局中间件、探活、四组、出错与 404 |
| `src/http/` | 请求编号、访问日志、Host 判断、入参校验、错误映射与成功体、幂等上下文 |
| `src/routing/` | `defineHandler`、挂载与“声明即挂载”的核对、路由级中间件的清单与规则表 |
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

## 3. 声明即挂载

建应用时逐条核对：路由元数据声明了什么，它的中间件链里就得有对应的名字（`src/routing/requirements.ts`）。漏了即抛 `MountError`，进程起不来，问题一次列全。

| 声明 | 要有的中间件 | 现状 |
| --- | --- | --- |
| `x-auth` 不是 `public`、`signed` | `auth` | 没到（鉴权链，M1） |
| `x-auth: signed` | `signature` | 没到（回调验签） |
| 设了能力点或权限点（不含 `assert-in-handler`） | `authz` | 没到（M1） |
| `x-rate-limit` | `rateLimit` | 没到（W0-22b） |
| `x-idempotent` | `idempotency` | 有 |

交付这些中间件的包：写一个 `(route, runtime) => { name, handler } | null` 的工厂，在 `src/routing/pipeline.ts` 里占一行（顺序由 W0-22b 定）。新的声明（开关、再验证等）往规则表里加行。入参校验不在表里：它由 `app.openapi()` 按契约的 `request` 结构自带。

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
node apps/api/dist/server.js --port 3000
```

- 构建：`@liyoxi/*` 内联，第三方包留给运行时从 `apps/api/node_modules` 解析，所以产物引到的第三方包都要写进本包的 `dependencies`（源码里不引；构建完会核对）。镜像标签取构建环境的 `LYX_BUILD`，没给即 `dev`。
- 已挂载清单 `dist/mounted-operations.json` 由 `test/probes.test.ts` 写出，随 `pnpm test` 生成；`node infra/ci/landed.mjs --check` 读它。
- 监听端口走命令行参数（`--port`，缺省 3000；`--host`，缺省 `0.0.0.0`），不是环境变量。

## 6. 已知的限度

- Host 判断只看域名的第一段（`api`、`admin`、`portal`），不比完整域名；完整的一层在网关。
- 回调的应答要按 Provider 的协议：处理器里自己接住错误再应答，抛出去的会变成通用的错误体。
- `fieldErrors` 的文案是 Zod 的原文（契约里没给中文文案的字段是英文）。
- 没有事件循环看门狗；排空时不等负载均衡摘节点，等待时长由发布编排定。
