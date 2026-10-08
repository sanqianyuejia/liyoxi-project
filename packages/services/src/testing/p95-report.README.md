# P95 前置与写后验收报告

`p95-fixture.ts` 是隔离测试支撑，报告来自真实服务构图与原全部 full 不变量检查。`invariants.runId` 是本次 `invariant_run` 的真实 ID；`status=succeeded` 只表示检查执行没有错误，`violations` 仍可能非零，非零保持原失败。

HTTP harness 独立保存 `seedDataset`、`measurementDataset` 与 `afterActualWrites`；尚未执行或尚未取得结果的阶段为 null。旧 `dataset` 字段只保留 seed 的兼容别名，采样前或写后失败不再覆盖它。有限 `failureStage` 表示 main try 中的 setup、seed、测量准备、测量前验收、HTTP采样、写后验收或报告评估。原嵌套 finally 仍负责报告写失败后的关闭；不能把该字段称为所有文件写入与 cleanup 异常的持久化诊断。

只有本次 `violations>0` 时，支撑才在已核对的 own 数据库只读聚合 `invariant_violation WHERE resolved_at IS NULL GROUP BY code`。`persistedUnresolved.scope=owned_database_unresolved_records` 与 `perRun=false` 明确它是当前库中持久化未解决记录的数量，可能包含此前运行或端口上报。重复发现保留原首次 `invariant_run_id/first_seen_at`，所以不能用 current run ID 筛选后声称这是本次完整分项数量；自愈关闭的行亦不在该聚合里。

查询成功只报告已登记 code 与记录数；未登记 code 仅合计 `unregisteredCodeRecords`，不输出原值。报告不读取或输出 subject、detail、手机号、令牌。查询失败为 `status=query_failed`，不给假零、不输出原异常文本，也不掩盖原不变量失败。成功且没有查询时该字段为 null，不表示历史未解决数为零。`elapsedMs` 在 runner 返回时取值，诊断查询不混入检查耗时；总 harness duration 仍包含辅助报告查询。

真实 DB 回归用一个合法测试店，将可写账户缓存临时加一，原 full 检查检出 `billing.I3`，重复检查核实首次 run 关联不变，恢复缓存后核实本轮零违规而历史记录仍在。原三店克隆和额外买家两条测试的断言、规模与 60 秒时限不变。阶段接线尚待下一次实际默认规模首轮集成验证；本文件不宣称所有阶段失败分支或 500ms 性能已经通过。
