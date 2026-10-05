# flow：统一状态迁移

25 张业务状态机表的状态只有一个入口 `flow.transition()`（W0-16）。依据：[03](../../../../docs/03-key-designs.md) 第 3.1 节；[06](../../../../docs/06-data-model.md) 第 3.4、5 节；[01 分组](../../../../docs/data-model/01-kernel-flow.md) 第 2.6、3.2 节；[03 分组](../../../../docs/data-model/03-staff-authz-audit.md) 第 2.10 节“迁移与审计行”；[x01](../../../../docs/api/x01-events-jobs.md) 第 2.3 节 P4、第 2.4 节 E1、E2。迁移表本身在 [`@liyoxi/shared/machines`](../../../shared/src/machines/README.md)，这里不另写一份。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `runtime.ts` | `createFlow`：装配入口，给出 `transition` |
| `transition.ts` | 迁移的八步 |
| `bindings.ts` | 状态机的登记 `MachineBinding` 与两个端口：`machinePort`（按链登记守卫、副作用、随迁列、活动流默认描述）、`workMinutesPort`（工作分钟） |
| `invariants.ts`、`register.ts` | `flow.I12` 的查询与登记；启动自检 `assertStateColumns` |
| `repo.ts` | 本模块全部的原生 SQL |
| `errors.ts` | `FlowError`：内部错误 |

## 2. 装配

```ts
const assembly = assembleServices({ entry: "api", appEnv: env.APP_ENV });
const events = createEvents({ assembly, clock: systemClock, tx });
const flow = createFlow({ assembly, clock: systemClock, events }); // api、worker 启动时各一次
await assertStateColumns(prisma); // 启动自检，由 W0-22、W0-23 接
```

`createFlow` 在构造时对照迁移表校验状态机的登记（键是不是登记的链、守卫与副作用的键是不是链上的行、随迁列的写法），写错的一次列全，抛 `FlowError`。

## 3. 迁移一次

```ts
await tx.run(async (handle) => {
  await flow.transition(handle, ctx, {
    machine: "staff",
    stateField: "status",
    id: staffId,
    event: "staff.disable", // 迁移事件码，不是出站事件名
    set: { disabled_at: now, disabled_reason: "resigned" }, // 随迁列：与状态同一条 UPDATE
    reasonCode: "resigned",
    audit: { stream: "ops", category: "staff_authz", action: "staff.account.disable", summary: "…", target: { type: "staff", id: staffId } },
    emit: { type: "staff.disabled", payload: { v: 1, staffId } },
  });
});
```

步骤固定，全在调用方的事务里（第一个参数是事务句柄，自己不开事务）：

| # | 步骤 | 要点 |
| --- | --- | --- |
| 1 | 加锁 | 对象行 `FOR UPDATE`，走 `lockRows`，过锁序断言；调用方已经锁过的再锁一遍不算违规。多行加锁仍由用例按 06 第 5 节的次序先锁好 |
| 2 | 查迁移表 | 新状态只有一个候选时不用给 `to`；同一组“当前状态、事件码、新状态”来自几行文档时要给 `ref` |
| 3 | 守卫 | 按文档行取登记的守卫。行标了守卫而没有登记实现：抛内部错误，不放行 |
| 4 | 改状态 | 一条 `UPDATE`：状态列、随迁列；表上有 `lock_version` 的加 1，有 `updated_at` 的赋业务时间 |
| 5 | 写状态历史 | 恰一行，含 from = to 的迁移。`elapsed_seconds` 取同一链上一行起算，链的第一行为空；`elapsed_work_min` 只有三张表写 |
| 6 | 副作用 | 按文档行取登记的副作用（子表、定时器、父级推导） |
| 7 | 写审计 | 恰一行，见第 5 节 |
| 8 | 发事件 | 补上 `fromState`、`toState`、`transition` 三个键后调 `events.emit`，见第 6 节 |

出错分两类：

| 出了什么 | 调用方拿到 |
| --- | --- |
| 当前状态下这个事件不能发生；守卫返回 `false` | `AppError("STATE_NOT_ALLOWED")`（409），`details` 带状态机、当前状态、事件码 |
| 守卫抛了更具体的领域码 | 原样抛出 |
| 对象不存在 | `AppError("NOT_FOUND")` |
| 代码缺陷：事件码不在这条链上、用它发 `admin.force`、几个候选没给目标、行标了守卫没登记、随迁列没登记、没给审计或事件、工作分钟端口没有实现 | `FlowError`，`reason` 说明是哪一种 |

任何一步抛错，调用方的事务回滚，状态列、历史、审计、事件四处都不留痕。

**新建**：业务行由用例按初始状态插入，再调 `transition({ …, created: true })`。这时不改业务行，只校验初始状态在迁移表里，写历史（`from_state` 为空）、审计、事件。新建的行不加锁、不进锁序（它是本事务刚插入的，别的事务看不见）；同一事务里它之后的迁移同理。只对本事务里刚插入的行写 `created`。没有“新建”行的链（如 `entity.verification_status`）第一行历史的 `from_state` 不为空。

