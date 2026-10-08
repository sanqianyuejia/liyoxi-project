# advance 单轮周期与发放计划读取

W2-24 的 K 优化只把 `advanceAccount` 每轮开头的周期及到点计划两个读取合为一条 fresh statement。账户锁、账本时钟、循环步数上限、`reached/onStep`、账本写入、事件及错误次序保持原样；下一轮重新读当前周期，末尾 `refreshNextDue` 仍在全部推进写入之后重新读取。

`readAdvanceStep` 是本文件私有 helper。查询返回原 `SubscriptionTerm` 的全部 32 个 scalar 字段，并用 LEFT LATERAL 读取原 `GrantSchedule` 的全部 15 个 scalar 字段。计划条件仍是该周期、`pending`、`dueAt <= clock.now`、`dueAt < term.endsAt`，只按 `monthNo ASC LIMIT 1`。没有新状态条件、行锁、数据库时钟或跨阶段缓存。日期列直接返回 `Date`；LEFT 缺行由计划主键 `null` 区分，真实计划自身的 `pointLotId/grantedAt` 仍允许为 `null`。

这是明确接受的 READ COMMITTED 可见性差异：原来两条语句各有快照，现在同一轮两读使用一个新快照。不跨循环、guard、锁、编号或 Tc/Tf/Tv 缓存。周期缺行时重新执行原 `findUniqueOrThrow`；原真实 P2025 向上传播。若这个后续语句实际读到了周期，则继续原 `findFirst` 到点计划回退链。SQL 错误不被当作缺行吞掉。

新增真实数据库用例经现有 `advance/advanceAccount` 入口验证无当前周期、LEFT 缺行、未来计划、到点等号、周期止点严格排除、非 pending 排除、月序优先、多轮重新读取、实际 Date/成本及事件、缺周期 P2025，以及故障保存点回滚后同事务重入。缺周期用例只传入不存在 UUID 的内部 AccountState 参数，不写非法 FK，不关闭库约束；止点反例在观察后完整回滚。

原 advance、推进性质、完整账本模型性质、故障、账户锁重入及订单提交回归保持原性质规模和超时。具体命令、退出码与首轮失败日志在作者交接中记录。

性能事实：K 之前 native5 是 68 RPC/笔、1360 calls、P95 1028.14ms，仍未通过 500ms 门槛。K 的源级预期是在本轮存在周期时减少 1 个读取 RPC；本改动没有运行性能采样，不能把 67 RPC 或任何延时结果写成实测。
