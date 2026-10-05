# x01 条目归属表

本文件是生成物：由 `pnpm registry:generate` 从 `packages/contract/src/registry/` 的登记数据生成，不手改。改归属就改登记数据并重新生成，同一个 PR 在 [changes/](changes/README.md) 记一条（[开发计划](../08-development-plan.md) 第 5.7 节“x01 归属”行）。`pnpm registry:check` 核对它与登记数据无差异，并拿登记数据与 x01 对账。

“x01”指[事件目录与任务进程](../api/x01-events-jobs.md)。一项一行：类别、名称、所属模块、里程碑。“里程碑”是这个条目应有处理器与测试的那个里程碑，各里程碑退出时据此核对（计划 第 8.4 节；之后以本表为准，计划里的那张表不再手改）。循环、队列、命令行在 x01 里写的是叫法，括号里是代码用的标识符。出站事件不单列里程碑，随发出它的接口或任务落地，数量见第 3 节。

## 1. 各里程碑的条目数

| 里程碑 | 订阅者 | 定时器 | 周期任务 | 循环 | 队列 | 回调 | 命令行 | 合计 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M0 | 0 | 0 | 3 | 4 | 2 | 0 | 0 | 9 |
| M1 | 2 | 2 | 1 | 2 | 1 | 0 | 1 | 9 |
| M2 | 9 | 3 | 10 | 3 | 1 | 1 | 2 | 29 |
| M3 | 6 | 3 | 3 | 1 | 1 | 2 | 0 | 16 |
| M4 | 6 | 4 | 5 | 0 | 0 | 2 | 1 | 18 |
| M5 | 5 | 4 | 0 | 1 | 1 | 0 | 0 | 11 |
| M6 | 2 | 5 | 1 | 0 | 1 | 0 | 0 | 9 |
| M7 | 4 | 3 | 2 | 0 | 1 | 2 | 0 | 12 |
| 合计 | 34 | 24 | 25 | 11 | 8 | 7 | 4 | 113 |

定时器按“kind × 主体”计行：同一个 kind 有几种主体就有几行（`sla.breach` 有 7 行）。

## 2. 条目

