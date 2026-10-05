# 内网探活：资金与计费存活指标

| 项 | 内容 |
| --- | --- |
| 状态 | 留桩中 |
| 留桩内容 | `GET /internal/health/finance` 只出框架，没有取数。登记键 `hooks.internalHealth.finance.get` |
| 骨架里的做法 | 路由已挂（`apps/api/src/probes.ts`，标了 `frame`，不进已挂载清单）；`packages/services/src/ops/health.ts` 的 `finance()` 返回 h01 第 2.5 节 `FinanceHealth` 的结构，各指标一律 `null` 并计入 `breaches`，`status` 为 `degraded`，HTTP 503 |
| 登记的工作包 | W0-22 |
| 回补里程碑 | M4 |
| 回补的工作包 | 待拆包后填 |
| 依据 | 计划 第 7.2 节 W0-22 一行；h01 第 2.5、3.14 节；约定 C1 |