**随迁列**：库的 CHECK 把一些列与状态绑在一起（禁用员工必有 `disabled_at`），CHECK 逐语句查，分两条 `UPDATE` 过不去。这些列经 `set` 与状态同一条语句写；列名要先写进该状态机登记的 `companions`。

## 4. 状态机怎么登记

拥有状态机的模块在自己的 `register.ts` 里实现 `machinePort`，键用 `chainKey(状态机, 状态列)`：

```ts
export const registration = defineRegistration("staff", {
  portImplementations: [
    implementKeyed(machinePort, chainKey("staff", "status"), {
      companions: ["disabled_at", "disabled_reason", "disabled_by_staff_id"],
      guards: { [rowKey("03:221", "staff.disable")]: async (tx, facts) => notLastSuperAdmin(tx, facts.subjectId) },
      effects: { [rowKey("03:221", "staff.disable")]: revokeSessions },
      activity: (facts) => ({ category: "…", action: "…", summary: "…" }), // staff 用不到，别的状态机按需给
    }),
  ],
});
```

- 守卫与副作用按**文档行**登记：键是 `rowKey(分组:行号, 事件码)`，不是事件码。守卫返回 `true` 放行，`false` 即 `STATE_NOT_ALLOWED`，要给领域码就抛 `AppError`。
- 没有登记的链照样能迁移，只是没有守卫、随迁列与默认描述；它的行若标了守卫，迁移时抛错。

## 5. 审计：每次迁移恰一行

| 用例怎么写 | 结果 |
| --- | --- |
| `audit: { stream, category, action, summary, … }` | 只写这一行，`stream` 由用例定 |
| 不写 `audit` | 按状态机登记的 `activity` 补一条 `activity` 行；没有登记默认描述即抛 `FlowError` |
| `audit: { mergedInto: { approvalRequestId } }` | 不写：随审批单联动的领域行迁移并入审批单那一行 |
| `machine` 是 `staff` 而不写 `audit` | 抛 `FlowError`：员工没有主体与门店，不补 `activity` 行 |

请求元信息（登录方式、会话）经 `meta` 传；不传即从身份上下文取请求号、IP、UA，其余写空。

## 6. 事件

`emit` 必写。`{ type, payload, aggregate?, dedupeKey? }`：事件名是契约事件目录里的出站事件名，载荷不用写三个迁移键；聚合不写即迁移的对象。从属迁移（同一事实已由主事件表达）写 `{ none: true, primary: "<主事件名>" }`。两样都没给抛 `FlowError`。

## 7. 工作分钟

`delivery_ticket`、`approval_request`、`service_ticket` 三张表的迁移要写 `elapsed_work_min`，经 `workMinutesPort` 算。真实实现由 sla 登记（W0-30a，[`sla/work-minutes.ts`](../sla/work-minutes.ts)）：在迁移的事务里读工作日历（`work_calendar_day`）与写入那一刻生效的工作时段（参数 `work.start`、`work.end`），不扣午休；日历没铺到的日期按周一至周五算。端口没有实现时（装配里把它拿掉了）这三张表迁移即抛 `FlowError`，不写空值：只增表事后改不了。

测试装配缺省带着真实实现。要固定日历（周一至周五 09:00–18:00，不读库）传 `@liyoxi/services/testing` 的 `fixedWorkMinutes`；要“没有实现”传 `workMinutes: null`。

## 8. 测试里怎么用

```ts
import { createSampleFlow, fixedWorkMinutes } from "@liyoxi/services/testing";

const sample = createSampleFlow(prisma, { workMinutes: fixedWorkMinutes }); // 测试装配 + events + flow + 可拨时钟
// 不传 workMinutes：用 sla 登记的真实实现（读测试库里的日历与参数）
await sample.tx.run((tx) => sample.flow.transition(tx, ctx, { … }));
```

样例登记覆盖 `staff`、`entity`（两条链）、`approval_request`；要别的链或别的守卫，经 `bindings` 传自己的登记。

```sh
pnpm --filter @liyoxi/services exec vitest run src/flow/
LYX_FC_RUNS=2000 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/flow/transition.property.test.ts
```

都连库：要本地的 PostgreSQL 与 `DATABASE_URL`（`CLAUDE.md` 第 9 节）。

## 9. 已知的限度

- 人工纠偏（`admin.force`、`is_forced`）不在这里：`transition()` 拒发 `admin.force`，`flow.adminTransition` 由第一个用到它的包做。系统求值 `reevaluate()`、环节记录切换、定时器随状态重设都不内置，各域放在自己的副作用里。
- “状态列只许 flow 写”没有 lint，靠 `flow.I12` 事后查：它只看有状态历史的对象，一行历史都没有的对象被人直接改了状态，查不出来；对象行已删的历史不比当前值。每条链至多报 500 条。
- 补 `activity` 行时对象类型取状态机的表名：契约的 `AUDIT_TARGET_TYPES` 里还没有的表（各域接入时往末尾加）会被 `audit.record` 拒绝。
- 状态机表有哪些列在进程里读一次系统目录后缓存：迁移加了 `lock_version` 之类的列，要重启进程才认。
