# 计费账户端口用桩

| 项 | 内容 |
| --- | --- |
| 状态 | 已回补 |
| 留桩内容 | 建主体时同事务建计费账户行的端口（tenant 定义、billing 实现）还没有真实现；建出来的主体没有计费账户行 |
| 骨架里的做法 | `packages/services/src/tenant/billing-account-stub.ts` 什么都不建，由 tenant 的 `register.ts` 登记到 `billingAccountPort`（端口没有默认实现，不登记桩装配就失败） |
| 登记的工作包 | W1-03 |
| 回补里程碑 | M1 |
| 回补的工作包 | W1-11a（第一个 PR，账本侧）：实现在 `packages/services/src/billing/ports.ts`，由 billing 的 `register.ts` 登记；桩文件与 tenant 的 `register.ts` 里登记它的那一行已删 |
| 依据 | 计划 第 7.3 节留桩清单“M1 内的端口桩”一行；任务书 W1-03 第 7 节、第 10 节第 4 项；02 分组 第 2.9 节 |