| 类别 | 名称 | 所属模块 | 里程碑 |
| --- | --- | --- | --- |
| 周期任务 | `invariant.full` | ops | M0 |
| 周期任务 | `invariant.quick` | ops | M0 |
| 周期任务 | `ops.retention` | ops | M0 |
| 循环 | ensureRecurring（`ensure_recurring`） | timers | M0 |
| 循环 | 出站中继（`outbox_relay`） | events | M0 |
| 循环 | 出站派发（`outbox_dispatch`） | events | M0 |
| 循环 | 定时器扫描（`timer_scan`） | timers | M0 |
| 队列 | 出站投递（`outbox_delivery`） | events | M0 |
| 队列 | 定时器执行（`timer_run`） | timers | M0 |
| 订阅者 | `order.onQualificationDecided` | order | M1 |
| 订阅者 | `order.onSubscriptionActivated` | order | M1 |
| 定时器 | `order.start`（主体 `drama_order`） | order | M1 |
| 定时器 | `po.transfer_ttl`（主体 `billing_order`） | billing | M1 |
| 周期任务 | `order.pending_start_sweep` | order | M1 |
| 循环 | flow.reevaluate_sweep（`flow_reevaluate_sweep`） | delivery | M1 |
| 循环 | 账务推进 advance（`billing_advance`） | billing | M1 |
| 队列 | promote（`promote`） | media | M1 |
| 命令行 | `staff:bootstrap`（`staff_bootstrap`） | staff | M1 |
| 订阅者 | `approval.onCalendarImported` | approval | M2 |
| 订阅者 | `identity.onWechatBound` | identity | M2 |
| 订阅者 | `notify.onEvent` | notify | M2 |
| 订阅者 | `notify.onMerchantUserDeleted` | notify | M2 |
| 订阅者 | `profile.onQualificationApproved` | profile | M2 |
| 订阅者 | `profile.onTenantLifecycle` | profile | M2 |
| 订阅者 | `security.onWebhookReceived` | security | M2 |
| 订阅者 | `staff.onCalendarImported` | staff | M2 |
| 订阅者 | `tenant.onEntitlementChanged` | tenant | M2 |
| 定时器 | `invitation.expire`（主体 `invitation`） | tenant | M2 |
| 定时器 | `sla.breach`（主体 `approval_request`） | approval | M2 |
| 定时器 | `sla.breach`（主体 `assignment_history`） | staff | M2 |
| 周期任务 | `analytics.dedup_purge` | analytics | M2 |
| 周期任务 | `analytics.partitions` | analytics | M2 |
| 周期任务 | `backup.pgdump` | ops | M2 |
| 周期任务 | `calendar.coverage_check` | sla | M2 |
| 周期任务 | `docs.sweep` | docs | M2 |
| 周期任务 | `evidence.consent_digest` | docs | M2 |
| 周期任务 | `notify.remind_scan` | notify | M2 |
| 周期任务 | `notify.sms_balance` | notify | M2 |
| 周期任务 | `notify.sms_keepalive` | notify | M2 |
| 周期任务 | `ops.cert_check` | ops | M2 |
| 循环 | notify.scan（`notify_scan`） | notify | M2 |
| 循环 | webhook.reprocess（`webhook_reprocess`） | security | M2 |
| 循环 | 探针 probe()（`probe`） | ops | M2 |
| 队列 | notify（并发 4，按通道限速）（`notify`） | notify | M2 |
| 回调 | `hooks.wechat.message.receive` | security | M2 |
| 命令行 | `cli.alerts.ack / 关闭告警、重置死信回调`（`alerts_ack`） | ops | M2 |
| 命令行 | `ops analytics:repartition <YYYY-MM>`（`analytics_repartition`） | analytics | M2 |
| 订阅者 | `billing.onTierChanged` | billing | M3 |
| 订阅者 | `content.onMastersChanged` | content | M3 |
| 订阅者 | `content.onTrailerReady` | content | M3 |
| 订阅者 | `delivery.onProductionChecked` | delivery | M3 |
| 订阅者 | `media.onCalendarImported` | media | M3 |
| 订阅者 | `profile.onFileModerated` | profile | M3 |
| 定时器 | `content.license_end`（主体 `drama`） | content | M3 |
| 定时器 | `pricing.drama_price_effective`（主体 `drama_price_revision`） | billing | M3 |
| 定时器 | `sla.breach`（主体 `store_asset`） | media | M3 |
| 周期任务 | `content.archive_sweep` | content | M3 |
| 周期任务 | `content.stat_refresh` | content | M3 |
| 周期任务 | `media.sweep` | media | M3 |
| 循环 | media_job 执行循环（`media_job_run`） | media | M3 |
| 队列 | 媒体任务（`media_job`） | media | M3 |
| 回调 | `hooks.asr.mediaJob.wake` | media | M3 |
| 回调 | `hooks.ci.mediaJob.wake` | media | M3 |
| 订阅者 | `billing.applyPaymentFallback` | billing | M4 |
| 订阅者 | `billing.onCalendarImported` | billing | M4 |
| 订阅者 | `billing.onMailResult` | billing | M4 |
| 订阅者 | `billing.onOcrCompleted` | billing | M4 |
| 订阅者 | `billing.submitRefundTxn` | billing | M4 |
| 订阅者 | `billing.uploadShippingInfo` | billing | M4 |
| 定时器 | `po.expire`（主体 `billing_order`） | billing | M4 |
| 定时器 | `rf.poll`（主体 `refund_txn`） | billing | M4 |
| 定时器 | `sla.breach`（主体 `invoice_request`） | billing | M4 |
| 定时器 | `sla.breach`（主体 `transfer_proof`） | billing | M4 |
| 周期任务 | `bill.download` | billing | M4 |
| 周期任务 | `billing.sweep.daily` | billing | M4 |
| 周期任务 | `receipt.daily_digest` | billing | M4 |
| 周期任务 | `stg.pay.autorefund` | ops | M4 |
| 周期任务 | `tx.unapplied_scan` | billing | M4 |
| 回调 | `hooks.wechatpay.refund.notify` | billing | M4 |
| 回调 | `hooks.wechatpay.transaction.notify` | billing | M4 |
| 命令行 | `refund:abandon-txn`（`refund_abandon_txn`） | billing | M4 |
| 订阅者 | `delivery.onCalendarImported` | delivery | M5 |
| 订阅者 | `docs.onLicenseFacts` | docs | M5 |
| 订阅者 | `docs.onRevisionQueued` | docs | M5 |
| 订阅者 | `order.onCalendarImported` | order | M5 |
| 订阅者 | `order.onLicenseShortened` | order | M5 |
| 定时器 | `ad.returned_stale`（主体 `ad`） | ad | M5 |
| 定时器 | `order.rejected_stale`（主体 `drama_order`） | order | M5 |
| 定时器 | `sla.breach`（主体 `ad`） | ad | M5 |
| 定时器 | `sla.breach`（主体 `delivery_ticket_stage`） | delivery | M5 |
| 循环 | flow.reconcile_sweep（`flow_reconcile_sweep`） | order | M5 |
| 队列 | docs（并发 2）（`docs`） | docs | M5 |
| 订阅者 | `publish.onCalendarImported` | publish | M6 |
| 订阅者 | `publish.onLicenseExtended` | publish | M6 |
| 定时器 | `patrol.followup`（主体 `patrol_task`） | publish | M6 |
| 定时器 | `takedown.create`（主体 `order_item`） | publish | M6 |
| 定时器 | `takedown.overdue`（主体 `takedown_task`） | publish | M6 |
| 定时器 | `usage.end`（主体 `order_item`） | delivery | M6 |
| 定时器 | `usage.resync`（主体 `order_item`） | order | M6 |
| 周期任务 | `patrol.weekly_generate` | publish | M6 |
| 队列 | zip_package（`zip_package`） | media | M6 |
| 订阅者 | `analytics.fromOutbox` | analytics | M7 |
| 订阅者 | `reports.onMonthClosed` | reports | M7 |
| 订阅者 | `support.onBizEvent` | support | M7 |
| 订阅者 | `support.onCalendarImported` | support | M7 |
| 定时器 | `service.auto_resolve`（主体 `service_ticket`） | support | M7 |
| 定时器 | `service.first_response_due`（主体 `service_ticket`） | support | M7 |
| 定时器 | `service.solution_due`（主体 `service_ticket`） | support | M7 |
| 周期任务 | `export.sweep` | exports | M7 |
| 周期任务 | `reports.finalize` | reports | M7 |
| 队列 | export（并发 1）（`export`） | exports | M7 |
| 回调 | `hooks.sms.statusReport.receive` | notify | M7 |
| 回调 | `hooks.wecom.event.receive` | security | M7 |

## 3. 出站事件的数量

事件名、聚合与状态登记在同一份数据里（各模块文件的 `events`），这里只给数量。“不发”的名字占住、不挪作他用；“预留”的等对应的表与任务补上后才发。

| 发出模块 | V1.0 发出 | 不发 | 预留 |
| --- | --- | --- | --- |
| ad | 10 | 1 | 0 |
| approval | 6 | 0 | 0 |
| billing | 54 | 2 | 1 |
| config | 2 | 0 | 0 |
| content | 8 | 0 | 0 |
| delivery | 24 | 1 | 0 |
| docs | 3 | 0 | 0 |
| exports | 2 | 0 | 0 |
| identity | 6 | 0 | 0 |
| media | 19 | 0 | 0 |
| notify | 3 | 0 | 0 |
| order | 17 | 0 | 0 |
| profile | 9 | 0 | 0 |
| publish | 25 | 3 | 0 |
| security | 1 | 0 | 0 |
| sla | 1 | 0 | 0 |
| staff | 5 | 0 | 0 |
| support | 10 | 0 | 0 |
| tenant | 15 | 0 | 0 |
| 合计 | 220 | 7 | 1 |
