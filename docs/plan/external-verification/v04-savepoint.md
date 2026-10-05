# V4 保存点

| 项 | 内容 |
| --- | --- |
| 编号 | V4 |
| 来源 | [计划](../../08-development-plan.md) 第 8.6 节表一；[05](../../05-risks-and-open-issues.md) 第 5 节 V4 |
| 验证什么 | Prisma 7 交互式事务中的保存点 |
| 通过标准 | 可用 |
| 依赖的业主事项 | 无 |
| 谁来做 | W0-07；结论写成 ADR |
| 最晚关闭点 | M0 退出 |
| 不通过的退路 | 履约改为入账提交后的第二个事务（W1-11a 按此实现） |
| 状态 | 已关闭（通过） |
| 结论 | 通过，不走退路。Prisma 7.9.1 交互式事务里，用事务句柄发原生 `SAVEPOINT`、`ROLLBACK TO SAVEPOINT`、`RELEASE SAVEPOINT` 可用：保存点内抛业务错或触发数据库错（唯一约束冲突），只回滚保存点，保存点外的写入照常提交，回滚后事务还能接着写，已持有的行锁还在。对方案的影响：履约留在入账事务内，W1-11a 按 03 第 1.3 节的原方案做；埋点直记（W0-17 的 `track.record`）同样用 kernel 的 `savepoint(tx, fn)`。顺带查实：事务里接住数据库错误后不再发语句，`COMMIT` 会被悄悄当成 `ROLLBACK` 而 Prisma 报成功，`tx.run` 已在提交前加一句探查 |
| 证据 | [ADR](../../adr/0046-事务内局部回滚用原生保存点-履约留在入账事务内.md)；用例 `packages/services/src/kernel/tx.savepoint.test.ts`，随 CI 的“测试”一步每次都跑，首次运行见 W0-07 的 PR（编号见 [状态文件](../status/W0-07.md)） |
| 关闭日期 | 2026-10-05（起草日；合并日不同则改成合并日） |

业主事项的状态见 [业主清单](../owner-checklist.md)。填写规则见 [README](README.md)。
