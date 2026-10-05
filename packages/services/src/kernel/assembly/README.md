# kernel/assembly：服务装配

各模块在自己的 `register.ts` 里登记六类东西，组合根自动收成一份，api 与 worker 启动时各装配一次（W0-07b）。依据：[开发计划](../../../../../docs/08-development-plan.md) 第 5.1、9.3 节；[01](../../../../../docs/01-architecture.md) 第 5 节调用规则 5；D7 第 2.3 节规则 3、7。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `types.ts` | 六类登记项的接口、端口、`defineRegistration`、装配结果 `Assembly`。全仓只在这里定义 |
| `assemble.ts` | `assemble`：按环境过滤，查重名与缺实现，问题一次报全（`AssemblyError`） |
| `collect.ts` | `collectRegistrations`：从模块入口里取 `registration`；`auditModuleEntries`：入口清单与模块目录对账 |
| `../../assembly.ts` | 组合根：全部模块的入口清单、`assembleServices`。经 `@liyoxi/services` 的入口给 api 与 worker |
| `../../testing/assembly.ts` | 测试装配 `assembleForTest`：真实登记之外追加样例登记 |
| `__fixtures__/` | 两个样例模块，各带一个 `register.ts`，只在用例里装配 |

## 2. 模块怎么登记

```ts
// packages/services/src/<模块>/register.ts
import { defineRegistration } from "../kernel/index.js";

export const registration = defineRegistration("<模块>", {
  subscribers: [{ name: "order.onQualificationDecided", events: ["store.qualification.approved"], handle }],
  timerHandlers: [{ kind: "order.start", handle }],
  recurringJobs: [{ kind: "stg.pay.autorefund", envs: ["stg"], run }],
  invariants: [{ code: "events.I8", severity: "P2", modes: ["full"], run }],
  cleanups: [{ name: "kernel.idempotency_record", every: "hour", run }],
});

// packages/services/src/<模块>/index.ts 里加一行
export { registration } from "./register.js";
```

- 只动自己的目录：组合根把各模块的 `index.ts` 整体引入，入口里有 `registration` 就收，不用改任何共用的清单。
- 建了 `register.ts` 却忘了在入口再导出，`src/assembly.test.ts` 会红。模块名要与目录名相同。
- `providers` 不参加收集：依赖规则只许 kernel 引它的入口，它也没有要登记的东西。
- 六类的字段见 `types.ts`。要给某一类加字段（节奏、模式、租期、关键类……）：在 `types.ts` 里只增可选字段，不改已有字段。
- 名字在不在契约的登记里、关键类与契约一不一致，这里不查：由 events、timers 在装配后对照。这里只查写法。

## 3. 端口

下层定义接口，上层注册实现；两边都写在各自的登记里。

```ts
// 下层（定义方）
export const alertsPort = definePort<Alerts>("alerts.raise", { fallback: noopAlerts }); // 有默认实现
export const executorPort = defineKeyedPort<Executor>("approval.executor"); // 按键多实现
export const registration = defineRegistration("kernel", { ports: [alertsPort, executorPort] });

// 上层（实现方）
export const registration = defineRegistration("ops", {
  portImplementations: [implement(alertsPort, realAlerts)],
});
export const registration = defineRegistration("billing", {
  portImplementations: [implementKeyed(executorPort, "refund", refundExecutor)],
});

// 用的地方
assembly.port(alertsPort).raise(…); // 没人实现时是默认实现
assembly.portEntries(executorPort).get("refund");
```

端口认的是 `definePort` 给出的那个对象：实现方要引定义方导出的端口，不要另造一个同名的。

## 4. 装配

```ts
import { assembleServices } from "@liyoxi/services";

const assembly = assembleServices({ entry: "worker", appEnv: env.APP_ENV }); // 启动时一次
```

- 两个入口收到的内容相同，`entry` 只记在结果上。各类按名字排序。
- `envs`：不写即全部环境；写了的只在那些环境里进装配结果，别的环境里等于不存在。环境由调用方传入，这里不读 `process.env`。
- 启动时报错（`AssemblyError`，`issues` 里是全部问题）：

| 查什么 | 口径 |
| --- | --- |
| 重名 | 同一环境里：订阅者名、定时器 kind、周期任务 kind（两者共用 `timer.kind`，互相也不能同名）、不变量编号、清理项名、单实现端口的实现、按键端口的键、模块名、端口的声明。环境不相交的两个同名项不算 |
| 缺实现 | 登记项没给处理函数；声明了、没有默认实现的端口在某个环境里没有模块实现；实现指向没有模块声明过的端口；`modes` 非空的不变量没有 `run` |
| 写法 | 订阅者名、事件名、kind 按契约 `NAME_FORMATS`；`envs` 不得为空、取值在四个环境之内 |

- 重名与缺实现对四个环境各查一遍：只在生产才会出的问题，本地与 CI 装配时就报。

## 5. 组合根的位置

`packages/services/src/assembly.ts`。它是包级文件，不属于任何一层，只引各模块的 `index.ts`。api 与 worker 只经 `@liyoxi/services` 的入口调 `assembleServices`；数据库客户端由 kernel 在装配基础设施时调 `createPrismaClient`（W0-22、W0-23 接），应用层不必引 `@liyoxi/db`。别处不得 `new PrismaClient`（lint 拦）。

## 6. 跑用例

```sh
pnpm --filter @liyoxi/services exec vitest run src/kernel/assembly/ src/assembly.test.ts
```

都不连库。

## 7. 已知的限度

- 处理函数拿到的对象（`DeliveredEvent`、`FiredTimer`、各个 `Context`）只写了当前确定的字段；调度与执行在 W0-15、W0-17、W0-23、W0-24，它们按需要只增字段。
- 端口实现的类型由 `implement`、`implementKeyed` 在登记时对上；手写 `{ port, impl }` 对象绕得过类型检查，不要手写。
- 模块目录增减时要改组合根的清单（同时要改 `infra/ci/layers.json`，走单独的 `gate-change` PR）；漏改时 `src/assembly.test.ts` 会红。
