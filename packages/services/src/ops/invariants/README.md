# ops：不变量校验与清理

各模块在自己的 `register.ts` 里登记检查项与清理项；这里调度、落库。由 W0-24 交付。依据：[15 分组](../../../../../docs/data-model/15-integration-ops.md) 第 2.4、2.5、4、5.2、5.3 节；[D7](../../../../../docs/appendix/design/d7-platform.md) 第 7.6、9.6 节；x01 第 4.2 节；任务书 `docs/plan/tasks/W0-24.md`。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `select.ts` | `selectChecks`：这次运行跑哪些检查项（方式、`every`、`modules`、`codes`）。纯函数 |
| `store.ts` | 两张表的读写：运行行的插入、回写、标记中断；违规的去重与按自愈策略落库 |
| `run.ts` | 用例函数 `runInvariants`：一次运行 |
| `report.ts` | 上报端口 `invariants.report` 的实现 |
| `../retention.ts` | `runRetention`：清理的一轮 |
| `../jobs.ts`、`../register.ts` | 三个周期任务的处理器与登记；端口实现的登记 |
| `../binding.ts` | 运行时绑定 `bindOps`：处理器与端口实现要的连接、时钟、装配结果 |

三个周期任务（任务进程的补登记循环建行，扫描循环到点认领）：

| kind | 节奏 | 模式 | 完成期限 | 漏跑级别 | 出错 |
| --- | --- | --- | --- | --- | --- |
| `invariant.full` | 每日 03:30 | job | 3 小时 | P2 | 至多跑 3 次，耗尽即 `failed`，timers 报 `timer.failed` |
| `invariant.quick` | 每 10 分钟 | job | 30 分钟 | P2 | 不重试（下一期 10 分钟后就到） |
| `ops.retention` | 每小时整点 | tx | — | P3 | 单项出错不影响整轮，见第 5 节 |

## 2. 登记一个检查项

```ts
// <模块>/register.ts
export const registration = defineRegistration("billing", {
  invariants: [
    {
      code: "billing.I3", // <命名空间>.<编号>，恰好两段（库的 CHECK）
      severity: "P1", // 资金类 P1，其余 P2
      modes: ["full"], // quick：每 10 分钟；full：每日。只经端口上报的写 []
      every: "week", // 可选。hour：quick 里只跑整点那一期；week：full 里只跑周一那一期
      heal: "none", // 可选，缺省 none。见第 4 节
      run: async (tx, scope, ctx) => {
        // 返回这次查到的全部违规，没有即 []。scope.since、scope.entityIds 用来缩小范围，可以不理
        // “现在”取 invariantNow(ctx)（注入的时钟），不自己取
        return [{ subject: { type: "billing_account", id }, entityId, detail: { expected, actual } }];
      },
    },
  ],
});
```

- 对象 `subject`：有 uuid 主键的写 `{ type: 表名, id }`；复合主键、自然键或缺失的行写 `{ type: 表名, key }`；不是某张表一行的（参数键、开关键）写 `{ key }`；全局性的不写。同一检查项对同一对象未解决时只有一行，所以对象要写得稳定。
- 对象属于某个主体的带上 `entityId`（进 `detail.entityId`，按主体查询靠它）。
- 一次返回得很多的检查项自己设上限（如 `events.I8`、`flow.I12` 各 500 条）：报最老的那些就够定位。
- 检查、自愈与写违规在同一个事务里：检查项抛错，这一项整个回滚，别的项照跑，运行记 `failed`。
- 写库被约束拒掉（`module` 不是 31 个模块名之一、对象类型不是表名的写法、`entityId` 不是 uuid、编号多于两段）按这一项出错算。
- 每个检查项要有用例：人为破坏一条数据，它必须报出来（D7 第 9.6 节）。

## 3. 跑一次

```ts
import { runInvariants } from "@liyoxi/services";

const result = await runInvariants(
  { tx, assembly, clock },
  { mode: "full", trigger: "manual", modules: ["billing"], entityIds: [entityId] },
);
// { runId, status, checksRun, violationsFound, created, autoClosed, errors }
```

- `trigger`：`schedule`（周期任务）、`deploy`（发布后）、`drill`（恢复演练）、`manual`（后台或命令行）。后三种由各自的包调这个函数；`every` 只对 `schedule` 生效，别的触发跑该方式的全部检查项。
- 开始前把超过完成期限仍为 `running` 的行标成 `failed`、`error = 'abandoned'`。不设“同一方式至多一条运行中”：两次运行重叠无害。
- quick 的 `since`：定时的 quick 不给时，取上一次**成功**的定时 quick 运行的开始时间（上一次失败时有检查项没跑，起点不跟着前移）；没有即不限。存进 `invariant_run.scope`。
- `violations_found` 数的是各检查项这次返回的条数，含此前已存在、仍未解决的。
- 违规是否已不存在，不由框架推断（15 分组 第 2.5 节）：由处理人核实后填结论，或 `heal_only` 的项自愈后自动关闭。

