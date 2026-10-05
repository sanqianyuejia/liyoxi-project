# 内网探活：流程明细指标

| 项 | 内容 |
| --- | --- |
| 状态 | 留桩中 |
| 留桩内容 | `GET /internal/health/flow` 只出框架，没有取数。登记键 `hooks.internalHealth.flow.get` |
| 骨架里的做法 | 路由已挂（`apps/api/src/probes.ts`，标了 `frame`，不进已挂载清单）；`packages/services/src/ops/health.ts` 的 `flow()` 返回 h01 第 2.5 节 `FlowHealth` 的结构，各指标一律 `null` 并计入 `breaches`，`warnings` 为空，`status` 为 `degraded`，HTTP 503。`/health` 的 `flow` 一项不是桩：P1 的四项判定已实现（同文件的 `probeFlow`），回补时明细与它共用一段取数 |
| 登记的工作包 | W0-22 |
| 回补里程碑 | M7 |
| 回补的工作包 | 待拆包后填 |
| 依据 | 计划 第 7.2 节 W0-22 一行；h01 第 2.5、3.13、3.15 节；约定 C1 |