## 4. 自愈策略

自愈由检查项自己在 `run` 里做（用同一个 `tx`），做了就在那条违规上写 `healed: { action, at }`。

| `heal` | 写了 `healed` | 没写 `healed` |
| --- | --- | --- |
| `none` | 不认：当没写 | 未解决 |
| `heal_and_alert` | 记 `auto_healed_at`，仍未解决（要有人看原因） | 未解决；上一次记的 `auto_healed_at` 清空 |
| `heal_only` | 自动关闭：`resolved_at = auto_healed_at`、`resolution = 'auto_healed'`。有未解决行就关那一行，没有就直接落一行已关闭的 | 未解决（自愈没成，计入告警） |

涉及积分与金额的不自愈。已解决的行再次发现时新建一行。

## 5. 上报端口与清理

**端口**：巡检循环、补偿扫描这类自己发现违规的地方调 `invariantsOf(assembly).report({ code, module, severity, subject?, entityId?, detail, healed? })`。

- 编号照样在自己的 `register.ts` 里登记（`modes: []`，写上 `heal`）：端口按登记的策略写；没登记的按 `none`。
- 上报的行没有运行号。去重与自愈口径同上。
- 实现用连接池直接发一条语句，不加入调用方的事务：在事务里也能报，事务回滚了违规照样留下。写失败不抛给调用方，只记日志。
- 用例里装了 `createRecordingPorts()` 时，记录用的实现顶替这一份（测试装配的口径，见 [testing/README.md](../../testing/README.md) 第 10 节）。

**清理**：删除语句归各表的属主模块，登记成清理项。

```ts
cleanups: [{ name: "identity.portal_ticket", every: "hour", run: (tx, { now, limit }) => purge(tx, now, limit) }],
```

- `every: "hour"` 每轮都跑；`every: "day"` 只在当日第一轮跑，按计划时刻判定：北京时间 0 点那一期。任务登记了补最近一期，停机跨过 0 点、1 点前恢复时这一期还会补上；再晚就等第二天。
- `run` 返回处理的行数，单批不超过 `limit`（1,000）。一批删满说明还有，框架接着调，单项单轮至多 5 批。
- 一项一个保存点：出错只回滚它自己，经告警端口报 `ops.retention_failed`（P3），别的项照常提交。死锁、锁等待超时不接，整轮由定时器重试。
- 结果在周期任务的定时器行 `result` 上：`{ daily, rows: { 项名: 行数 }, failed: { 项名: 错误摘要 } }`。

## 6. 运行时绑定

处理器与端口实现登记在 `register.ts` 里，那里拿不到连接。`createRuntime` 与 `buildWorkerServices` 建好连接后调 `bindOps({ db, tx, clock, assembly })`；一个进程一份，后绑的顶掉先绑的。没绑时处理器抛错（定时器记失败），端口只记一条错误日志。用例里自己绑、用完解绑：

```ts
const unbind = bindOps({ db: prisma, tx, clock, assembly });
// ……
unbind();
```

## 7. 现在登记了什么

| 模块 | 检查项 | 清理项 |
| --- | --- | --- |
| kernel | — | `kernel.idempotency_record`（每小时） |
| events | `events.I8` | — |
| timers | — | `timers.recurring_fired`（每日） |
| flow | `flow.I12` | — |
| sla | `sla.N8` | — |
| audit | `audit.I2`、`audit.I3` | — |
| config | `config.N8`、`N9`、`N16`、`N17`、`N19`、`N20` | — |
| staff | `staff.I8` | — |

都是 P2、只在 full 里跑、不自愈。这张表是写本文时的样子，以装配结果为准（`assembly.invariants`、`assembly.cleanups`）。

## 8. 跑用例

```sh
pnpm --filter @liyoxi/services exec vitest run src/ops/
pnpm --filter @liyoxi/worker exec vitest run test/ops-jobs.test.ts
```

除 `select.test.ts` 外都连库，走测试支架：要本地的 PostgreSQL 与 `DATABASE_URL`；任务进程的那一份另要 Redis 与 `REDIS_URL`（`CLAUDE.md` 第 9 节）。

## 9. 已知的限度

- 手工触发的接口（`admin.invariantRun.create`）、违规列表与填写处理结论、告警规则“不变量校验失败”与“周期任务漏跑”都不在这里：前两样随后台的接口包，后两样是探针，随 G2-D。
- 对象类型只由库做格式校验，没有对照表名单。
- `invariant_run`、`invariant_violation` V1.0 不删行（15 分组 第 5.3 节）；quick 每 10 分钟一行运行记录。
- 运行时绑定是进程里的一份：同一个进程里建两套运行时（只有用例会这样），用的是后绑的那一套。
