# 事件目录与任务进程

| 项 | 内容 |
| --- | --- |
| 范围 | 出站事件目录（事件名、聚合、触发、载荷、订阅者）；定时器、周期任务、进程内循环、队列任务、回调处理与命令行；数据模型状态机表里非接口触发的迁移由谁负责；事件的版本与兼容。不定义 HTTP 接口，各接口文档的“触发的状态迁移”一栏引用本文的事件名与定时器 kind（C81、C84） |
| 数量 | 出站事件 220 个（V1.0 发出），另有不发 7 个、预留 1 个；订阅者 34 个；定时器 18 个 kind（24 种 kind × 主体组合）；周期任务 25 个；进程内循环 11 个；非 HTTP 迁移归属 195 行 |
| 依据 | 裁决 A40、A95、A96、A102、A136、A137、A141、A143、A144；约定 C51、C79、C84；数据模型 01 分组 2.3–2.5、3.3、3.4，02–15 分组的状态机表与第 5 节；草案 d1:1720、d2:1172-1188、d3:905-918、2700-2735、2905-2981、d4:450-460、1940-1979、d5:2139、d6:140-154、226-275、1825-1858、d7:1570-1595、d8:540-569、d9:695-726 |
| 状态 | 第三轮修订（2026-10-03）；数据模型行号按现行文件 |

## 1. 概览

本文把散在 15 份数据模型分组文档与 9 份设计草案里的“系统自己动”的部分收拢成一份清单，供接口文档、契约（`packages/contract` 的事件目录、定时器与订阅者登记表）与 worker 实现共用：

| 部分 | 内容 | 节 |
| --- | --- | --- |
| 公共约定 | 事件命名、前缀登记、信封与载荷、发事件的规则、订阅者登记 | 2 |
| 事件目录 | 按 15 个分组列出每个出站事件；不发与预留的事件；草案名对照 | 3 |
| 定时器与任务 | 定时器（有主体）、周期任务（无主体）、进程内循环、队列任务、回调、命令行；草案提到但不单独登记的任务 | 4 |
| 非 HTTP 迁移归属 | 状态机表里由定时器、订阅者、周期任务、回调、任务进程、命令行触发（或随它们的事务联动）的每一行 → 负责方 | 5 |
| 版本与兼容 | 事件与定时器的演进规则（C84、C79 的 E1） | 6 |
| 自查 | 覆盖率、路线图对照、其他接口文档对照 | 7 |

运行机制（01 分组 2.3–2.5；d3:2700；d7:1590）：业务事务经 `events.emit()` 或 `flow.transition()` 写 `outbox_event`；进程内的出站中继为每个订阅者展开一行 `outbox_delivery`，派发循环把它交给队列（Redis 不可用时关键类在进程内直接执行），订阅者在自己的事务里消费，失败按 5 秒到 1 小时退避，10 次进死信，在后台“流程运维”重投。定时器由业务事务经 `timers.arm` 登记，扫描循环认领后由 `runTimer()` 调该 kind 的处理器；周期任务也是定时器行，由 `ensureRecurring` 每期补登记。回调按 Provider 内联处理，或落收件箱后发 `webhook.received` 立即处理。

## 2. 公共约定

### 2.1 事件命名规则

| 编号 | 规则 |
| --- | --- |
| N1 | 形如 `<前缀>.<事实>` 或 `<前缀>.<子对象>.<事实>`：小写蛇形段、点分 2–3 段，全长不超过 64 个字符（`ck_outbox_event_event_type` 只校验“小写点分、至少两段”） |
| N2 | `<事实>` 写已经发生的事：过去分词（`confirmed`）、“名词_过去分词”（`proof_submitted`、`zip_ready`），或进入的状态（`abnormal`，数据模型已用）。不用祈使动词（`submit`、`done` 这类不用）。到点提醒类事实用 `_due`，V1.0 都不发（3.16） |
| N3 | 前缀是事件所属的业务对象，在 2.2 登记；一个前缀只指一种业务对象（可以因触发来源不同而落在两张表上，如 `pricing.drama_price_changed`），同一个事件名只由一个模块发出 |
| N4 | 状态迁移的事件码（`status_transition.event`，如 `plan.push`、`qualification.approve`、`launch.changed`）是另一套名字，不当出站事件名用。两者恰好同名时（`plan.confirmed`、`sample.confirmed`、`sample.change_requested`）指同一事实 |
| N5 | 数据模型分组文档已经用过的事件名不改；只有违反 N1–N3 的才改名，改名写进 3.17 并回写数据模型（C84“沿用数据模型已用的写法”） |
| N6 | 草案没有命名、本文补的事件在“草案名 / 出处”栏写“本稿补”，并写明对应的迁移码 |
| N7 | 新事件、新前缀先登记在本文与 `packages/contract`，再写出（第 6 节 V4） |

### 2.2 前缀登记

| 前缀 | 聚合（`aggregate_type`） | 发出模块 | 事件数 |
| --- | --- | --- | --- |
| `calendar.` | （无，aggregate_type 为空） | sla | 1 |
| `merchant_user.` | `merchant_user` | identity | 6 |
| `entity.` | `entity` | tenant | 3 |
| `store.` | `store` | tenant | 4 |
| `entity_member.` | `entity_member` | tenant | 4 |
| `invitation.` | `invitation` | tenant | 4 |
| `staff.` | `staff` | staff | 3 |
| `approval.` | `approval_request` | approval | 6 |
| `assignment.` | `assignment_history` | staff | 2 |
| `store.qualification.` | `store` | profile | 4 |
| `store.qualification_change.` | `store` | profile | 4 |
| `store.profile.` | `store` | profile | 1 |
| `drama.` | `drama` | content、media | 10 |
| `file.` | `file_object` | media | 4 |
| `media.production.` | `production_record` | media | 2 |
| `media.playable.` | `playable_asset` | media | 2 |
| `media.release.` | `zip_bundle` | media | 1 |
| `media.ocr.` | `ocr_result` | media | 1 |
| `asset.` | `store_asset`、`store_asset_demand` | media | 7 |
| `billing.subscription.` | `subscription_term` | billing | 10 |
| `billing.points.` | `billing_account` | billing | 7 |
| `billing.` | `billing_order`、`plan_revision`、`billing_param`、`billing_month_close` | billing | 4 |
| `pricing.` | drama_price_revision 或 drama | billing | 1 |
| `payment_txn.` | `payment_txn` | billing | 1 |
| `billing_order.` | `billing_order` | billing | 5 |
| `transfer.` | `transfer_proof` | billing | 3 |
| `refund_txn.` | `refund_txn` | billing | 1 |
| `refund.` | `refund_request` | billing | 8 |
| `payment_exception.` | `payment_exception` | billing | 5 |
| `invoice.` | `invoice_request`、`invoice_doc` | billing | 7 |
| `recon.` | `recon_day` | billing | 1 |
| `finance_config.` | `finance_config_revision` | billing | 2 |
| `order.` | `drama_order` | order | 4 |
| `order.item.` | `order_item` | order | 7 |
| `cancel.` | `cancel_request` | order | 6 |
| `ad.` | `ad` | ad | 10 |
| `ticket.` | `delivery_ticket` | delivery | 9 |
| `plan.` | `delivery_plan` | delivery | 3 |
| `sample.` | `sample` | delivery | 8 |
| `package.` | `delivery_release`、`delivery_reissue` | delivery | 3 |
| `publish_list.` | `publish_list` | delivery | 1 |
| `account.` | `channel_account` | publish | 4 |
| `launch.` | `launch_task` | publish | 7 |
| `takedown.` | `takedown_task` | publish | 8 |
| `patrol.` | `patrol_task` | publish | 6 |
| `service_ticket.` | `service_ticket` | support | 10 |
| `notify.` | `notification_delivery` | notify | 2 |
| `license_letter.` | `license_letter` | docs | 3 |
| `manual_reminder.` | `manual_reminder_log` | notify | 1 |
| `site_notice.` | `site_notice` | config | 2 |
| `export.` | `export_job` | exports | 2 |
| `webhook.` | `webhook_event` | security | 1 |

`drama.` 由 content（上架、下架、版权、许可、热度等级）与 media（原片变更、预告片就绪）两个模块发出，聚合都是 `drama`，事件名不重叠，沿用数据模型的写法（06:1847）。`billing.` 是账本模块（07）的命名空间，`billing.order_fulfilled` 的聚合是付款单但由账本的 `fulfill()` 发出；付款模块（08）对付款单的事件用 `billing_order.`。`export_job`、`billing_month_close` 不在 01 分组 3.4 的 51 个已知聚合里：契约的 `aggregate_type` 登记表照收（库里只做格式校验，不改库），01 分组 3.4 由主负责人补登。

### 2.3 信封与载荷

信封是 `outbox_event` 的列（01:160-180），由 `events.emit()` 统一填写，载荷里不重复：`event_type`、`aggregate_type`、`aggregate_id`、`entity_id`、`store_id`、`actor_type`、`actor_id`、`client`、`actor_role`、`client_platform`、`client_version`、`request_id`、`occurred_at`、`dedupe_key`。定时器、订阅者、回调、周期任务触发的事件 `actor_type = system`、`actor_id` 与 `client` 为空（01:170、202）。

载荷规则：

| 编号 | 规则 |
| --- | --- |
| P1 | 载荷是 `{ v: 1, … }`；`v` 是数字版本号（`ck_outbox_event_payload`），契约里按 `event_type` 判别（`EventPayload[event_type]`，01:680） |
| P2 | 只放 id、业务日期、关键数字（积分、金额、集数、轮次）与枚举；订阅者回库读当前状态，不依赖载荷里的状态值（01:156、680） |
| P3 | 聚合行的 id 在载荷里再写一遍，订阅者不必读信封；键名为“表名单数驼峰 + `Id`”，不跟随 C11 的路径参数名（付款单在路径里是 `paymentOrderId`，在载荷里是 `billingOrderId`）。目录里照用的简写只有：`termId` / `prevTermId`（subscription_term）、`submissionId`（qualification_submission）、`revisionId`（license_letter_revision）、`fileId` / `sourceFileId`（file_object；production_record 以文件 id 为主键）、`entryId`（service_ticket_entry），新事件不再加简写。需要逐层匹配的上级对象 id 一并带上（如 `dramaOrderId`，12:335） |
| P4 | 状态迁移事件带三个迁移键：`fromState`（新建时为空）、`toState`、`transition`（状态历史事件码）。第 3 节表里写作“＋迁移键” |
| P5 | **不得出现**：明文手机号、openid、unionid、企业微信 userid、证照号与统一社会信用代码、银行账号、身份证号、姓名与称呼、地址、邮箱、验证码与激活码、会话令牌、对象存储的键与签名地址、自由文本（原因说明、备注、意见正文）。原因只放字典编码。理由：事件行 V1.0 不清理（M65），任何人能在“流程运维”看到载荷 |
| P6 | 时刻写 ISO 8601 字符串（`string(date-time)`），日期写 `YYYY-MM-DD`（`string(date)`）；金额整数分、积分整数；数组元素不超过 500 个，超过时只带批次 id，由订阅者回库查（如 `assignment.transferred` 只带 `batchId`） |
| P7 | 类型写法同接口文档；类型后缀 `?` 表示可为 `null`；`enum(表.列)` 表示取值同数据模型该列 |

`dedupe_key`（01:178，全表唯一，`uq_outbox_event_dedupe_key`）：同一事实只应发一次的事件填写，其余为空。`events.emit()` 撞键（`ON CONFLICT (dedupe_key) DO NOTHING` 未插入）即该事实已经发过，跳过、不报错，业务事务照常提交。定时器处理器：一次执行只发一条事件的（`sla.breach` 各主体、`takedown.overdue`、`order.rejected_stale`、`ad.returned_stale`、`service.*` 三种、`content.license_end`、`invitation.expire`、`po.transfer_ttl`、`pricing.drama_price_effective`），这条事件填 `tmr:{定时器的 dedupe_key}`（d3:2843；01:178）；可能发多条的（`order.start`、`usage.end`、`usage.resync`、`takedown.create`、`po.expire`、`rf.poll`）不套 `tmr:`，只做一次由业务状态守卫保证（d3:2843“效果的恰好一次由业务状态守卫与事件去重键保证”），若套用同一个键，第二条起撞键、被当成已发而丢掉；事件自己定了键的照用自己的键（如 `po.expire` 查单为已支付时的 `payment_txn.succeeded`）。周期任务与订阅者发的事件不套 `tmr:`。其余本文定的取法：`calendar.imported:{calendarVersion}`；`assignment.transferred:{batchId}`；`payment_txn.succeeded:{paymentTxnId}`；`billing.points.granted:{grantScheduleId}`；`billing.points.expired:{termId}`；`webhook.received:{webhookEventId}`；`license_letter.issued:{revisionId}`；`notify.mail_delivered` / `notify.mail_failed` 为 `{event_type}:{notificationDeliveryId}`。

### 2.4 发事件的规则

| 编号 | 规则 |
| --- | --- |
| E1 | 25 张业务状态机表经 `flow.transition()` 的每次迁移都发事件（d3:913；01:634），事件名按第 3 节；第 3 节“触发”栏写的是迁移行（`分组:行号`）与触发它的接口或任务 |
| E2 | **一个用例里同一事实只发一次**：随主迁移联动的从属迁移不另发事件。已定的三处：资质结论在 `store` 与 `entity` 两条链上各迁移一次，只发 `store.qualification.*`（04:640“本分组发出 9 个事件，聚合都是 store”）；订单项的推导阶段（`to_launch`、`live`、`ended`）随 `package.delivered`、`order.item.went_live`、`ticket.archived` 表达；授权书的建信、生效、止日变化随同事务的 `license_letter.revision_queued` 表达，只单独发 `license_letter.voided`。与审批单联动的领域行（取消申请、退款申请、渠道账号、上线任务）是不同的事实，审批单与领域行各发各的 |
| E3 | 不是状态迁移、但有订阅方的事实也发事件（如 `merchant_user.phone_changed`、`store.profile.changed`、`drama.tier_changed`、`order.item.usage_end_changed`、`manual_reminder.sent`）；第 3 节“触发”栏注明“不是状态迁移” |
| E4 | 订阅者幂等：投递行按（事件, 订阅者）唯一；订阅者内的写操作走 `transition()` 的状态守卫或带幂等键，重复投递不产生第二次效果（d3:2700） |
| E5 | 扇出类订阅者只登记、不逐个处理：一个事件影响多个对象时，订阅者只为每个对象登记一条定时器（`order.start`、`usage.resync`），各对象在自己的事务里处理（d3:2701） |
| E6 | 冻结、扣减、退回积分与收款入账都在命令事务内同步完成，不放在订阅者里；唯一的例外是收款入账的兜底 `billing.applyPaymentFallback`，它与周期任务 `tx.unapplied_scan` 互为补偿（d3:2702；d2:1188） |
| E7 | 关键类订阅者（2.5 标“是”）在 Redis 不可用时由派发循环在进程内直接执行，另有按状态对账的补偿（d3:2703） |
| E8 | 同层白名单内必须原子完成的联动用同事务调用，不走事件：如 delivery 调 publish 收尾上线任务、调 media 作废 ZIP 缓存，成片交付守卫同步调 `docs.ensureLetters`，广告确认同事务 `reevaluate` 工单。第 3 节订阅者栏的说明里写出这类“同事务端口”，避免重复处理 |

### 2.5 订阅者登记

订阅者的名字、所属模块、关键类登记在 `packages/contract` 的订阅者登记（`@liyoxi/contract/registry`），处理器由各模块的 `register.ts` 登记（计划 第 5.1、9.3 节）；名字写进 `outbox_delivery.subscriber`（`^[A-Za-z][A-Za-z0-9_.]{0,63}$`，01:240、265）；本文沿用 12 分组的 `support.onBizEvent` 写法：`<模块>.on<事实>`，执行动作型的用动词（`billing.applyPaymentFallback`）。后台“流程运维”的死信列表、重投接口（`admin.outboxDelivery.list`、`admin.outboxEvent.retry` 的 `subscriber`）取本表的名字。

| 订阅者（`outbox_delivery.subscriber`） | 模块 | 关键类 | 订阅的事件 | 做什么 | 补偿 |
| --- | --- | --- | --- | --- | --- |
| `notify.onEvent` | notify | 否 | `merchant_user.phone_changed`、`merchant_user.wechat_bound`、`store.archived`、`entity_member.joined`、`entity_member.removed`、`entity_member.promoted`、`entity_member.stores_changed`、`approval.submitted`、`approval.approved`、`approval.rejected`、`approval.sla_breached`、`assignment.transferred`、`assignment.sla_breached`、`store.qualification.submitted`、`store.qualification.approved`、`store.qualification.rejected`、`store.qualification_change.submitted`、`store.qualification_change.approved`、`store.qualification_change.rejected`、`store.profile.changed`、`asset.reviewed`、`asset.adopted`、`asset.demand_created`、`asset.feedback_submitted`、`asset.sla_breached`、`billing.subscription.activated`、`billing.subscription.renewal_scheduled`、`billing.subscription.upgraded`、`billing.subscription.resumed`、`billing.subscription.extended`、`billing.points.granted`、`billing.points.purchased`、`billing.points.captured`、`billing.points.returned`、`billing.points.expired`、`billing.points.adjusted`、`pricing.drama_price_changed`、`billing_order.paid`、`transfer.proof_submitted`、`transfer.rejected`、`transfer.sla_breached`、`refund.rejected`、`refund.completed`、`payment_exception.opened`、`payment_exception.refund_requested`、`invoice.issued`、`invoice.rejected`、`invoice.sla_breached`、`finance_config.proposed`、`finance_config.approved`、`order.submitted`、`order.started`、`order.rejected_stale`、`order.item.cancelled`、`order.item.refunded`、`order.item.terminated`、`order.item.went_live`、`order.item.live_revoked`、`order.item.usage_end_changed`、`order.item.launch_rescheduled`、`ad.requested`、`ad.assigned`、`ad.returned`、`ad.resubmitted`、`ad.version_pushed`、`ad.confirmed`、`ad.revision_requested`、`ad.cancelled`、`ad.returned_stale`、`ad.sla_breached`、`ticket.created`、`ticket.assigned`、`ticket.step_changed`、`ticket.held`、`ticket.resumed`、`ticket.terminated`、`ticket.archived`、`ticket.sla_breached`、`ticket.episode_qc_failed`、`plan.pushed`、`plan.change_requested`、`plan.confirmed`、`sample.check_rejected`、`sample.qc_failed`、`sample.pushed`、`sample.confirmed`、`sample.change_requested`、`package.delivered`、`package.reissued`、`package.reissue_opened`、`publish_list.updated`、`account.verified`、`account.abnormal`、`launch.verified`、`launch.returned`、`launch.verify_revoked`、`takedown.created`、`takedown.merchant_confirmed`、`takedown.checked`、`takedown.found_online`、`takedown.basis_reopened`、`takedown.escalated`、`patrol.abnormal`、`patrol.recovered`、`service_ticket.created`、`service_ticket.replied`、`service_ticket.supplemented`、`service_ticket.result_submitted`、`service_ticket.reopened`、`service_ticket.closed`、`service_ticket.solution_overdue`、`service_ticket.transferred`、`service_ticket.escalated`、`license_letter.issued`、`manual_reminder.sent`、`site_notice.announced`、`site_notice.withdrawn`、`export.succeeded`、`export.failed` | 按通知场景注册表把事件派发为站内消息、订阅消息、短信、企业微信、邮件（13 分组 2.1–2.5；d6:226-275）；事件到场景键的对应见 a09 2.9 通知场景清单 | 无（死信在“流程运维”重投） |
| `notify.onMerchantUserDeleted` | notify | 否 | `merchant_user.deleted` | 注销清理：删除该账号的站内消息，清空其投递行的 target_ref、target_masked（02:1001 ②） | notify.N1 每日核对 |
| `analytics.fromOutbox` | analytics | 否 | `store.qualification.submitted`、`billing.points.expired`、`billing_order.paid`、`order.submitted`、`ad.requested`、`ad.confirmed`、`plan.confirmed`、`sample.confirmed`、`sample.change_requested`、`launch.submitted`、`service_ticket.created` | 按映射表把出站事件派生为埋点（14 分组 2.9；d6:1836-1858），event_id = out-{事件 id}-{name} | analytics.N11 每日核对派生数 |
| `support.onBizEvent` | support | 否 | `approval.submitted`、`approval.approved`、`approval.rejected`、`approval.withdrawn`、`approval.executed`、`ad.returned`、`ad.version_pushed`、`ad.confirmed`、`ad.revision_requested`、`ad.cancelled`、`ticket.created`、`ticket.assigned`、`ticket.step_changed`、`sample.pushed`、`sample.confirmed`、`sample.change_requested` | 往命中的未结客服工单追加 system_event / biz_event 条目（12:335-350）；`approval.withdrawn` 让被撤回的取消、退款申请也进时间线（a08 请求，代替订阅 `refund.*`），12 分组匹配表审批一行（12:341）待回写 | 无（时间线条目，丢了不影响业务） |
| `docs.onLicenseFacts` | docs | 是 | `order.started`、`order.item.cancelled`、`order.item.refunded`、`order.item.terminated`、`order.item.went_live`、`order.item.live_revoked`、`order.item.usage_end_changed`、`ticket.held`、`ticket.resumed`、`ticket.terminated`、`ticket.archived`、`plan.confirmed` | 按订单项调授权书收敛函数 reconcileLetters（13:951；d6:1256）；收敛函数自己比对应有的授权书集合（如方案确认后账号集合是否变化），不依赖载荷里的状态或“是否变化”标记 | 成片交付守卫同事务调 docs.ensureLetters；docs.N6 每日自愈 |
| `docs.onRevisionQueued` | docs | 否 | `license_letter.revision_queued` | 把授权书版次的渲染任务放进 docs 队列（d6:1297） | docs.sweep 每 5 分钟重投停在 queued 的版次 |
| `order.onQualificationDecided` | order | 是 | `store.qualification.approved`、`store.qualification.rejected` | 资质通过：为该门店待开工、无在途取消的订购单逐单登记 order.start；非终局驳回：登记 order.rejected_stale；终局驳回：生成整店取消申请（qualification_cancel）（09:211；d3:2713） | order.pending_start_sweep 每 5 分钟；flow.reconcile_sweep ② |
| `order.onSubscriptionActivated` | order | 是 | `billing.subscription.activated` | 套餐开通后按城市轮询为门店分配交付经理（d3:2735、§6.3） | 开工时兜底分配（d3:599） |
| `order.onLicenseShortened` | order | 否 | `drama.license_shortened` | 告警并给内容运营与交付经理生成人工待办，不自动改订单（d8:235、5.3 第 6 条，默认做法） | 无 |
| `publish.onLicenseExtended` | publish | 是 | `drama.license_extended` | 扇出：为受影响的订单项各登记一条 usage.resync（d3:1798、2734） | flow.reconcile_sweep ③（止日对账，每小时） |
| `profile.onTenantLifecycle` | profile | 否 | `entity.abandoned`、`entity.closed`、`store.archived`、`store.draft_deleted`、`store.restored` | 门店停用、删除草稿门店、恢复、主体放弃或关闭时收尾档案与资质轮次（04:670-684） | profile.I1–I10 每日校验 |
| `profile.onQualificationApproved` | profile | 否 | `store.qualification.approved`、`store.qualification_change.approved` | 找出信用代码相同、属于其他主体的在审轮次，逐个由系统驳回（04:684；d9:712） | profile.I7 每日自愈（系统驳回） |
| `profile.onFileModerated` | profile | 否 | `file.moderated` | 档案媒体被拦截时重算完整度（04:684；d9:717） | profile.I6 每日自愈（重算完整度） |
| `identity.onWechatBound` | identity | 否 | `merchant_user.wechat_bound` | 写一次性提示 merchant_user_notice（02:1019） | 无 |
| `tenant.onEntitlementChanged` | tenant | 否 | `billing.subscription.rolled_over`、`billing.subscription.expired` | 按新套餐的门店、成员上限现算是否超限，超限时经通知中心提醒老板移除（d4:164、662） | d4 的每日“名额超限清单”（数据模型没有落点，见待确认 9）；02 分组第 5 节待补这条订阅 |
| `content.onMastersChanged` | content | 否 | `drama.masters_changed` | 回填受影响剧集的 duration_ms；内容变更时置 `drama.is_permit_recheck_required`，同时把 `drama.lock_version` 加 1（后台编辑页据此发现冲突，a04 请求），并给内容运营生成待办；刷新上架校验结果（d8:560） | 无 |
| `content.onTrailerReady` | content | 否 | `drama.trailer_ready` | 刷新上架校验结果与目录缓存版本号（d8:561） | 无 |
| `billing.onTierChanged` | billing | 否 | `drama.tier_changed` | 按模板定价的剧，积分价实际变化时发 pricing.drama_price_changed（聚合取 drama，`cause = tier_change`）（07:1600；d8:641） | 无（价格按时间取值，不会错价） |
| `billing.onOcrCompleted` | billing | 否 | `media.ocr.completed` | 按识别结果重算回单四项比对，写 transfer_proof.check_result（08:404） | 无（比对只是提示） |
| `billing.onMailResult` | billing | 否 | `notify.mail_delivered`、`notify.mail_failed` | 按邮件投递结果回写 invoice_doc.email_state（08:1215-1216） | 无 |
| `billing.applyPaymentFallback` | billing | 否 | `payment_txn.succeeded` | 成功收款未入账时调用 applyPayment（入账、履约、开差异单）（d2:1188；08:164） | 周期任务 tx.unapplied_scan（每 5 分钟） |
| `billing.submitRefundTxn` | billing | 否 | `refund_txn.created` | 退款交易仍为 created、未停止自动重试时，以同一 out_refund_no 向微信提交退款，并登记 rf.poll（d2:900-912；08:661-664） | 定时器 rf.poll |
| `billing.uploadShippingInfo` | billing | 否 | `billing_order.paid` | 开关打开时向微信上报发货信息（d2:1188） | 无（受开关控制） |
| `delivery.onProductionChecked` | delivery | 否 | `media.production.checked` | 按体检结论改 sample、episode_output 的状态，回写样片时长（10:641、724；10:1317） | delivery 的每日不变量 |
| `security.onWebhookReceived` | security | 否 | `webhook.received` | 收件箱处理器：逐条领取 webhook_event 并调该 provider 注册的处理函数（15:115、117；记 ignored 的规则见 4.5）。死信的人工重置（dead → received，`admin.webhookEvent.retry`、命令行）不发事件，由 webhook.reprocess 领取 | 进程内循环 webhook.reprocess（每分钟内） |
| `reports.onMonthClosed` | reports | 否 | `billing.month_closed` | 写月度快照 report_month_close（14:889）；预留：billing.month_closed 随 billing_month_close 补建后才发 | reports.N10 每周核对 |
| `delivery.onCalendarImported` | delivery | 否 | `calendar.imported` | 重算未完成环节的 due_at、重设 sla.breach、同步工单 step_due_at（10:272） | timers.I7 自愈 |
| `approval.onCalendarImported` | approval | 否 | `calendar.imported` | 重算 pending 审批单的决定时限并重设定时器（03:824） | approval.I3 |
| `staff.onCalendarImported` | staff | 否 | `calendar.imported` | 重算改派记录的 contact_due_at 并重设定时器（03:473） | timers.I7 自愈 |
| `media.onCalendarImported` | media | 否 | `calendar.imported` | 重算未复核素材的 due_at 并重设 sla.breach（06:1193） | timers.I7 自愈 |
| `billing.onCalendarImported` | billing | 否 | `calendar.imported` | 重算 transfer_proof.due_at、invoice_request.due_at、refund_request.exec_due_at 并重设定时器（08:58） | timers.I7 自愈 |
| `order.onCalendarImported` | order | 否 | `calendar.imported` | 重算广告与修改轮次的 due_at、取消申请的 exec_due_at 并重设定时器（09:1087） | timers.I7 自愈 |
| `support.onCalendarImported` | support | 否 | `calendar.imported` | 重算未结客服工单本轮的 response_due_at 并重设 service.first_response_due（12:189） | timers.I7 自愈 |
| `publish.onCalendarImported` | publish | 否 | `calendar.imported` | 重算商家已确认下架任务的 check_due_at（11:671） | timers.I7 自愈 |

## 3. 事件目录

每个分组一张表。“聚合”是 `outbox_event.aggregate_type`（最终表名）；“触发”写迁移行（`分组:行号`，即 `docs/data-model/<分组>-*.md` 的行号）与触发它的接口 operationId 或任务；“载荷”只列事件专属的键，另有公共键 `v`，“＋迁移键”见 P4。“订阅者”栏列出的都是异步订阅（经 `outbox_delivery`，在订阅者自己的事务里处理；模块与补偿见 2.5），★ 表示关键类；不经事件、在发事件的同一事务里完成的联动（同事务端口，E8）与无订阅者的原因写在“注：”或括号里。

### 3.1 内核与工作日历（01）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `calendar.imported` | d3:3054；01:542 | （无，aggregate_type 为空） | 导入年度放假安排且至少一天的 kind 变化（01:542）：`admin.calendarDay.batchImport` | `calendarVersion` integer 本次导入取得的新批次号；`year` integer 导入的年份；`changedDays` array<string(date)> kind 变化的日期，升序 | `delivery.onCalendarImported`：重算环节时限；`approval.onCalendarImported`：重算审批时限；`staff.onCalendarImported`：重算联系时限；`media.onCalendarImported`：重算素材复核时限；`billing.onCalendarImported`：重算对公凭证、开票、退款执行时限；`order.onCalendarImported`：重算广告、修改轮次、取消执行时限；`support.onCalendarImported`：重算首次响应时限；`publish.onCalendarImported`：重算下架核查时限 |

### 3.2 身份与租户（02）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `merchant_user.registered` | 迁移码 merchant_user.register（02:1009） | `merchant_user` | 02:125 首次手机号登录：`m.session.phoneLogin`；老板更换时新老板号码没有账号、按号码建号：`admin.accountChangeRequest.approve`（owner_transfer，A143） | `merchantUserId` uuid 商家用户；`via` enum(phone_login, owner_transfer) 首次登录或老板更换建号；`sourceType` enum(merchant_user.source_type) 来源类型（建号时为 organic）；`sourceReferralCodeId` uuid? 命中的登记码；＋迁移键 | 无 |
| `merchant_user.disabled` | 迁移码 merchant_user.disable | `merchant_user` | 02:126：`admin.merchantUser.disable` | `merchantUserId` uuid 商家用户；＋迁移键 | 无 |
| `merchant_user.enabled` | 迁移码 merchant_user.enable | `merchant_user` | 02:127：`admin.merchantUser.enable` | `merchantUserId` uuid 商家用户；＋迁移键 | 无 |
| `merchant_user.deleted` | 02:139、1021 | `merchant_user` | 02:128 注销：`m.me.deletion.create`；02:129 换绑时清理空账号：`m.me.changePhone`、`admin.accountChangeRequest.approve` | `merchantUserId` uuid 被注销或清理的账号；`reason` enum(self_deleted, purge_empty) 注销或空账号清理；＋迁移键 | `notify.onMerchantUserDeleted`：删站内消息、清空投递目标 |
| `merchant_user.phone_changed` | 02:443、1020 | `merchant_user` | 换绑手机号生效（不是状态迁移）：`m.me.changePhone`（自助）、`admin.accountChangeRequest.approve`（phone_rebind，02:443） | `merchantUserId` uuid 账号；`via` enum(self_service, approval) 自助或审批；`accountChangeRequestId` uuid? 审批路径时的申请单 | `notify.onEvent`：站内消息“手机号已更换”（13:158）；不带号码。给原号码的短信不经本事件，由 identity 提交后调 notify.sendDirect。注：载荷不带手机号（02:1020） |
| `merchant_user.wechat_bound` | account.new_wechat_bound（02:1019；13:157；d4:293-295） | `merchant_user` | 新微信绑定到有成员关系的账号（不是状态迁移）：`m.session.phoneLogin` | `merchantUserId` uuid 账号；`wechatIdentityId` uuid 刚绑定的微信身份；通知侧据此排除它 | `identity.onWechatBound`：写一次性提示；`notify.onEvent`：通知原有微信（短信 account_notice，策略 always；订阅消息排除载荷里的身份） |
| `entity.created` | 迁移码 entity.create | `entity` | 02:523：`m.entity.create` | `entityId` uuid 主体；`firstStoreId` uuid 同事务建的首店；`ownerUserId` uuid 老板；＋迁移键 | 无 |
| `entity.abandoned` | 02:1022 | `entity` | 02:524 空草稿让位：`m.invitation.accept`（受邀人名下是空草稿）、`m.session.phoneLogin`（休眠保护，d4:450-460） | `entityId` uuid 被放弃的主体；＋迁移键 | `profile.onTenantLifecycle`：撤回在审轮次、丢弃草稿 |
| `entity.closed` | 02:1023 | `entity` | 02:525：`m.me.deletion.create`（老板注销）、`admin.entity.close` | `entityId` uuid 主体；`closedBy` enum(owner_deletion, staff_close) 来源；＋迁移键 | `profile.onTenantLifecycle`：撤回在审轮次、丢弃草稿、释放全部证照引用（保留 3 年） |
| `store.created` | 迁移码 store.create | `store` | 02:607：`m.store.create`、`m.entity.create`（首店） | `storeId` uuid 门店；`entityId` uuid 主体；`isFirstStore` boolean 是否首店；＋迁移键 | 无 |
| `store.archived` | 02:1024 | `store` | 02:608-611：`m.store.archive`（by_owner）、`m.store.delete`（draft_deleted）、`admin.entity.close` 与 `m.me.deletion.create`（entity_closed）、主体被放弃的联动（entity_abandoned，随 `m.invitation.accept`、`m.session.phoneLogin`） | `storeId` uuid 门店；`entityId` uuid 主体；`archiveReason` enum(store.archive_reason) 四种原因都发；＋迁移键 | `profile.onTenantLifecycle`：丢弃草稿轮次；释放三类档案引用（保留 180 天）；`notify.onEvent`：archiveReason = by_owner 时通知交付经理（d4:790 ⑤） |
| `store.draft_deleted` | 02:1025 | `store` | 02:609：`m.store.delete`（与 `store.archived` 同事务各发一条） | `storeId` uuid 门店；`entityId` uuid 主体 | `profile.onTenantLifecycle`：丢弃草稿轮次，释放档案与草稿证照引用（幂等） |
| `store.restored` | 02:1026 | `store` | 02:612：`m.store.restore` | `storeId` uuid 门店；`entityId` uuid 主体；＋迁移键 | `profile.onTenantLifecycle`：对未移除的档案行重新 files.link |
| `entity_member.joined` | 本稿补（d4:704、736 的“邀请被接受后通知老板”；迁移码 entity_member.join） | `entity_member` | 02:691：`m.invitation.accept`（新建成员关系时；接受人已是本主体店员、只增加门店的发 `entity_member.stores_changed`，不发本事件） | `entityMemberId` uuid 成员关系；`entityId` uuid 主体；`merchantUserId` uuid 加入的账号；`invitationId` uuid 邀请；`storeIds` array<uuid> 可进入的门店；＋迁移键 | `notify.onEvent`：m.member_changed：通知老板 |
| `entity_member.removed` | 02:1027 | `entity_member` | 02:692-695：`m.member.remove`、`m.me.membership.leave`、`m.store.archive`、`m.store.delete`（只属于该草稿门店的店员）、`m.me.deletion.create`、`admin.entity.close`、`admin.accountChangeRequest.approve`（原老板）、`m.invitation.accept`（空草稿让位）、`m.session.phoneLogin`（休眠保护） | `entityMemberId` uuid 成员关系；`entityId` uuid 主体；`merchantUserId` uuid 被移除的账号；`role` enum(owner, clerk) 移除前的角色；`removeReason` enum(entity_member.remove_reason) 原因；＋迁移键 | `notify.onEvent`：m.member_changed：通知被移出的店员与老板（d4:790 ③、760） |
| `entity_member.promoted` | 本稿补（迁移码 entity_member.promote_owner，from = to；新老板不是成员时的 entity_member.create_owner 并入本事件，A143） | `entity_member` | 老板更换生效，一张申请发一条：02:693 原店员升为老板（promote_owner）；02:690 新老板不是本主体成员、新建老板关系（create_owner，`fromState` 为空）：`admin.accountChangeRequest.approve`（owner_transfer） | `entityMemberId` uuid 新老板的成员关系；`entityId` uuid 主体；`merchantUserId` uuid 新老板；＋迁移键 | `notify.onEvent`：老板更换后通知双方与服务经理（d4:775） |
| `entity_member.stores_changed` | 本稿补（d4:748 的“调整门店”通知；d6:247） | `entity_member` | 店员可进入的门店变化（不是状态迁移）：老板调整 `m.member.update`；已是本主体店员的人接受另一家门店的邀请 `m.invitation.accept`（m02 请求） | `entityMemberId` uuid 成员关系；`entityId` uuid 主体；`merchantUserId` uuid 店员；`addedStoreIds` array<uuid> 新增的门店；`removedStoreIds` array<uuid> 移出的门店；`invitationId` uuid? 经接受邀请增加门店时的邀请，老板调整时为空 | `notify.onEvent`：m.member_changed：`invitationId` 为空时通知该店员，非空时通知老板（邀请已被接受） |
| `invitation.created` | 迁移码 invitation.create | `invitation` | 02:786：`m.invitation.create` | `invitationId` uuid 邀请；`entityId` uuid 主体；`storeId` uuid 门店；`expiresAt` string(date-time) 过期时间；＋迁移键 | 无 |
| `invitation.accepted` | 迁移码 invitation.accept | `invitation` | 02:787：`m.invitation.accept` | `invitationId` uuid 邀请；`entityId` uuid 主体；`storeId` uuid 门店；`acceptedByUserId` uuid 接受人；＋迁移键 | 无 |
| `invitation.revoked` | 迁移码 invitation.revoke | `invitation` | 02:788：`m.invitation.revoke`；门店停用、删除草稿门店、主体关闭的联动（`m.store.archive`、`m.store.delete`、`admin.entity.close`、`m.me.deletion.create`） | `invitationId` uuid 邀请；`entityId` uuid 主体；`storeId` uuid 门店；＋迁移键 | 无 |
| `invitation.expired` | 迁移码 invitation.expire | `invitation` | 02:789：定时器 `invitation.expire`（处理器见 4.1） | `invitationId` uuid 邀请；`entityId` uuid 主体；`storeId` uuid 门店；＋迁移键 | 无 |

### 3.3 员工、审批与改派（03）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `staff.created` | 本稿补（03:217-219） | `staff` | 03:217-219：`admin.staff.create`；命令行 `staff:bootstrap` | `staffId` uuid 员工；`roleKey` string staff_role.role_key；＋迁移键 | 无（激活码短信不经出站事件：员工用例在事务提交后调 `notify.sendDirect` 直发，`purpose = staff_activation`，A95） |
| `staff.enabled` | 本稿补 | `staff` | 03:220、222：`admin.staff.enable` | `staffId` uuid 员工；＋迁移键 | 无 |
| `staff.disabled` | d3:2733 | `staff` | 03:221：`admin.staff.disable` | `staffId` uuid 员工；`handoverBatchId` uuid? 同事务移交写的 assignment_history.batch_id；＋迁移键 | 无（接收人与商家的通知由同事务的 assignment.transferred 承担） |
| `approval.submitted` | d3:2731 | `approval_request` | 03:804：各类申请的创建接口（`admin.accountChangeRequest.create`、`admin.order.cancelRequest.create`、`admin.ad.cancelRequest.create`、`m.cancelRequest.create`（V1.1）、`admin.paymentOrder.refundRequest.create`、`admin.paymentException.resolve`（转退款）、`admin.pointAdjustmentRequest.create`、`admin.termExtensionRequest.create`、`admin.financeConfigRevision.create`、`admin.transferProof.confirm`（二人复核）、`m.storeProfile.qualification.submit`、`m.channelAccount.create`、`m.channelAccount.submit`、`m.launchTask.submit`）；系统：终局驳回生成整店取消（`order.onQualificationDecided`）、撤销核验后重开（`admin.launchSubmission.revoke`） | `approvalRequestId` uuid 审批单；`kind` enum(approval_request.kind) 类型；`category` enum(approval_request.category) 审批或审核；`subjectType` string 对象表名；`subjectId` uuid 对象；`entityId` uuid? 主体；`storeId` uuid? 门店；`roundNo` integer 轮次；＋迁移键 | `notify.onEvent`：s.approval_pending：通知有决定权的人；`support.onBizEvent`：关联工单时间线 |
| `approval.approved` | d3:2731 | `approval_request` | 03:805：A14 列出的各领域 `…/approve`、`admin.transferProof.approveReview`；免审批时系统（`cancel.auto_execute`，随 `admin.order.cancelRequest.create`、`admin.ad.cancelRequest.create` 的提交事务） | `approvalRequestId` uuid 审批单；`kind` enum(approval_request.kind) 类型；`subjectType` string 对象表名；`subjectId` uuid 对象；`isDecidedBySystem` boolean 免审批或系统决定；＋迁移键 | `notify.onEvent`：s.approval_decided：通知申请人；`support.onBizEvent`：关联工单时间线 |
| `approval.rejected` | d3:2731 | `approval_request` | 03:806：各领域 `…/reject`、`admin.transferProof.rejectReview`；系统驳回（同信用代码另一主体先通过，`profile.onQualificationApproved`） | `approvalRequestId` uuid 审批单；`kind` enum(approval_request.kind) 类型；`subjectType` string 对象表名；`subjectId` uuid 对象；`reasonCodes` array<string> 字典 reject_reason 的编码；`isDecidedBySystem` boolean 系统驳回；＋迁移键 | `notify.onEvent`：s.approval_decided：通知申请人；`support.onBizEvent`：关联工单时间线 |
| `approval.withdrawn` | 本稿补（03:807） | `approval_request` | 03:807：各领域 `…/withdraw`（如 `admin.cancelRequest.withdraw`、`admin.refundRequest.withdraw`、`admin.accountChangeRequest.withdraw`）；系统代撤：注销 `m.me.deletion.create`；空账号清理代撤以它为对象的申请（`m.me.changePhone`、`admin.accountChangeRequest.approve`）；主体关闭撤回待审批的取消申请（`admin.entity.close`，09:550）；`launch.void` / `launch.settle`（定时器 `usage.end`、`admin.cancelRequest.execute`、`m.takedownTask.confirm`、`admin.deliveryTicket.reevaluate`）；`m.channelAccount.unbind` | `approvalRequestId` uuid 审批单；`kind` enum(approval_request.kind) 类型；`subjectType` string 对象表名；`subjectId` uuid 对象；＋迁移键 | `support.onBizEvent`：关联工单时间线（取消、退款申请被撤回） |
| `approval.executed` | d3:2731 | `approval_request` | 有执行步的四类在领域行进入 done 时（审批单本身停在 approved，不是迁移）：09:551（`admin.cancelRequest.execute`）；09:553（`cancel.auto_execute`，随 `admin.order.cancelRequest.create`、`admin.ad.cancelRequest.create` 的提交事务）；08:528（`admin.refundRequest.recordOffline`）；08:531 退款交易成功（回调 `hooks.wechatpay.refund.notify`、定时器 `rf.poll`、周期任务 `bill.download`）；08:529 退款回调晚到（申请已回到待执行，A102：回调 `hooks.wechatpay.refund.notify`、周期任务 `bill.download`） | `approvalRequestId` uuid 审批单；`kind` enum(order_cancel, ad_cancel, qualification_cancel, plan_refund) 类型；`domainType` enum(cancel_request, refund_request) 领域行表名；`domainId` uuid 领域行 | `support.onBizEvent`：关联工单时间线 |
| `approval.sla_breached` | d3:2718 | `approval_request` | 定时器 `sla.breach`（主体 approval_request，用途 decision 或 execution）到点且仍未决定、或领域行仍是 `pending_execution` | `approvalRequestId` uuid 审批单；`kind` enum(approval_request.kind) 类型；`purpose` enum(decision, execution) 决定时限或执行时限；`dueAt` string(date-time) 截止时间 | `notify.onEvent`：s.approval_overdue：通知处理人与主管 |
| `assignment.transferred` | d3:2733；03:475 | `assignment_history` | 一批改派（同一 batch_id 发一条，不是状态迁移）：`admin.staff.disable`、`admin.staff.handover`、转移交付经理 `admin.store.reassignDeliveryManager`（A136）、`staff.I10` 自动改派（`invariant.full`） | `batchId` uuid 改派批次；`countsBySource` object 按来源（assignment_history.source）的数量；`toStaffId` uuid 接收人；`reasonCode` string 原因编码 | `notify.onEvent`：s.work_ticket_assigned：通知接收人；服务经理变更时通知商家 |
| `assignment.sla_breached` | 本稿补（d3 N6） | `assignment_history` | 定时器 `sla.breach`（主体 assignment_history）到点且新交付经理未标记已联系 | `assignmentHistoryId` uuid 改派记录；`storeId` uuid? 门店；`toStaffId` uuid 新负责人；`contactDueAt` string(date-time) 联系截止时间 | `notify.onEvent`：s.handover_overdue：提醒新交付经理与主管 |

### 3.4 门店档案与资质（04）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `store.qualification.submitted` | d9:699；04:640 | `store` | 02:622、625（04:343、355）initial、new_store 轮次提交：`m.storeProfile.qualification.submit` | `storeId` uuid 门店；`entityId` uuid 主体；`submissionId` uuid 资质轮次；`kind` enum(qualification_submission.kind) 轮次类型；`roundNo` integer 轮次 | `notify.onEvent`：站内“新增门店已提交审核”；`analytics.fromOutbox`：profile_submit（只计 kind = initial，14:771） |
| `store.qualification.approved` | d9:700；d3:2713 | `store` | 02:623：`admin.qualificationSubmission.approve` | `storeId` uuid 门店；`entityId` uuid 主体；`submissionId` uuid 资质轮次；`kind` enum(qualification_submission.kind) 轮次类型 | ★`order.onQualificationDecided`：为待开工订购单登记 order.start；`profile.onQualificationApproved`：系统驳回同信用代码的其他在审轮次；`notify.onEvent`：m.review_result |
| `store.qualification.rejected` | d9:701；d3:2713 | `store` | 02:624：`admin.qualificationSubmission.reject`；系统驳回（`profile.onQualificationApproved`，信用代码重复） | `storeId` uuid 门店；`entityId` uuid 主体；`submissionId` uuid 资质轮次；`isFinal` boolean 是否终局驳回（无法补正）；`reasonCodes` array<string> 驳回原因编码；`isSystem` boolean 系统驳回 | ★`order.onQualificationDecided`：终局：生成整店取消；非终局：登记 order.rejected_stale；`notify.onEvent`：m.review_result |
| `store.qualification.withdrawn` | d9:702 | `store` | 02:626：系统撤回（主体被关闭或放弃，`profile.onTenantLifecycle`） | `storeId` uuid 门店；`submissionId` uuid 资质轮次 | 无 |
| `store.qualification_change.submitted` | d9:703 | `store` | 02:627 change 轮次提交：`m.storeProfile.qualification.submit` | `storeId` uuid 门店；`entityId` uuid 主体；`submissionId` uuid 资质轮次；`changedFields` array<string> 变更的字段名 | `notify.onEvent`：m.review_result（13:154 列为待接，a09 2.9 已接上） |
| `store.qualification_change.approved` | d9:703 | `store` | 02:627：`admin.qualificationSubmission.approve`（change 轮次） | `storeId` uuid 门店；`entityId` uuid 主体；`submissionId` uuid 资质轮次；`changedFields` array<string> 变更的字段名 | `profile.onQualificationApproved`：本轮含营业执照时系统驳回同信用代码的其他在审轮次（d9:712）；`notify.onEvent`：m.review_result |
| `store.qualification_change.rejected` | d9:703 | `store` | 02:627：`admin.qualificationSubmission.reject`（change 轮次） | `storeId` uuid 门店；`entityId` uuid 主体；`submissionId` uuid 资质轮次；`reasonCodes` array<string> 驳回原因编码 | `notify.onEvent`：m.review_result |
| `store.qualification_change.withdrawn` | 04:362（本稿补的 change 轮次撤回） | `store` | 02:628：系统撤回（`profile.onTenantLifecycle`） | `storeId` uuid 门店；`submissionId` uuid 资质轮次 | 无 |
| `store.profile.changed` | d9:704 | `store` | 档案生效值变化（不是状态迁移）：商家保存免审字段（`m.storeProfile.basic.update`、`m.storeProfile.media.update`、`m.storeProfile.service.update`）、代改档案 `admin.store.profile.update`、审核通过回写 | `storeId` uuid 门店；`entityId` uuid 主体；`fields` array<string> 变化的字段名；`source` enum(merchant, staff_proxy, review_writeback) 来源 | `notify.onEvent`：source = staff_proxy 时通知商家“档案已代改”（d6:253） |

### 3.5 短剧库（05）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `drama.created` | 迁移码 drama.create | `drama` | 05:143：`admin.drama.create` | `dramaId` uuid 短剧；＋迁移键 | 无 |
| `drama.listed` | d8:546；05:144、147 | `drama` | 05:144、147：`admin.drama.shelve`（上架、重新上架） | `dramaId` uuid 短剧；`isRelist` boolean 是否重新上架；＋迁移键 | 无（目录缓存版本号在同一事务里加 1（05:151），不经订阅） |
| `drama.delisted` | d8:547；05:145-146 | `drama` | 05:145：`admin.drama.delist`；05:146：定时器 `content.license_end` | `dramaId` uuid 短剧；`reasonCode` enum(drama.delist_reason_code) 下架原因；＋迁移键 | 无（rights_issue 时停用预告片公开分发在同一事务里调 media.retireDramaMedia） |
| `drama.tier_changed` | d8:548；07:1600 | `drama` | 改热度等级（不是状态迁移）：`admin.drama.commercial.update` | `dramaId` uuid 短剧；`fromTier` enum(drama.heat_tier) 原等级；`toTier` enum(drama.heat_tier) 新等级 | `billing.onTierChanged`：积分价实际变化时发 pricing.drama_price_changed |
| `drama.license_extended` | d8:549；d3:2734 | `drama` | 上架后版权止日变晚（05:374）：`admin.drama.dramaCopyrightRevision.create` | `dramaId` uuid 短剧；`dramaCopyrightRevisionId` uuid 修订行；`prevEndDate` string(date) 原止日；`newEndDate` string(date) 新止日 | ★`publish.onLicenseExtended`：扇出登记 usage.resync |
| `drama.license_shortened` | d8:550 | `drama` | 上架后版权止日变早：`admin.drama.dramaCopyrightRevision.create` | `dramaId` uuid 短剧；`dramaCopyrightRevisionId` uuid 修订行；`prevEndDate` string(date) 原止日；`newEndDate` string(date) 新止日 | `order.onLicenseShortened`：告警并生成人工待办 |
| `drama.license_scope_changed` | d8:551 | `drama` | 授权平台或地域变更：`admin.drama.dramaCopyrightRevision.create` | `dramaId` uuid 短剧；`dramaCopyrightRevisionId` uuid 修订行；`platformsRemoved` array<string> 去掉的平台；`platformsAdded` array<string> 增加的平台；`isTerritoryChanged` boolean 地域是否变化 | 无（订阅者待定（d8 第 9 节：docs 是否换版、在途订单怎么办），V1.0 无订阅者） |
| `drama.permit_changed` | d8:552；05:269 | `drama` | 许可行新增、停用（上架过的剧换号）：`admin.drama.dramaPermit.create`、`admin.dramaPermit.retire` | `dramaId` uuid 短剧；`dramaPermitId` uuid 许可行；`platform` enum(drama_permit.platform) 平台 | 无（订阅者待定（d8 10-Q5），V1.0 无订阅者） |

### 3.6 媒体与素材（06）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `file.uploaded` | d5:2139；06:1838 | `file_object` | 06:191 确认且对象相符（pending → promoting，与建 promote 任务同事务；A141，d5:1038）：`m.file.complete`、`admin.file.complete`、`admin.uploadBatchItem.complete`（批次条目确认）；登记（06:188）时不发 | `fileId` uuid 文件；`category` enum(file_object.category) 分类；`storeId` uuid? 门店；`entityId` uuid? 主体 | 无 |
| `file.stored` | d5:2139 | `file_object` | 06:189、194：worker 入库（promote 任务）、系统写入 files.putSystemFile | `fileId` uuid 文件；`category` enum(file_object.category) 分类；`storeId` uuid? 门店 | 无 |
| `file.rejected` | d5:2139 | `file_object` | 06:192、195：`m.file.complete` / `admin.file.complete`（确认不符）；worker（复制或核对失败） | `fileId` uuid 文件；`category` enum(file_object.category) 分类；`rejectCode` string 拒收原因码 | 无 |
| `file.moderated` | d5:2139 | `file_object` | 06:197 审核判定：worker 媒体任务收尾（含内容安全异步结果） | `fileId` uuid 文件；`category` enum(file_object.category) 分类；`moderationState` enum(file_object.moderation_state) 审核结论；`storeId` uuid? 门店 | `profile.onFileModerated`：档案媒体被拦截时重算完整度 |
| `media.production.checked` | d5:2139 | `production_record` | 06:782-783 体检收尾：worker | `fileId` uuid 制作文件（production_record 主键）；`kind` enum(production_record.kind) 制作文件类型；`orderItemId` uuid? 订单项；`gate` enum(pass, reject) 硬性项结论；`durationMs` integer? 探测到的时长 | `delivery.onProductionChecked`：改样片、成片修订的状态，回写样片时长 |
| `media.production.derived` | d5:2139 | `production_record` | 06:779 规格化或补标产物登记：`admin.productionRecord.normalize`、`admin.productionRecord.restamp` 的产物由 worker 登记 | `fileId` uuid 派生出的制作文件；`sourceFileId` uuid 源文件；`derivation` enum(normalize, restamp) 派生方式 | 无（06:1839 列 delivery、ad 为已知订阅者，做什么未定义；V1.0 不自动登记：产物体检通过后由剪辑师经 a05 3.30 / 3.56 登记为新修订或新版本（`episode_output.source = normalized` / `restamped`，A142），与 a05 一致） |
| `media.playable.ready` | d5:2139 | `playable_asset` | 06:897、902：worker | `playableAssetId` uuid 可播放资产；`ownerType` string 属主表名；`ownerId` uuid 属主；`kind` enum(playable_asset.kind) 资产类型 | 无（“推送商家确认”的可用性由接口现查（C62），V1.0 无订阅者；预告片就绪另发 drama.trailer_ready） |
| `media.playable.failed` | d5:2139 | `playable_asset` | 06:898：worker（任一任务重试耗尽） | `playableAssetId` uuid 可播放资产；`ownerType` string 属主表名；`ownerId` uuid 属主；`kind` enum(playable_asset.kind) 资产类型 | 无（失败告警走 alerts.raise；V1.0 无订阅者） |
| `media.release.zip_ready` | d5:2139；M8 | `zip_bundle` | 06:972 打包成功：worker（zip_package 任务收尾） | `zipBundleId` uuid ZIP 缓存行；`ownerType` string 属主表名（delivery_release）；`ownerId` uuid 成片包；`zipGen` integer 代次 | 无（下载页按同一个签发请求轮询（C65），V1.0 无订阅者） |
| `media.ocr.completed` | 06:1501（本稿新增，M8） | `ocr_result` | 06:1501 异步识别收尾：worker | `ocrResultId` uuid 识别结果；`docType` string 识别类型（回单）；`status` enum(ocr_result.status) ok / unavailable / unreadable | `billing.onOcrCompleted`：写 transfer_proof.check_result |
| `asset.processed` | d5:2139 | `store_asset` | 06:1184 处理完成：worker | `storeAssetId` uuid 素材；`storeId` uuid 门店；`entityId` uuid 主体 | 无（工作台待办由读侧查询，V1.0 无订阅者） |
| `asset.review_needed` | d5:2139 | `store_asset` | 06:1184 处理完成且未复核（进入复核队列）：worker | `storeAssetId` uuid 素材；`storeId` uuid 门店；`dueAt` string(date-time)? 复核截止时间 | 无（复核队列由读侧查询，V1.0 无订阅者） |
| `asset.reviewed` | 06:1849（本稿定名；d6:248） | `store_asset` | 06:1186-1187：`admin.storeAsset.review`；06:1189 `admin.storeAsset.confirmPortraitAuth` | `storeAssetId` uuid 素材；`storeId` uuid 门店；`usability` enum(store_asset.usability) 可用性；`uploadActorType` enum(merchant, staff) 上传人类型；`uploaderUserId` uuid? 商家上传人 | `notify.onEvent`：m.asset_feedback：usability 为 need_reshoot、need_portrait_auth 且商家上传时提醒上传人 |
| `asset.adopted` | 06:1849（本稿定名；PRD:730） | `store_asset` | 06:1190 写入 role = adopted 的使用记录：成片修订登记（`admin.deliveryTicket.episodeOutput.create`）、广告版本登记（`admin.ad.adVersion.create`） | `storeAssetId` uuid 素材；`storeId` uuid 门店；`usedByType` enum(ad_version, order_item) 采用方；`usedById` uuid 采用方 id；`uploaderUserId` uuid? 商家上传人 | `notify.onEvent`：m.asset_feedback：通知上传人（只在商家上传时） |
| `asset.demand_created` | 06:1849（本稿定名；PRD:731） | `store_asset_demand` | 06:1434：`admin.assetDemand.create` | `storeAssetDemandId` uuid 素材需求；`storeId` uuid 门店；`notifyScope` enum(store_asset_demand.notify_scope) 通知范围；`dueDate` string(date)? 完成日期 | `notify.onEvent`：m.asset_feedback：按 notify_scope 取老板与店员 |
| `asset.feedback_submitted` | m03 3.24（A33、A56：素材反馈不建表，经通知中心提醒交付经理） | `store_asset` | 素材标签有误等轻量反馈（不是状态迁移）：`m.storeAsset.feedback.create` | `storeAssetId` uuid 素材；`storeId` uuid 门店；`entityId` uuid 主体；`actorRole` enum(owner, clerk) 反馈人角色 | `notify.onEvent`：s.asset_feedback：提醒门店交付经理（为空时发给交付主管）。注：反馈正文只进审计，不进载荷（P5） |
| `asset.sla_breached` | 本稿补（d3 T33；M22） | `store_asset` | 定时器 `sla.breach`（主体 store_asset）到点且仍未复核 | `storeAssetId` uuid 素材；`storeId` uuid 门店；`dueAt` string(date-time) 复核截止时间 | `notify.onEvent`：s.asset_review_overdue：提醒交付经理复核 |
| `drama.masters_changed` | d5:2139；06:1847 | `drama` | 06:1079-1080 原片批次提交：`admin.uploadBatch.commit` | `dramaId` uuid 短剧；`uploadBatchId` uuid 批次；`episodeNos` array<integer> 受影响的集号；`isContentChanged` boolean 是否内容变更 | `content.onMastersChanged`：回填时长、标记许可复核、刷新上架校验 |
| `drama.trailer_ready` | d5:2139；06:1847 | `drama` | 06:897 预告片资产就绪：worker | `dramaId` uuid 短剧；`playableAssetId` uuid 预告片资产 | `content.onTrailerReady`：刷新上架校验与目录缓存 |

### 3.7 价目、订阅与积分账本（07）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `billing.subscription.activated` | d1:1720 | `subscription_term` | 07:540 无生效订阅时付清套餐（fulfill）：入账事务（入口见 5.1）：`hooks.wechatpay.transaction.notify`、`m.paymentOrder.sync`、`m.paymentOrder.wechatPrepay`、`m.paymentOrder.cancel`（后两者查单为已支付时就地入账）、定时器 `po.expire`（查单为已支付）、`admin.transferProof.confirm`、`admin.transferProof.approveReview`、`admin.paymentException.resolve`（补单、关联到付款单）、订阅者 `billing.applyPaymentFallback`、周期任务 `tx.unapplied_scan` | `termId` uuid 订阅周期；`entityId` uuid 主体；`planId` uuid 套餐；`startsAt` string(date-time) 起始；`endsAt` string(date-time) 结束；`sourceBillingOrderId` uuid 来源付款单 | ★`order.onSubscriptionActivated`：分配交付经理；`notify.onEvent`：站内“套餐已开通” |
| `billing.subscription.renewal_scheduled` | d1:1720 | `subscription_term` | 07:539 生效期间付清套餐（fulfill，周期为 scheduled）：入账事务（入口见 5.1）：`hooks.wechatpay.transaction.notify`、`m.paymentOrder.sync`、`m.paymentOrder.wechatPrepay`、`m.paymentOrder.cancel`（后两者查单为已支付时就地入账）、定时器 `po.expire`（查单为已支付）、`admin.transferProof.confirm`、`admin.transferProof.approveReview`、`admin.paymentException.resolve`（补单、关联到付款单）、订阅者 `billing.applyPaymentFallback`、周期任务 `tx.unapplied_scan` | `termId` uuid 预约周期；`entityId` uuid 主体；`startsAt` string(date-time) 起始；`endsAt` string(date-time) 结束 | `notify.onEvent`：站内“续费成功” |
| `billing.subscription.rolled_over` | d1:1720；d4:662 | `subscription_term` | 07:541 预约周期接续生效：`advance`（进程内每分钟扫描、写操作开头、周期任务 `billing.sweep.daily`）；退款提前生效（`admin.refundRequest.execute`、`admin.refundRequest.recordOffline`、`admin.paymentException.resolve`） | `termId` uuid 新生效的周期；`prevTermId` uuid? 上一周期；`entityId` uuid 主体 | `tenant.onEntitlementChanged`：名额超限时通知老板（d4） |
| `billing.subscription.upgraded` | d1:1720 | `subscription_term` | 07:437 升级（fulfill，付款单内容为升级）：入账事务（入口见 5.1）：`hooks.wechatpay.transaction.notify`、`m.paymentOrder.sync`、`m.paymentOrder.wechatPrepay`、`m.paymentOrder.cancel`（后两者查单为已支付时就地入账）、定时器 `po.expire`（查单为已支付）、`admin.transferProof.confirm`、`admin.transferProof.approveReview`、`admin.paymentException.resolve`（补单、关联到付款单）、订阅者 `billing.applyPaymentFallback`、周期任务 `tx.unapplied_scan` | `termId` uuid 周期；`entityId` uuid 主体；`fromPlanId` uuid 原套餐；`toPlanId` uuid 新套餐 | `notify.onEvent`：站内“套餐已升级” |
| `billing.subscription.expired` | d1:1720；d4:662 | `subscription_term` | 07:438、543 到期且没有预约周期：`advance` | `termId` uuid 到期的周期；`entityId` uuid 主体；`endedAt` string(date-time) 到期时刻 | `tenant.onEntitlementChanged`：名额超限时通知老板（d4） |
| `billing.subscription.resumed` | d1:1720 | `subscription_term` | 07:439、544 到期后补批延长（周期复活）：`admin.termExtensionRequest.approve` | `termId` uuid 周期；`entityId` uuid 主体；`newEndsAt` string(date-time) 新结束时刻 | `notify.onEvent`：站内“有效期延长” |
| `billing.subscription.extended` | d1:1720 | `subscription_term` | 07:437 未到期的补偿延长：`admin.termExtensionRequest.approve` | `termId` uuid 周期；`entityId` uuid 主体；`prevEndsAt` string(date-time) 原结束；`newEndsAt` string(date-time) 新结束 | `notify.onEvent`：站内“有效期延长” |
| `billing.subscription.refund_suspended` | d1:1720 | `subscription_term` | 07:553 套餐退款申请建行（suspendTermForRefund）：`admin.paymentOrder.refundRequest.create` | `termId` uuid 周期；`entityId` uuid 主体；`refundRequestId` uuid 退款申请 | 无 |
| `billing.subscription.refund_resumed` | d1:1720 | `subscription_term` | 07:554 申请未执行即关闭（resumeTermFromRefund）：`admin.refundRequest.reject`、`admin.refundRequest.withdraw`、`admin.refundRequest.void` | `termId` uuid 周期；`entityId` uuid 主体；`refundRequestId` uuid 退款申请 | 无 |
| `billing.subscription.refunded` | d1:1720 | `subscription_term` | 07:542、545-547、555-556 收回权益（revokeTerm / revokeTermForExternalRefund）：`admin.refundRequest.execute`、`admin.refundRequest.recordOffline`、`admin.paymentException.resolve`（补记渠道退款） | `termId` uuid 周期；`entityId` uuid 主体；`termStatus` enum(refunded, cancelled) 周期的新状态；`refundRequestId` uuid? 退款申请；`paymentExceptionId` uuid? 补记渠道退款的差异单 | 无 |
| `billing.points.granted` | d1:1720 | `billing_account` | 07:687 发放（grant_schedule → granted）：`advance`、fulfill（第 0 个月，入账入口见 5.1） | `entityId` uuid 主体（billing_account 主键）；`termId` uuid 周期；`grantScheduleId` uuid 发放计划行；`points` integer(积分) 发放数；`monthIndex` integer 第几个月 | `notify.onEvent`：m.points_changed（月度发放） |
| `billing.points.purchased` | d1:1720 | `billing_account` | 加购积分入账（fulfill，内容为积分包）：入账事务（入口见 5.1）：`hooks.wechatpay.transaction.notify`、`m.paymentOrder.sync`、`m.paymentOrder.wechatPrepay`、`m.paymentOrder.cancel`（后两者查单为已支付时就地入账）、定时器 `po.expire`（查单为已支付）、`admin.transferProof.confirm`、`admin.transferProof.approveReview`、`admin.paymentException.resolve`（补单、关联到付款单）、订阅者 `billing.applyPaymentFallback`、周期任务 `tx.unapplied_scan` | `entityId` uuid 主体；`billingOrderId` uuid 付款单；`points` integer(积分) 到账数 | `notify.onEvent`：m.points_changed |
| `billing.points.held` | d1:1720 | `billing_account` | 07:843 冻结：`m.order.create`、`m.ad.create`；超次修改的 charge：`m.ad.requestChange` | `entityId` uuid 主体；`pointHoldId` uuid 冻结单；`points` integer(积分) 冻结数；`refType` enum(point_hold.ref_type) 业务对象类型；`refId` uuid 业务对象 | 无 |
| `billing.points.captured` | d1:1720 | `billing_account` | 07:844 冻结转扣减：定时器 `order.start`（开工）、`admin.ad.assign`、超次修改（`m.ad.requestChange`） | `entityId` uuid 主体；`pointHoldId` uuid 冻结单；`points` integer(积分) 扣减数；`refType` enum(point_hold.ref_type) 业务对象类型；`refId` uuid 业务对象 | `notify.onEvent`：站内“积分已扣减” |
| `billing.points.returned` | d1:1720 | `billing_account` | 07:845-846 释放或退回：`admin.cancelRequest.execute`、`cancel.auto_execute`（随 `admin.order.cancelRequest.create`、`admin.ad.cancelRequest.create` 的提交事务）；平台原因调整 applyAdjustment | `entityId` uuid 主体；`pointHoldId` uuid 冻结单；`returnedPoints` integer(积分) 回到原批次；`convertedPoints` integer(积分) 转为加购积分；`forfeitedPoints` integer(积分) 不予退回 | `notify.onEvent`：m.points_changed |
| `billing.points.expired` | d1:1720 | `billing_account` | 期末清零：`advance`（进程内每分钟扫描、`billing.sweep.daily` 兜底） | `entityId` uuid 主体；`termId` uuid 到期的周期；`expiredPoints` integer(积分) 清零数 | `notify.onEvent`：站内“上期积分已清零”；`analytics.fromOutbox`：points_expire（按主体一条） |
| `billing.points.adjusted` | d1:1720 | `billing_account` | 积分调整入账（审批通过即入账，07:1237）：`admin.pointAdjustmentRequest.approve` | `entityId` uuid 主体；`pointAdjustmentRequestId` uuid 调整申请；`deltaPoints` integer(积分) 增减数，带符号 | `notify.onEvent`：m.points_changed |
| `billing.order_fulfilled` | d1:1720；d2:1188 | `billing_order` | fulfill() 返回 done（08:199-200）：入账事务（入口见 5.1）：`hooks.wechatpay.transaction.notify`、`m.paymentOrder.sync`、`m.paymentOrder.wechatPrepay`、`m.paymentOrder.cancel`（后两者查单为已支付时就地入账）、定时器 `po.expire`（查单为已支付）、`admin.transferProof.confirm`、`admin.transferProof.approveReview`、`admin.paymentException.resolve`（补单、关联到付款单）、订阅者 `billing.applyPaymentFallback`、周期任务 `tx.unapplied_scan`；差异单“重试履约” | `billingOrderId` uuid 付款单；`entityId` uuid 主体；`contentType` enum(billing_order.type) 付款单类型；`termId` uuid? 履约出的周期 | 无（V1.0 无订阅者（付款成功的通知挂在 billing_order.paid）） |
| `billing.plan_revision_scheduled` | d1:1720；07:1596 | `plan_revision` | 保存一条未来生效的价目修订：`admin.plan.planRevision.create` | `planRevisionId` uuid 价目修订；`planId` uuid 套餐；`effectiveAt` string(date-time) 生效时间 | 无（通知域不再订阅（d6:1723）；商家侧公告走 site_notice.announced） |
| `billing.param_change_scheduled` | d1:1720；07:1597 | `billing_param` | 保存变更集里生效时间晚于保存时刻的每一行：`admin.pricingChange.create` | `billingParamId` uuid 参数行；`changeId` uuid 变更集；`paramKey` string 参数键；`effectiveAt` string(date-time) 生效时间 | 无（V1.0 无订阅者；公告走 site_notice.announced） |
| `pricing.drama_price_changed` | d1:717、1720；07:1598 | drama_price_revision 或 drama | 三种来源：单部调价（`cause = revision`，聚合 drama_price_revision）——定时器 `pricing.drama_price_effective` 到点、立即生效的 `admin.drama.dramaPriceRevision.create`；热度等级变化（`tier_change`，聚合 drama）——订阅者 `billing.onTierChanged`；等级模板价保存即生效（`tier_template`，聚合 drama，A93）——`admin.pricingChange.create` 对每部按模板定价且积分价实际变化的剧各发一条 | `dramaId` uuid 短剧；`dramaPriceRevisionId` uuid? 调价修订（后两种为空）；`cause` enum(revision, tier_change, tier_template) 起因；`effectiveAt` string(date-time) 生效时刻 | `notify.onEvent`：找出选剧单里有该剧的老板发站内变价提示（原型调价 toast“选剧单中的商家将收到变价提示”；d1:717；场景待 a09 补登）。选剧单行上的“积分价有变”仍由读侧比对 cart_item.price_acked_at |

### 3.8 付款、退款、对账与发票（08）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `payment_txn.succeeded` | d2:1188 | `payment_txn` | 08:317 渠道成功 recordChannelSuccess：`hooks.wechatpay.transaction.notify`、`m.paymentOrder.sync`、`m.paymentOrder.wechatPrepay`（换付款人关旧尝试前查单）、`m.paymentOrder.cancel`（取消前查单）、定时器 `po.expire`（关单前查单）；08:319 对账补建：周期任务 `bill.download` | `paymentTxnId` uuid 收款交易；`billingOrderId` uuid? 付款单（孤儿交易为空）；`amountFen` integer(分) 渠道实收；`channel` enum(payment_txn.channel) 渠道 | `billing.applyPaymentFallback`：未入账时 applyPayment |
| `billing_order.created` | 本稿补（08:162-163） | `billing_order` | 08:162-163：`m.paymentOrder.create`、`admin.paymentOrder.create`；差异单“重建付款单”（`admin.paymentException.resolve`，新单的 `rebuilt_from` 指向原单） | `billingOrderId` uuid 付款单；`entityId` uuid 主体；`storeId` uuid? 下单门店；`orderType` enum(billing_order.type) 类型；`channel` enum(billing_order.channel) 渠道；`amountFen` integer(分) 应付；＋迁移键 | 无 |
| `billing_order.paid` | d2:1188；d6 写作 payment.paid（d6:233、1843；14:752） | `billing_order` | 08:164、171、173、174、176：入账事务（入口见 5.1）：`hooks.wechatpay.transaction.notify`、`m.paymentOrder.sync`、`m.paymentOrder.wechatPrepay`、`m.paymentOrder.cancel`（后两者查单为已支付时就地入账）、定时器 `po.expire`（查单为已支付）、`admin.transferProof.confirm`、`admin.transferProof.approveReview`、`admin.paymentException.resolve`（补单、关联到付款单）、订阅者 `billing.applyPaymentFallback`、周期任务 `tx.unapplied_scan` | `billingOrderId` uuid 付款单；`entityId` uuid 主体；`storeId` uuid? 门店；`orderType` enum(billing_order.type) 类型；`channel` enum(billing_order.channel) 渠道；`amountFen` integer(分) 实付；`paidPaymentTxnId` uuid 入账交易；`placedByUserId` uuid? 发起人（代建为空）；＋迁移键 | `notify.onEvent`：m.pay_success；`analytics.fromOutbox`：plan_purchase / points_topup；`billing.uploadShippingInfo`：发货信息上报（开关） |
| `billing_order.cancelled` | d2:1188 | `billing_order` | 08:165、166、175：`m.paymentOrder.cancel`；定时器 `po.expire`、`po.transfer_ttl`；收款金额或付款人不符（入账函数，入口见 5.1：回调、`m.paymentOrder.sync` / `wechatPrepay` / `cancel` 的查单、`po.expire` 的查单等） | `billingOrderId` uuid 付款单；`entityId` uuid 主体；`cancelReason` enum(billing_order.cancel_reason) 原因；＋迁移键 | 无 |
| `billing_order.refunded` | d2:1188 | `billing_order` | 08:177 入账收款累计退款 ≥ 实付：退款交易成功（08:529、531、669：`hooks.wechatpay.refund.notify`、定时器 `rf.poll`、周期任务 `bill.download`）、`admin.refundRequest.recordOffline`、`admin.paymentException.resolve`（补记渠道退款） | `billingOrderId` uuid 付款单；`entityId` uuid 主体；`refundedFen` integer(分) 累计已退；＋迁移键 | 无 |
| `billing_order.fulfillment_blocked` | billing_order.fulfillment_exception（d2:1188） | `billing_order` | 08:199 fulfill() 返回 blocked（同事务开 fulfillment_blocked 差异单）：入账事务（入口见 5.1）：`hooks.wechatpay.transaction.notify`、`m.paymentOrder.sync`、`m.paymentOrder.wechatPrepay`、`m.paymentOrder.cancel`（后两者查单为已支付时就地入账）、定时器 `po.expire`（查单为已支付）、`admin.transferProof.confirm`、`admin.transferProof.approveReview`、`admin.paymentException.resolve`（补单、关联到付款单）、订阅者 `billing.applyPaymentFallback`、周期任务 `tx.unapplied_scan` | `billingOrderId` uuid 付款单；`entityId` uuid 主体；`paymentExceptionId` uuid 差异单 | 无（财务待办由同事务的 payment_exception.opened 通知；V1.0 无订阅者） |
| `transfer.proof_submitted` | d2:1188；01:652 | `transfer_proof` | 08:167、403：`m.paymentOrder.transferProof.create`、`admin.paymentOrder.transferProof.create` | `transferProofId` uuid 凭证；`billingOrderId` uuid 付款单；`entityId` uuid 主体；`dueAt` string(date-time)? 财务处理截止时间 | `notify.onEvent`：s.receipt_pending：通知财务。注：回单识别在上传事务里经 media 发起（08:403），不由本事件触发 |
| `transfer.rejected` | d2:1188；01:652 | `transfer_proof` | 08:170、409：`admin.transferProof.reject` | `transferProofId` uuid 凭证；`billingOrderId` uuid 付款单；`entityId` uuid 主体；`reasonCodes` array<string> 字典 reject_reason（场景 transfer） | `notify.onEvent`：站内“对公收款驳回” |
| `transfer.sla_breached` | 本稿补（d3 T32；M22） | `transfer_proof` | 定时器 `sla.breach`（主体 transfer_proof）到点且仍 pending | `transferProofId` uuid 凭证；`billingOrderId` uuid 付款单；`dueAt` string(date-time) 截止时间 | `notify.onEvent`：s.finance_overdue：提醒财务 |
| `refund_txn.created` | refund_txn.submit（d2:1188；01:653） | `refund_txn` | 08:661 执行微信原路退（三段式第 ① 步）：`admin.refundRequest.execute` | `refundTxnId` uuid 退款交易；`refundRequestId` uuid? 退款申请；`amountFen` integer(分) 退款金额 | `billing.submitRefundTxn`：内联提交失败时补提交并登记 rf.poll |
| `refund.submitted` | 本稿补（08:523） | `refund_request` | 08:523：`admin.paymentOrder.refundRequest.create`、`admin.paymentException.resolve`（转退款） | `refundRequestId` uuid 退款申请；`approvalRequestId` uuid 审批单；`ruleCode` enum(refund_request.rule_code) 退款规则；`amountFen` integer(分) 退款金额；`billingOrderId` uuid? 付款单；＋迁移键 | 无 |
| `refund.approved` | d2:1188 | `refund_request` | 08:524：`admin.refundRequest.approve` | `refundRequestId` uuid 退款申请；`execDueAt` string(date-time) 执行截止时间；＋迁移键 | 无 |
| `refund.rejected` | d2:1188；d6:249 | `refund_request` | 08:525：`admin.refundRequest.reject` | `refundRequestId` uuid 退款申请；`billingOrderId` uuid? 付款单；`entityId` uuid? 主体；＋迁移键 | `notify.onEvent`：m.refund_result |
| `refund.withdrawn` | refund.cancelled（d2:1188） | `refund_request` | 08:526：`admin.refundRequest.withdraw` | `refundRequestId` uuid 退款申请；＋迁移键 | 无 |
| `refund.voided` | refund.cancelled（d2:1188） | `refund_request` | 08:530：`admin.refundRequest.void` | `refundRequestId` uuid 退款申请；＋迁移键 | 无 |
| `refund.execution_started` | 本稿补（08:527） | `refund_request` | 08:527：`admin.refundRequest.execute` | `refundRequestId` uuid 退款申请；`refundTxnId` uuid 退款交易；＋迁移键 | 无 |
| `refund.completed` | refund.done（d2:1188；d6:249） | `refund_request` | 08:528：`admin.refundRequest.recordOffline`；08:531 退款交易成功：`hooks.wechatpay.refund.notify`、定时器 `rf.poll`、周期任务 `bill.download`（账单得到成功）；08:529 退款回调晚到（申请已回到待执行，`fromState = pending_execution`，A102）：`hooks.wechatpay.refund.notify`、`bill.download` | `refundRequestId` uuid 退款申请；`billingOrderId` uuid? 付款单；`entityId` uuid? 主体；`amountFen` integer(分) 退款金额；＋迁移键 | `notify.onEvent`：m.refund_result |
| `refund.execution_failed` | 本稿补（08:532） | `refund_request` | 08:532 退款交易到达失败终态：`hooks.wechatpay.refund.notify`、定时器 `rf.poll`、`admin.refundRequest.confirmNotAccepted`、命令行 `refund:abandon-txn` | `refundRequestId` uuid 退款申请；`refundTxnId` uuid 退款交易；`txnStatus` enum(closed, not_accepted, abandoned) 失败终态；＋迁移键 | 无（财务跟进靠退款告警与 exec_error，V1.0 无订阅者） |
| `payment_exception.opened` | exception.opened（d2:1188） | `payment_exception` | 08:760：入账函数（入口见 5.1）与回调（金额或付款人不符、取消后到账、重复收款、履约受阻、状态不符、超额退款、迟到成功、退款金额不符；键按 h01 2.6）；查单发现同类事实（`m.paymentOrder.sync` / `wechatPrepay` / `cancel`、定时器 `po.expire`、`rf.poll`，`detected_by = query`，同一套键）；周期任务 `bill.download` 与“重新对账” `admin.reconciliation.rerun`（对账差异）；`admin.transferProof.confirm` / `approveReview`、`admin.paymentException.resolve`（处理中发现的新差异）；`admin.paymentException.create`（登记异常到账）。同键已有差异单时不再开、不发事件 | `paymentExceptionId` uuid 差异单；`kind` enum(payment_exception.kind) 差异类型；`billingOrderId` uuid? 付款单；`paymentTxnId` uuid? 交易；`amountFen` integer(分) 涉及金额；＋迁移键 | `notify.onEvent`：s.payment_exception：企业微信通知财务 |
| `payment_exception.auto_healed` | 本稿补（08:761、767、768） | `payment_exception` | 08:761 对账自愈留痕：定时器 `po.expire`、`m.paymentOrder.sync` / `wechatPrepay` / `cancel` 查单补记、`bill.download`；08:767 入账函数重新归类（入口见 5.1）；08:768 后续账单出现该行：`bill.download`、`admin.reconciliation.rerun` | `paymentExceptionId` uuid 差异单；＋迁移键 | 无 |
| `payment_exception.refund_requested` | 本稿补（08:762） | `payment_exception` | 08:762 转退款：`admin.paymentException.resolve` | `paymentExceptionId` uuid 差异单；`refundRequestId` uuid 生成的退款申请；＋迁移键 | `notify.onEvent`：通知商家“已发起原路退款”（站内；原型对账页 toast“已发起原路退款……已通知商家”；场景待 a09 补登）。孤儿收款（没有主体）不发 |
| `payment_exception.reopened` | 本稿补（08:764） | `payment_exception` | 08:764 退款申请未执行即关闭：`admin.refundRequest.reject`、`admin.refundRequest.withdraw`、`admin.refundRequest.void` | `paymentExceptionId` uuid 差异单；＋迁移键 | 无 |
| `payment_exception.resolved` | 本稿补（08:763、765、766） | `payment_exception` | 08:765-766：`admin.paymentException.resolve`；08:763 退款申请完成（08:531 的回调、`rf.poll`、`bill.download`；08:529 回调晚到；`admin.refundRequest.recordOffline`） | `paymentExceptionId` uuid 差异单；`resolution` enum(payment_exception.resolution) 处理方式；＋迁移键 | 无 |
| `invoice.requested` | 本稿补（08:1110） | `invoice_request` | 08:1110：`m.invoiceRequest.create` | `invoiceRequestId` uuid 开票申请；`billingOrderId` uuid 付款单；`entityId` uuid 主体；`dueAt` string(date-time)? 财务处理截止时间；＋迁移键 | 无 |
| `invoice.issued` | d2:1188；08:1213；01:656 | `invoice_doc` | 08:1111-1112 开具（电子或纸质），聚合取新建的蓝字票据行：`admin.invoiceRequest.issue` | `invoiceDocId` uuid 票据；`invoiceRequestId` uuid 开票申请；`entityId` uuid 主体；`medium` enum(invoice_request.medium) 介质；`needsEmail` boolean 是否要发邮件（电子且填了邮箱） | `notify.onEvent`：m.invoice_issued；needsEmail 时经 mail 通道发邮件（R14） |
| `invoice.rejected` | d2:1188 | `invoice_request` | 08:1113：`admin.invoiceRequest.reject`；08:1114 付款单退款成功（系统，`reject_kind = order_refunded`；随 `billing_order.refunded` 的同一事务，触发方见该行，含 08:529 回调晚到） | `invoiceRequestId` uuid 开票申请；`entityId` uuid 主体；`rejectKind` enum(invoice_request.reject_kind) 人工或系统；＋迁移键 | `notify.onEvent`：站内“发票驳回” |
| `invoice.red_requested` | 本稿补（08:1115） | `invoice_request` | 08:1115：`admin.refundRequest.approve`（入账收款的退款）；`admin.paymentException.resolve`（补记渠道退款使付款单全额退款） | `invoiceRequestId` uuid 开票申请；`refundRequestId` uuid? 退款申请；＋迁移键 | 无 |
| `invoice.red_issued` | 本稿补（08:1116） | `invoice_doc` | 08:1116 回填红字发票：`admin.invoiceRequest.issueRed` | `invoiceDocId` uuid 红字票据；`invoiceRequestId` uuid 开票申请 | 无 |
| `invoice.red_cancelled` | 本稿补（08:1117） | `invoice_request` | 08:1117 退款申请未执行即关闭：实际只有 `admin.refundRequest.void`（`red_pending` 在审批通过时才进入，驳回、撤回都发生在审批通过之前，与 a07 一致） | `invoiceRequestId` uuid 开票申请；＋迁移键 | 无 |
| `invoice.sla_breached` | 本稿补（M22） | `invoice_request` | 定时器 `sla.breach`（主体 invoice_request）到点且仍 pending | `invoiceRequestId` uuid 开票申请；`dueAt` string(date-time) 截止时间 | `notify.onEvent`：s.finance_overdue：提醒财务 |
| `recon.day_closed` | d2:1188 | `recon_day` | 周期任务 `bill.download` 解析并完成当日匹配（08:856）；“重新对账”重跑后 | `reconDayId` uuid 对账日行；`bizDate` string(date) 账单日；`status` enum(recon_day.status) 结论；`diffCount` integer 差异数 | 无（V1.0 无订阅者） |
| `finance_config.proposed` | d2:1188 | `finance_config_revision` | 08:1279 提议：`admin.financeConfigRevision.create` | `financeConfigRevisionId` uuid 配置版本；`configKey` string 配置键；`approvalRequestId` uuid 审批单 | `notify.onEvent`：通知全体财务与超级管理员 |
| `finance_config.approved` | d2:1188 | `finance_config_revision` | 08:1280 批准：`admin.financeConfigRevision.approve` | `financeConfigRevisionId` uuid 配置版本；`configKey` string 配置键；`effectiveAt` string(date-time) 生效时间 | `notify.onEvent`：通知全体财务与超级管理员 |

### 3.9 订购、取消与广告（09）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `order.submitted` | d3:2712 | `drama_order` | 09:196、351：`m.order.create` | `dramaOrderId` uuid 订购单；`entityId` uuid 主体；`storeId` uuid 门店；`orderItemIds` array<uuid> 订单项；`totalPoints` integer(积分) 冻结合计；`placedByUserId` uuid 下单人；＋迁移键 | `notify.onEvent`：m.order_submitted；`analytics.fromOutbox`：order_submit |
| `order.started` | d3:2714 | `drama_order` | 09:197、352 开工：定时器 `order.start` | `dramaOrderId` uuid 订购单；`entityId` uuid 主体；`storeId` uuid 门店；`orderItemIds` array<uuid> 开工的订单项；`deliveryTicketIds` array<uuid> 同事务建的工单；＋迁移键 | ★`docs.onLicenseFacts`：对齐授权书；`notify.onEvent`：通知商家；通知交付经理或主管 |
| `order.status_changed` | d3:2716 | `drama_order` | 09:183-201 推导出的订购单状态变化：随订单项与在途取消的写入（各接口、定时器 `order.start`、取消执行） | `dramaOrderId` uuid 订购单；＋迁移键 | 无（工作台为读侧查询，V1.0 无订阅者） |
| `order.rejected_stale` | 本稿补（d3 N4，d3:698） | `drama_order` | 定时器 `order.rejected_stale` 到点且仍待开工、门店资质仍为驳回 | `dramaOrderId` uuid 订购单；`storeId` uuid 门店；`rejectedAt` string(date-time) 驳回时间 | `notify.onEvent`：s.kf_todo：客服待办“待开工订购超期未补正” |
| `order.item.cancelled` | d3:2715 | `order_item` | 09:353 取消执行（release）：`admin.cancelRequest.execute`、`cancel.auto_execute` | `orderItemId` uuid 订单项；`dramaOrderId` uuid 订购单；`cancelRequestId` uuid 取消申请；`returnedPoints` integer(积分) 回到原批次；`convertedPoints` integer(积分) 转加购；`forfeitedPoints` integer(积分) 不予退回；＋迁移键 | ★`docs.onLicenseFacts`：对齐授权书；`notify.onEvent`：通知商家 |
| `order.item.refunded` | d3:2715 | `order_item` | 09:354 取消执行且实际退回 > 0：`admin.cancelRequest.execute`；09:358 平台原因终止过的订单项归档（系统求值） | `orderItemId` uuid 订单项；`dramaOrderId` uuid 订购单；`cancelRequestId` uuid? 取消申请；`returnedPoints` integer(积分) 回到原批次；`convertedPoints` integer(积分) 转加购；`forfeitedPoints` integer(积分) 不予退回；＋迁移键 | ★`docs.onLicenseFacts`：对齐授权书；`notify.onEvent`：通知商家 |
| `order.item.terminated` | d3:2715 | `order_item` | 09:354 取消执行且实际退回为 0：`admin.cancelRequest.execute` | `orderItemId` uuid 订单项；`dramaOrderId` uuid 订购单；`cancelRequestId` uuid 取消申请；＋迁移键 | ★`docs.onLicenseFacts`：对齐授权书；`notify.onEvent`：通知商家 |
| `order.item.went_live` | item.live（d3:2725） | `order_item` | 09:356 首个账号核验通过（系统求值）：`admin.launchSubmission.approve` | `orderItemId` uuid 订单项；`dramaOrderId` uuid 订购单；`usageStartDate` string(date) 使用期起点；＋迁移键 | ★`docs.onLicenseFacts`：对齐授权书（go_live 版次）；`notify.onEvent`：通知商家 |
| `order.item.live_revoked` | item.live_revoked（d3:2725） | `order_item` | 09:357 撤销核验后不再有已上线账号：`admin.launchSubmission.revoke` | `orderItemId` uuid 订单项；`dramaOrderId` uuid 订购单；＋迁移键 | ★`docs.onLicenseFacts`：对齐授权书（起始日清空）；`notify.onEvent`：通知商家 |
| `order.item.usage_end_changed` | item.usage_end_changed（d3:2726） | `order_item` | 使用期止日改写（不是状态迁移）：定时器 `usage.resync`（版权续期）；平台原因终止 `admin.cancelRequest.execute` | `orderItemId` uuid 订单项；`dramaOrderId` uuid 订购单；`prevEndDate` string(date) 原止日；`newEndDate` string(date) 新止日；`usageEndSource` enum(order_item.usage_end_source) 止日来源 | ★`docs.onLicenseFacts`：对齐授权书（period_changed 版次）；`notify.onEvent`：通知商家 |
| `order.item.launch_rescheduled` | 第三轮补（a05 3.37；初稿 item.launch_rescheduled 违反 N3） | `order_item` | 改约定上线日 `order_item.agreed_launch_date`（不是状态迁移，E3）：`admin.orderItem.rescheduleLaunch` | `orderItemId` uuid 订单项；`dramaOrderId` uuid 订购单；`prevDate` string(date)? 原约定上线日；`newDate` string(date) 新约定上线日。注：改期原因是自由文本，不进载荷（P5） | `notify.onEvent`：通知商家新的上线日（m.order_progress，待 a09 补进该场景的触发） |
| `cancel.submitted` | 本稿补（迁移码 cancel.submit） | `cancel_request` | 09:547：`admin.order.cancelRequest.create`、`admin.ad.cancelRequest.create`、`m.cancelRequest.create`（V1.1）；系统生成整店取消（`order.onQualificationDecided`） | `cancelRequestId` uuid 取消申请；`approvalRequestId` uuid 审批单；`kind` enum(order_cancel, ad_cancel, qualification_cancel) 类型；`subjectType` enum(drama_order, ad, store) 对象类型；`subjectId` uuid 对象；`totalRefundPoints` integer(积分) 预计退回合计；＋迁移键 | 无（审批人通知由 approval.submitted 承担） |
| `cancel.approved` | 本稿补 | `cancel_request` | 09:548：`admin.cancelRequest.approve` | `cancelRequestId` uuid 取消申请；`execDueAt` string(date-time) 执行截止时间；＋迁移键 | 无 |
| `cancel.rejected` | 本稿补 | `cancel_request` | 09:549：`admin.cancelRequest.reject` | `cancelRequestId` uuid 取消申请；＋迁移键 | 无 |
| `cancel.withdrawn` | 本稿补 | `cancel_request` | 09:550：`admin.cancelRequest.withdraw`；对象失效时系统代撤（如主体关闭 `admin.entity.close` 撤回其下待审批的取消申请） | `cancelRequestId` uuid 取消申请；＋迁移键 | 无 |
| `cancel.executed` | 本稿补（迁移码 cancel.execute、cancel.auto_execute） | `cancel_request` | 09:551：`admin.cancelRequest.execute`；09:553：`cancel.auto_execute`（免审批，随 `admin.order.cancelRequest.create`、`admin.ad.cancelRequest.create` 的提交事务） | `cancelRequestId` uuid 取消申请；`isAutoExecuted` boolean 免审批自动执行；＋迁移键 | 无（各订单项、广告的结果另由 order.item.*、ad.cancelled 发出） |
| `cancel.voided` | 本稿补 | `cancel_request` | 09:552：`admin.cancelRequest.void`；对象失效时系统 | `cancelRequestId` uuid 取消申请；＋迁移键 | 无 |
| `ad.requested` | d3:2721 | `ad` | 09:801：`m.ad.create` | `adId` uuid 广告；`entityId` uuid 主体；`storeId` uuid 门店；`adType` enum(ad.type) 类型；`points` integer(积分) 冻结数；＋迁移键 | `notify.onEvent`：通知交付经理；`analytics.fromOutbox`：ad_request_submit |
| `ad.assigned` | d3:2721 | `ad` | 09:802：`admin.ad.assign` | `adId` uuid 广告；`editorId` uuid 剪辑师；＋迁移键 | `notify.onEvent`：通知剪辑师 |
| `ad.returned` | d3:2721 | `ad` | 09:803：`admin.ad.return` | `adId` uuid 广告；`returnedFrom` enum(pending_assign, producing) 退回前状态；＋迁移键（退回原因是自由文本 `ad.return_reason`，不进载荷（P5），订阅者回库读） | `notify.onEvent`：通知商家补充素材；`support.onBizEvent`：关联工单时间线 |
| `ad.resubmitted` | 本稿补（迁移码 ad.resubmit） | `ad` | 09:804：`m.ad.submit` | `adId` uuid 广告；`resubmitCount` integer 补充次数；＋迁移键 | `notify.onEvent`：通知剪辑师或交付经理 |
| `ad.version_pushed` | d3:2721 | `ad` | 09:805：`admin.adVersion.push` | `adId` uuid 广告；`versionNo` integer 版本号；`previewChannels` array<string> 查看方式；＋迁移键 | `notify.onEvent`：m.ad_pending（节点 N0）；`support.onBizEvent`：关联工单时间线 |
| `ad.confirmed` | d3:2721 | `ad` | 09:806：`m.ad.confirm` | `adId` uuid 广告；`versionNo` integer 确认的版本号；`viewedVia` enum(ad_version.confirm_viewed_via) 查看方式；＋迁移键 | `notify.onEvent`：通知剪辑师与交付经理；`support.onBizEvent`：关联工单时间线；`analytics.fromOutbox`：ad_confirm。注：浮动绑定工单的 reevaluate 在同一事务里调用，不经订阅 |
| `ad.revision_requested` | d3:2721 | `ad` | 09:807：`m.ad.requestChange`、`admin.ad.requestChange`（代录）；样片的广告内容类修改意见 `admin.sample.requestChange`（`feedbackKind = ad_content`，A59） | `adId` uuid 广告；`revisionNo` integer 修改轮次；`onVersionNo` integer 针对的版本；`isCharged` boolean 是否超次收费；＋迁移键 | `notify.onEvent`：通知剪辑师；`support.onBizEvent`：关联工单时间线 |
| `ad.cancelled` | d3:2721 | `ad` | 09:808-809 取消申请执行：`admin.cancelRequest.execute`；免审批自动执行 `cancel.auto_execute`（随 `admin.ad.cancelRequest.create` 的提交事务） | `adId` uuid 广告；`cancelRequestId` uuid 取消申请；`returnedPoints` integer(积分) 退回；`forfeitedPoints` integer(积分) 不予退回；＋迁移键 | `notify.onEvent`：通知商家；`support.onBizEvent`：关联工单时间线 |
| `ad.returned_stale` | d3:2721 | `ad` | 定时器 `ad.returned_stale` 到点且仍待补充 | `adId` uuid 广告；`storeId` uuid 门店；`returnedAt` string(date-time) 退回时间 | `notify.onEvent`：s.kf_todo：客服待办“广告待补充素材超期” |
| `ad.sla_breached` | d3:2718 | `ad` | 定时器 `sla.breach`（主体 ad，首版或修改版）到点且未满足 | `adId` uuid 广告；`purpose` enum(first, revision) 首版或修改版；`revisionNo` integer? 修改轮次；`dueAt` string(date-time) 截止时间 | `notify.onEvent`：通知剪辑师、交付经理与主管 |

### 3.10 交付（10）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `ticket.created` | d3:2717 | `delivery_ticket` | 10:196 开工建工单：定时器 `order.start` | `deliveryTicketId` uuid 交付工单；`dramaOrderId` uuid 订购单（客服时间线匹配用）；`orderItemId` uuid 订单项；`deliveryManagerId` uuid? 交付经理；＋迁移键 | `notify.onEvent`：通知交付经理或交付主管（待分配）；`support.onBizEvent`：关联工单时间线 |
| `ticket.assigned` | d3:2717 | `delivery_ticket` | 10:172：`admin.deliveryTicket.assignManager`；门店首次指派交付经理时同事务分配本门店待分配的工单（`admin.store.assignDeliveryManager`，a03 3.8a，与 a05 3.20 共用实现） | `deliveryTicketId` uuid 交付工单；`dramaOrderId` uuid 订购单；`deliveryManagerId` uuid 交付经理；＋迁移键 | `notify.onEvent`：s.work_ticket_assigned；`support.onBizEvent`：关联工单时间线 |
| `ticket.step_changed` | d3:2717 | `delivery_ticket` | 10:173-187、193-194 其余步骤迁移：各接口（方案确认、样片推送与确认、返工、推送成片包、核验）、`flow.reevaluate()`（同事务求值，如 `m.ad.confirm`、`m.ad.requestChange`、`admin.ad.requestChange`、`admin.sample.requestChange`、`m.takedownTask.confirm`；手工 `admin.deliveryTicket.reevaluate`）、定时器 `usage.end`、`admin.deliveryTicket.forceTransition`。10:172 只发 `ticket.assigned`（E2） | `deliveryTicketId` uuid 交付工单；`dramaOrderId` uuid 订购单；`orderItemId` uuid 订单项；`isForced` boolean 人工纠偏（默认不通知商家）；＋迁移键（返工由 `transition = ticket.rework` 识别，不另设键） | `notify.onEvent`：通知负责人；`support.onBizEvent`：关联工单时间线 |
| `ticket.held` | d3:2719 | `delivery_ticket` | 10:189 加暂停原因：取消申请提交（`admin.order.cancelRequest.create`、`m.cancelRequest.create`（V1.1）、订阅者 `order.onQualificationDecided` 的整店取消）、方案修订（`admin.deliveryPlan.push` 从已确认修订） | `deliveryTicketId` uuid 交付工单；`orderItemId` uuid 订单项；`reason` enum(delivery_ticket_pause.reason) 暂停原因；`refType` string 原因引用的表；`refId` uuid 原因引用的行；＋迁移键 | ★`docs.onLicenseFacts`：对齐授权书（信号，结果由收敛函数定）；`notify.onEvent`：通知负责人 |
| `ticket.resumed` | d3:2719 | `delivery_ticket` | 10:190 解除暂停原因：取消申请驳回、撤回、作废（`admin.cancelRequest.reject` / `withdraw` / `void`）、方案确认（`m.deliveryPlan.confirm`） | `deliveryTicketId` uuid 交付工单；`orderItemId` uuid 订单项；`reason` enum(delivery_ticket_pause.reason) 解除的原因；`refId` uuid 原因引用的行；＋迁移键 | ★`docs.onLicenseFacts`：对齐授权书（信号）；`notify.onEvent`：通知负责人 |
| `ticket.terminated` | d3:2719 | `delivery_ticket` | 10:191-192 取消执行终止：`admin.cancelRequest.execute` | `deliveryTicketId` uuid 交付工单；`orderItemId` uuid 订单项；`cancelRequestId` uuid 取消申请；＋迁移键 | ★`docs.onLicenseFacts`：对齐授权书；`notify.onEvent`：通知负责人 |
| `ticket.archived` | d3:2719 | `delivery_ticket` | 10:188 下架任务全部已核查（系统求值）：`admin.takedownTask.check`、`admin.takedownTask.batchCheck` 同事务的 reevaluate；抽查未抽中放行（`takedown.sample_release`，随 `m.takedownTask.confirm`） | `deliveryTicketId` uuid 交付工单；`orderItemId` uuid 订单项；`itemPhase` enum(ended, refunded) 订单项的终局阶段；＋迁移键 | ★`docs.onLicenseFacts`：对齐授权书；`notify.onEvent`：通知商家与负责人 |
| `ticket.sla_breached` | d3:2718 | `delivery_ticket` | 定时器 `sla.breach`（主体 delivery_ticket_stage）到点且环节仍未完成、工单未暂停 | `deliveryTicketId` uuid 交付工单；`deliveryTicketStageId` uuid 环节记录；`step` enum(delivery_ticket.step) 环节；`dueAt` string(date-time) 截止时间 | `notify.onEvent`：s.step_overdue |
| `ticket.episode_qc_failed` | 第三轮补（a05 3.31；初稿 episode.qc_failed 违反 N3） | `delivery_ticket` | 成片逐集质检有不通过的行（不是状态迁移，E3；质检通过使批次进入下一步时另发 `ticket.step_changed`）：`admin.deliveryTicket.inspectEpisodes` | `deliveryTicketId` uuid 交付工单；`orderItemId` uuid 订单项；`episodeNos` array<integer> 不通过的集号；`qcRecordIds` array<uuid> 不通过的质检记录 | `notify.onEvent`：通知剪辑师（s.delivery_progress，待 a09 补进该场景的触发） |
| `plan.pushed` | d3:2720 | `delivery_plan` | 10:417：`admin.deliveryPlan.push` | `deliveryPlanId` uuid 方案；`dramaOrderId` uuid 订购单；`versionNo` integer 推送的版本号；＋迁移键 | `notify.onEvent`：m.plan_pending |
| `plan.change_requested` | d3:2720 | `delivery_plan` | 10:419：`m.deliveryPlan.requestChange` | `deliveryPlanId` uuid 方案；`dramaOrderId` uuid 订购单；`versionNo` integer 针对的版本号；＋迁移键 | `notify.onEvent`：通知交付经理 |
| `plan.confirmed` | d3:2720 | `delivery_plan` | 10:418：`m.deliveryPlan.confirm` | `deliveryPlanId` uuid 方案；`dramaOrderId` uuid 订购单；`versionNo` integer 确认的版本号；＋迁移键 | ★`docs.onLicenseFacts`：账号集合变化时对齐授权书；`notify.onEvent`：通知交付经理；`analytics.fromOutbox`：plan_confirm |
| `sample.uploaded` | 10:651 建议名（迁移码 sample.uploaded） | `sample` | 10:640：`admin.deliveryTicket.sample.create` | `sampleId` uuid 样片；`deliveryTicketId` uuid 交付工单；`dramaOrderId` uuid 订购单；`versionNo` integer 版本号；＋迁移键 | 无 |
| `sample.check_rejected` | 10:651 建议名 | `sample` | 10:641 入库体检拒收：订阅者 `delivery.onProductionChecked` | `sampleId` uuid 样片；`deliveryTicketId` uuid 交付工单；`versionNo` integer 版本号；＋迁移键 | `notify.onEvent`：通知剪辑师重新上传 |
| `sample.qc_failed` | 10:651 建议名 | `sample` | 10:642：`admin.sample.inspect` | `sampleId` uuid 样片；`deliveryTicketId` uuid 交付工单；`versionNo` integer 版本号；＋迁移键 | `notify.onEvent`：通知剪辑师 |
| `sample.qc_passed` | 10:651 建议名 | `sample` | 10:643：`admin.sample.inspect` | `sampleId` uuid 样片；`deliveryTicketId` uuid 交付工单；`versionNo` integer 版本号；＋迁移键 | 无 |
| `sample.pushed` | d3:2722 | `sample` | 10:644：`admin.sample.push` | `sampleId` uuid 样片；`deliveryTicketId` uuid 交付工单；`dramaOrderId` uuid 订购单；`versionNo` integer 版本号；`previewChannels` array<string> 查看方式；＋迁移键 | `notify.onEvent`：m.sample_pending（节点 N0）；`support.onBizEvent`：关联工单时间线 |
| `sample.confirmed` | d3:2722 | `sample` | 10:645：`m.sample.confirm` | `sampleId` uuid 样片；`deliveryTicketId` uuid 交付工单；`dramaOrderId` uuid 订购单；`versionNo` integer 版本号；`viewedVia` enum(sample.confirm_viewed_via) 查看方式；＋迁移键 | `notify.onEvent`：通知交付经理；`support.onBizEvent`：关联工单时间线；`analytics.fromOutbox`：sample_confirm |
| `sample.change_requested` | d3:2722 | `sample` | 10:646-647：`m.sample.requestChange`、`admin.sample.requestChange`（代录） | `sampleId` uuid 样片；`deliveryTicketId` uuid 交付工单；`dramaOrderId` uuid 订购单；`versionNo` integer 版本号；`feedbackKind` enum(sample.feedback_kind) 合成问题或广告内容；＋迁移键 | `notify.onEvent`：通知交付经理与剪辑师；`support.onBizEvent`：关联工单时间线；`analytics.fromOutbox`：sample_confirm（结果为修改） |
| `sample.superseded` | 10:651 建议名 | `sample` | 10:648-649：上传新版本（`admin.deliveryTicket.sample.create`）、广告重新打开（`flow.reevaluate()`，随 `m.ad.requestChange`、`admin.ad.requestChange`、`admin.sample.requestChange`（广告内容）、`admin.deliveryTicket.reevaluate`）、主管返工（`admin.deliveryTicket.rework`） | `sampleId` uuid 样片；`deliveryTicketId` uuid 交付工单；`versionNo` integer 版本号；＋迁移键 | 无 |
| `package.delivered` | d3:2723；10:876 | `delivery_release` | 10:880、182 推送成片包：`admin.deliveryTicket.pushPackage` | `deliveryReleaseId` uuid 成片包；`deliveryTicketId` uuid 交付工单；`orderItemId` uuid 订单项；`episodeCount` integer 集数；`grantExpiresAt` string(date-time) 下载授权到期 | `notify.onEvent`：m.delivered（订阅消息 + 短信补发） |
| `package.reissued` | d3:2723；10:966 | `delivery_reissue` | 10:963、966 发布补发：`admin.reissue.publish` | `deliveryReissueId` uuid 补发单；`deliveryReleaseId` uuid 新成片包；`orderItemId` uuid 订单项；`episodeNos` array<integer> 补发的集号 | `notify.onEvent`：通知商家替换成片 |
| `package.reissue_opened` | 第三轮补（a05 3.43；初稿 reissue.opened 违反 N3，`reissue.opened` 留作工单状态历史的事件码，N4） | `delivery_reissue` | 10:962 发起补发（工单写一行 from = to 的状态历史）：`admin.deliveryTicket.reissue.create` | `deliveryReissueId` uuid 补发单；`deliveryTicketId` uuid 交付工单；`orderItemId` uuid 订单项；`episodeNos` array<integer> 要补发的集号；`reasonCode` string 字典 reissue_reason 的编码（delivery_reissue.reason_code） | `notify.onEvent`：通知剪辑师（s.delivery_progress，待 a09 补进该场景的触发） |
| `publish_list.updated` | d3:2723；10:1159 | `publish_list` | 10:1159 保存发布清单：`admin.deliveryTicket.publishList.replace`、`admin.deliveryTicket.publishList.import` | `publishListId` uuid 发布清单；`deliveryTicketId` uuid 交付工单；`isAfterPush` boolean 是否推送后修订 | `notify.onEvent`：isAfterPush 时通知商家“发布清单已更新” |

### 3.11 发布（11）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `account.submitted` | d3:2730；11:129、132 | `channel_account` | 11:129、132：`m.channelAccount.create`、`m.channelAccount.submit` | `channelAccountId` uuid 渠道账号；`entityId` uuid 主体；`storeId` uuid 门店；`platform` enum(channel_account.platform) 平台；`approvalRequestId` uuid 核验审批单；＋迁移键 | 无（发布专员待办由 approval.submitted 通知） |
| `account.verified` | d3:2730；11:130 | `channel_account` | 11:130：`admin.channelAccountSubmission.approve` | `channelAccountId` uuid 渠道账号；`entityId` uuid 主体；`storeId` uuid 门店；＋迁移键 | `notify.onEvent`：站内“渠道账号核验结果” |
| `account.abnormal` | d3:2730；11:131、133 | `channel_account` | 11:131：`admin.channelAccountSubmission.reject`；11:133：`admin.channelAccount.markAbnormal` | `channelAccountId` uuid 渠道账号；`entityId` uuid 主体；`storeId` uuid 门店；`abnormalSource` enum(channel_account.abnormal_source) 核验未过或人工标记；`reasonCode` string 原因；＋迁移键 | `notify.onEvent`：站内“渠道账号核验结果” |
| `account.unbound` | d3:2730；11:134 | `channel_account` | 11:134：`m.channelAccount.unbind` | `channelAccountId` uuid 渠道账号；`entityId` uuid 主体；`storeId` uuid 门店；＋迁移键 | 无 |
| `launch.created` | 本稿补（迁移码 launch.create） | `launch_task` | 11:299 推送成片包时每个发布账号一行：`admin.deliveryTicket.pushPackage` | `launchTaskId` uuid 上线任务；`orderItemId` uuid 订单项；`channelAccountId` uuid 发布账号；＋迁移键 | 无 |
| `launch.submitted` | d3:2724；11:300 | `launch_task` | 11:300：`m.launchTask.submit` | `launchTaskId` uuid 上线任务；`orderItemId` uuid 订单项；`deliveryTicketId` uuid 交付工单；`roundNo` integer 回填轮次；`approvalRequestId` uuid 核验审批单；＋迁移键 | `analytics.fromOutbox`：publish_link_submit |
| `launch.verified` | d3:2724；11:301 | `launch_task` | 11:301：`admin.launchSubmission.approve` | `launchTaskId` uuid 上线任务；`orderItemId` uuid 订单项；`verifiedEpisodeCount` integer 已核验集数；`isLive` boolean 是否已上线；＋迁移键 | `notify.onEvent`：m.verify_result |
| `launch.returned` | d3:2724；11:302 | `launch_task` | 11:302：`admin.launchSubmission.reject` | `launchTaskId` uuid 上线任务；`orderItemId` uuid 订单项；`reasonCodes` array<string> 退回原因；＋迁移键 | `notify.onEvent`：m.verify_result（需补充，短信补发） |
| `launch.verify_revoked` | d3:2724；11:303 | `launch_task` | 11:303：`admin.launchSubmission.revoke` | `launchTaskId` uuid 上线任务；`orderItemId` uuid 订单项；`isLive` boolean 撤销后是否仍上线；＋迁移键 | `notify.onEvent`：通知商家与发布专员 |
| `launch.voided` | 11:304 | `launch_task` | 11:304 系统收尾（delivery 在工单进入到期下架或终止的同一事务里调用）：定时器 `usage.end`、`admin.cancelRequest.execute`；下架任务全部由商家确认、工单 in_service → takedown 时随 `m.takedownTask.confirm` 的 reevaluate（10:186-187）；手工 `admin.deliveryTicket.reevaluate` | `launchTaskId` uuid 上线任务；`orderItemId` uuid 订单项；`voidReason` enum(launch_task.void_reason) 作废原因；＋迁移键 | 无 |
| `launch.settled` | 11:305 | `launch_task` | 11:305 系统收尾（同上）：定时器 `usage.end`、`admin.cancelRequest.execute`、`m.takedownTask.confirm`、`admin.deliveryTicket.reevaluate` | `launchTaskId` uuid 上线任务；`orderItemId` uuid 订单项；＋迁移键 | 无 |
| `takedown.created` | d3:2727；11:653 | `takedown_task` | 11:653：定时器 `takedown.create`；`admin.deliveryTicket.pushPackage`（交付时已不足 30 天）；进入到期下架时的 `ensureTakedownTasks`（定时器 `usage.end`；`m.takedownTask.confirm`、`admin.deliveryTicket.reevaluate` 的 reevaluate，通常已无可建的任务）；`admin.cancelRequest.execute`（终止） | `takedownTaskId` uuid 下架任务；`orderItemId` uuid 订单项；`channelAccountId` uuid 发布账号；`dueDate` string(date) 应完成日；`basis` enum(takedown_task.basis) 核查依据；`triggerKind` enum(takedown_task.trigger_kind) 生成原因；`node` enum(T-30, created) 通知节点（d3:2727）；＋迁移键 | `notify.onEvent`：m.offline_remind（与规则 R3 的 T-30 同键去重） |
| `takedown.merchant_confirmed` | d3:2727；11:654 | `takedown_task` | 11:654：`m.takedownTask.confirm` | `takedownTaskId` uuid 下架任务；`orderItemId` uuid 订单项；`merchantMethod` enum(takedown_task.merchant_method) 确认方式；＋迁移键 | `notify.onEvent`：通知发布专员核查 |
| `takedown.checked` | d3:2727；11:655-656 | `takedown_task` | 11:655：`admin.takedownTask.check`、`admin.takedownTask.batchCheck`；11:656 抽查未抽中放行（`m.takedownTask.confirm` 同事务） | `takedownTaskId` uuid 下架任务；`orderItemId` uuid 订单项；`checkMethod` enum(takedown_task.check_method) evidence 或 sampled_out；＋迁移键 | `notify.onEvent`：通知商家下架已核查 |
| `takedown.found_online` | 本稿补（迁移码 takedown.still_online） | `takedown_task` | 11:657：`admin.takedownTask.markOnline` | `takedownTaskId` uuid 下架任务；`orderItemId` uuid 订单项；`stillOnlineCount` integer 抽查仍在线次数；＋迁移键 | `notify.onEvent`：通知商家；升级交付主管 |
| `takedown.basis_reopened` | 本稿补（迁移码 takedown.basis_reopen） | `takedown_task` | 11:658 账号核验上线后退回待商家下架：`admin.launchSubmission.approve` 同事务 | `takedownTaskId` uuid 下架任务；`orderItemId` uuid 订单项；＋迁移键 | `notify.onEvent`：通知商家重新确认下架 |
| `takedown.escalated` | d3:2727；11:659 | `takedown_task` | 11:659：定时器 `takedown.overdue`；`admin.takedownTask.escalate` | `takedownTaskId` uuid 下架任务；`orderItemId` uuid 订单项；`dueDate` string(date) 应完成日；＋迁移键 | `notify.onEvent`：s.offline_overdue：通知交付主管与交付经理 |
| `takedown.breach_notified` | 本稿补（迁移码 takedown.breach_notice） | `takedown_task` | 11:660：`admin.takedownTask.sendBreachNotice` | `takedownTaskId` uuid 下架任务；`breachNoticeCount` integer 累计次数；＋迁移键 | 无（给商家的提醒由同事务写的 manual_reminder_log 发 manual_reminder.sent） |
| `takedown.voided` | 本稿补（迁移码 takedown.void） | `takedown_task` | 11:661 续期后止日前 30 天尚未到：定时器 `usage.resync` | `takedownTaskId` uuid 下架任务；`orderItemId` uuid 订单项；＋迁移键 | 无 |
| `patrol.created` | 本稿补（迁移码 patrol.create） | `patrol_task` | 11:542：周期任务 `patrol.weekly_generate`；`admin.patrolTask.create` | `patrolTaskId` uuid 巡检任务；`launchTaskId` uuid 上线任务；`orderItemId` uuid 订单项；＋迁移键 | 无 |
| `patrol.passed` | 本稿补（迁移码 patrol.ok） | `patrol_task` | 11:543：`admin.patrolTask.markNormal` | `patrolTaskId` uuid 巡检任务；`launchTaskId` uuid 上线任务；＋迁移键 | 无 |
| `patrol.abnormal` | d3:2729；11:544 | `patrol_task` | 11:544：`admin.patrolTask.markAbnormal` | `patrolTaskId` uuid 巡检任务；`launchTaskId` uuid 上线任务；`orderItemId` uuid 订单项；`abnormalKindCode` string 字典 patrol_issue；＋迁移键 | `notify.onEvent`：站内“巡检异常”通知商家 |
| `patrol.reminded` | 本稿补（迁移码 patrol.remind） | `patrol_task` | 11:545：`admin.patrolTask.remind` | `patrolTaskId` uuid 巡检任务；`remindCount` integer 累计次数；＋迁移键 | 无（给商家的提醒由同事务写的 manual_reminder_log 发 manual_reminder.sent） |
| `patrol.recovered` | d3:2729；11:546 | `patrol_task` | 11:546：`admin.patrolTask.recover` | `patrolTaskId` uuid 巡检任务；`launchTaskId` uuid 上线任务；＋迁移键 | `notify.onEvent`：通知商家已恢复 |
| `patrol.voided` | 本稿补（迁移码 patrol.void） | `patrol_task` | 11:547 系统作废（订单项终止、使用期结束或核验被撤销）：定时器 `usage.end`、`admin.cancelRequest.execute`、`admin.launchSubmission.revoke` | `patrolTaskId` uuid 巡检任务；＋迁移键 | 无 |

### 3.12 客服（12）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `service_ticket.created` | d3:2732；12:191 | `service_ticket` | 12:149-150：`m.serviceTicket.create`、`admin.serviceTicket.create` | `serviceTicketId` uuid 客服工单；`entityId` uuid 主体；`storeId` uuid 门店；`typeCode` string 字典 ticket_type；`source` enum(service_ticket.source) 提交或登记；`ownerStaffId` uuid? 分配到的负责人；＋迁移键 | `notify.onEvent`：s.kf_assigned；投诉建议类另发 s.complaint_created；`analytics.fromOutbox`：ticket_submit（只计商家提交） |
| `service_ticket.replied` | d3:2732；12:191 | `service_ticket` | 12:151 首次回复商家（pending → processing）及之后的每条回复（12:152，不改状态）：`admin.serviceTicket.entry.create`。只在员工回复商家（staff_reply）时发，内部备注不发 | `serviceTicketId` uuid 客服工单；`entryId` uuid 回复条目；`isFirstResponse` boolean 是否首次响应 | `notify.onEvent`：m.ticket_reply |
| `service_ticket.supplemented` | 第三轮补（12:191；A95、A144；m08 3.8） | `service_ticket` | 12:152 商家在处理中补充说明（不是状态迁移，不写状态历史）：`m.serviceTicket.entry.create` | `serviceTicketId` uuid 客服工单；`entryId` uuid 补充说明条目；`storeId` uuid 门店；`ownerStaffId` uuid? 当前负责人（为空时不提醒）。注：说明正文不进载荷（P5） | `notify.onEvent`：s.kf_supplemented：提醒工单负责人（原型“已发送，服务经理将收到提醒”） |
| `service_ticket.result_submitted` | d3:2732；12:191 | `service_ticket` | 12:153：`admin.serviceTicket.submitResult` | `serviceTicketId` uuid 客服工单；`autoResolveAt` string(date-time) 到期自动解决时间；＋迁移键 | `notify.onEvent`：m.ticket_reply |
| `service_ticket.resolved` | d3:2732；12:191 | `service_ticket` | 12:154：`m.serviceTicket.confirm`；12:155：定时器 `service.auto_resolve` | `serviceTicketId` uuid 客服工单；`resolvedVia` enum(service_ticket.resolved_via) 商家确认或到期自动；＋迁移键 | 无 |
| `service_ticket.reopened` | d3:2732；12:191 | `service_ticket` | 12:156：`m.serviceTicket.reopen`；12:162 人工纠偏：`admin.serviceTicket.forceTransition` | `serviceTicketId` uuid 客服工单；`round` integer reopened_count；`isForced` boolean 人工纠偏；＋迁移键 | `notify.onEvent`：通知负责人 |
| `service_ticket.closed` | d3:2732；12:191 | `service_ticket` | 12:157：`m.serviceTicket.withdraw`；12:158：`admin.serviceTicket.close` | `serviceTicketId` uuid 客服工单；`closeReason` enum(service_ticket.close_reason) 关闭原因；＋迁移键 | `notify.onEvent`：m.ticket_reply：员工关闭（`closeReason` ≠ `withdrawn`）时通知提交人，没有提交人的发给门店老板；商家撤回不通知（a08 请求；原型“工单已关闭，商家将收到通知”） |
| `service_ticket.solution_overdue` | 本稿补（d3 T9 的“提醒负责人”） | `service_ticket` | 定时器 `service.solution_due` 到点且尚无处理方案（不是状态迁移） | `serviceTicketId` uuid 客服工单；`ownerStaffId` uuid? 负责人；`solutionDueAt` string(date-time) 方案截止时间 | `notify.onEvent`：s.kf_solution_overdue：提醒负责人 |
| `service_ticket.transferred` | d3:2732；12:191 | `service_ticket` | 12:159-160（from = to）：`admin.serviceTicket.assign`、`admin.serviceTicket.reassign`；随 staff 的改派批次：员工禁用移交（`admin.staff.disable`、`admin.staff.handover`）、转移交付经理（`admin.store.reassignDeliveryManager`，A136）、`staff.I10` 自动改派 | `serviceTicketId` uuid 客服工单；`fromStaffId` uuid? 原负责人（分配时为空）；`toStaffId` uuid 新负责人；`reasonCode` string 字典 ticket_transfer_reason 的编码，随改派批次时取该批 `assignment_history.reason_code`（12:419）；`assignmentBatchId` uuid? 随改派批次时的批次号，人工分配、转派为空；＋迁移键 | `notify.onEvent`：s.kf_assigned：通知新负责人；`assignmentBatchId` 非空时与同批 `assignment.transferred` 合并提醒，接收人不重复收到 |
| `service_ticket.escalated` | d3:2732；12:191 | `service_ticket` | 12:161（from = to）：定时器 `service.first_response_due` | `serviceTicketId` uuid 客服工单；`responseDueAt` string(date-time) 超时的那一轮截止时间；＋迁移键 | `notify.onEvent`：s.kf_response_overdue |

### 3.13 通知与文书（13）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `notify.mail_delivered` | d6:950；13:1200 | `notification_delivery` | 13:431 邮件投递成功：投递任务（notify 队列） | `notificationDeliveryId` uuid 投递行；`bizType` string 业务对象类型；`bizId` uuid 业务对象 | `billing.onMailResult`：bizType = invoice_doc 时回写 email_state = sent |
| `notify.mail_failed` | d6:950；13:1200 | `notification_delivery` | 13:433-434 邮件投递失败终态：投递任务；13:436 `notify.scan` 回收 | `notificationDeliveryId` uuid 投递行；`bizType` string 业务对象类型；`bizId` uuid 业务对象；`reason` enum(notification_delivery.reason) 失败原因 | `billing.onMailResult`：bizType = invoice_doc 时回写 email_state = failed |
| `license_letter.revision_queued` | d6:1297；13:1036 | `license_letter` | 13:1036 对齐函数出新版次：订阅者 `docs.onLicenseFacts`、成片交付守卫 `docs.ensureLetters`（`admin.deliveryTicket.pushPackage` 同事务）、`admin.licenseLetter.correct`、`admin.licenseLetter.void`、`docs.N6` 自愈；13:1041 渲染失败的版次重新生成（failed → queued）：`admin.licenseLetterRevision.rerender` | `licenseLetterId` uuid 授权书；`revisionId` uuid 版次；`reason` enum(license_letter_revision.reason) 出版次的原因 | `docs.onRevisionQueued`：放入 docs 渲染队列 |
| `license_letter.issued` | d6:1353；13:1038 | `license_letter` | 13:1038 渲染、签名、上传完成：渲染任务（docs 队列） | `licenseLetterId` uuid 授权书；`revisionId` uuid 版次；`entityId` uuid 主体；`storeId` uuid 门店；`orderItemId` uuid 订单项 | `notify.onEvent`：站内“授权书已更新” |
| `license_letter.voided` | 本稿补（13:945-947） | `license_letter` | 13:945-946 对齐函数作废；13:947 `admin.licenseLetter.void` | `licenseLetterId` uuid 授权书；`voidReason` enum(license_letter.void_reason) 作废原因；＋迁移键 | 无（建信、生效、止日变化的迁移随同事务的 license_letter.revision_queued 表达，不另发） |
| `manual_reminder.sent` | 本稿补（d6:739；01:660 的“人工催办写入成功后的事件”） | `manual_reminder_log` | 人工催办写入成功：`admin.deliveryTicket.remind`、`admin.ad.remind`、`admin.patrolTask.remind`、`admin.takedownTask.sendBreachNotice`、`admin.subscriptionTerm.remind` | `manualReminderLogId` uuid 催办记录；`subjectType` string 对象表名；`subjectId` uuid 对象；`scene` enum(manual_reminder_log.scene) 催办场景；`bizDate` string(date) 业务日 | `notify.onEvent`：按 scene 映射到场景派发，节点记 M（13:139） |

### 3.14 配置、导出与报表（14）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `site_notice.announced` | d6:1714；14:528 | `site_notice` | 14:528 notices.announce（调用方事务内）：`admin.plan.planRevision.create`、`admin.pricingChange.create`、`admin.agreementVersion.schedule` | `siteNoticeId` uuid 公告；`kind` enum(site_notice.kind) 变更类型；`refId` uuid 变更行；`effectiveAt` string(date-time) 生效时间 | `notify.onEvent`：m.rule_change_notice：全部正常主体的老板，站内必达 |
| `site_notice.withdrawn` | d6:1716；14:529 | `site_notice` | 14:529 notices.withdraw：`admin.planRevision.withdraw`、`admin.billingParam.withdraw`、`admin.agreementVersion.withdraw` | `siteNoticeId` uuid 公告；`kind` enum(site_notice.kind) 变更类型；`refId` uuid 变更行 | `notify.onEvent`：站内“调整已取消” |
| `export.succeeded` | 本稿补（d6:274 的“导出完成”，事件名草案未给） | `export_job` | 14:981 文件上传完成：worker（export 队列） | `exportJobId` uuid 导出任务；`exportKey` string 导出键；`requestedByStaffId` uuid 申请人；`expiresAt` string(date-time) 文件到期 | `notify.onEvent`：s.export_ready（后台铃铛） |
| `export.failed` | 本稿补 | `export_job` | 14:983：worker；周期任务 `export.sweep` | `exportJobId` uuid 导出任务；`exportKey` string 导出键；`requestedByStaffId` uuid 申请人 | `notify.onEvent`：s.export_ready（失败文案） |

### 3.15 集成与运维（15）

| 事件名 | 草案名 / 出处 | 聚合 | 触发（迁移或接口） | 载荷（另有 `v`） | 订阅者 |
| --- | --- | --- | --- | --- | --- |
| `webhook.received` | d4:1832；15:115 | `webhook_event` | 15:115 收件箱模式新插入：`hooks.wechat.message.receive`、`hooks.wecom.event.receive`（短信状态回执定为内联，不发）。死信人工重置（15:120，`admin.webhookEvent.retry`、命令行）不发：本事件的去重键首次收件时已用过（a01 3.83） | `webhookEventId` uuid 收件行；`provider` enum(webhook_event.provider) 来源 | `security.onWebhookReceived`：立即领取处理。注：只是加速信号，丢失也会被进程内循环领走（15:124） |

### 3.16 不发与预留的事件

| 事件名 | 出处 | 状态 | 说明 |
| --- | --- | --- | --- |
| `sample.remind_due` | d3:2728 | 不发 | 纯提醒不登记定时器（R6；01:399），通知模块按规则 R4 派生 |
| `ad.confirm_remind_due` | d3:2728 | 不发 | 同上，规则 R5 |
| `launch.remind_due` | d3:2728 | 不发 | 同上，规则 R2 |
| `launch.overdue_due` | d3:2728 | 不发 | 同上，规则 R6 |
| `takedown.remind_due` | d3:2728 | 不发 | 同上，规则 R3 |
| `billing.renewal_reminder_due` | d1:1720 | 不发 | 07 不跑 d1:1147 的提醒任务，规则 R1 派生（07:1589；13:1212） |
| `billing.invariant_violated` | d1:1720 | 不发 | 违规由 ops 写 invariant_violation 并告警（M30；07:1602） |
| `billing.month_closed` | d1:1720；d6:2114 | 预留 | 聚合 `billing_month_close`；载荷 `billingMonthCloseId` uuid 计费月结行；`month` string YYYY-MM；订阅者 `reports.onMonthClosed`：写 report_month_close。V1.0 上线时不发；reports 订阅者先注册，收不到事件不影响其他功能 |


### 3.17 草案名对照（改名）

| 草案或数据模型里的名字 | 出处 | 本文的名字 | 理由 | 需要回写 |
| --- | --- | --- | --- | --- |
| `account.new_wechat_bound` | 02:1019；13:157；d4:293-295 | `merchant_user.wechat_bound` | `account.` 已是渠道账号的前缀（11 分组 4 个事件），同一前缀不能指两种对象（N3）；聚合本来就是 `merchant_user` | 02:1001、1019；13:157、1300（m01 已回写） |
| `refund_txn.submit` | d2:1188；01:653 | `refund_txn.created` | 不用祈使动词（N2）；事实是“退款交易已建、待提交” | 01:653 |
| `payment.paid` | d6:233、1843；14:752 | `billing_order.paid` | d2 已定名；聚合是付款单 | 14:752 |
| billing_order.fulfillment_exception（草案名，不再使用） | d2:1188 | `billing_order.fulfillment_blocked` | 与 `fulfillment_status = blocked` 同词（N2） | — |
| `exception.opened` | d2:1188 | `payment_exception.opened` | 前缀过泛，改用表名（N3） | — |
| `refund.done` | d2:1188；d6:249 | `refund.completed` | `done` 不是过去分词（N2） | — |
| `refund.cancelled` | d2:1188 | `refund.withdrawn`、`refund.voided` | 状态机把未执行的关闭分为撤回与作废（08:526、530），订阅方要区分 | — |
| `item.live`、`item.live_revoked`、`item.usage_end_changed` | d3:2725-2726 | `order.item.went_live`、`order.item.live_revoked`、`order.item.usage_end_changed` | 订单项的事件统一用 `order.item.` 前缀（d3 的取消类已用）；`live` 是状态不是事实 | — |
| `billing.subscription.*`、`billing.points.*` | d6:253 | 逐个事件名 | 订阅按具体事件名登记，不用通配 | — |
| invoice_request.submitted（m07 初稿名，不再使用） | m07 文档 | `invoice.requested` | 开票的事件前缀是 `invoice.`（d2、08:1213） | 已回写（m07 第二轮） |
| `*.remind_due`、`billing.renewal_reminder_due`、`billing.invariant_violated` | d1、d3 | 不发 | 见 3.16 | — |

## 4. 定时器与任务进程

### 4.1 定时器（有主体）

去重键按 01:318 的三条约定：触发后还要再登记的带轮次；同一主体两种同 kind 的带用途段；目标日期变了换新键、旧键按前缀取消。类型段一律用最终表名（M19、A96；客服的三个键按 A144 由 `st` 改为 `service_ticket`，12:185-187 已改；在途的旧键行按 V8 由迁移脚本取消后用新键重登）；数据模型已定的键（01 分组 3.3、12 分组）照抄，本文定的键标“本稿定”（`content.license_end` 的键带止日，A96）。到期时间都按 Asia/Shanghai。定时器发出的事件何时填 `tmr:{本行去重键}` 见 2.3。

| kind | 主体 `subject_type` | 关键类 | 到期 `fire_at` | 去重键 `dedupe_key` | 登记 | 取消或改期 | 处理器：守卫 → 动作 → 事件 | 出处 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `invitation.expire` | `invitation` | 否 | `invitation.expires_at` | `invitation.expire:invitation:{invitationId}` | `m.invitation.create`（同事务）；未分享卡片复用时同键改 fire_at | `m.invitation.accept`、`m.invitation.revoke`；门店停用、删除草稿门店、主体关闭与注销的撤回联动（`m.store.archive`、`m.store.delete`、`admin.entity.close`、`m.me.deletion.create`） | 仍 pending 且 expires_at ≤ now → `invitation.expired`（02:789）；否则 skipped | 02:794；01:609 |
| `order.start` | `drama_order` | 是 | max(now, 提交时间 + 参数 `order.start_delay_minutes`) | `order.start:drama_order:{dramaOrderId}`（不带轮次，声明 rearmAfterSkip） | `m.order.create`（下单时资质已通过）；订阅者 `order.onQualificationDecided`；取消申请关闭为 not_executed（`admin.cancelRequest.reject` / `withdraw` / `void`）；周期任务 `order.pending_start_sweep` | 不主动取消：有在途取消或资质不再通过时处理器返回 skipped，之后同键复活 | 待开工、无在途取消、门店闸门 full → capture、订单项 pending_start → producing、建工单（ticket.created）、订购单重新推导 → `order.started`、`billing.points.captured` | 09:205-212；01:378 |
| `order.rejected_stale` | `drama_order` | 否 | 资质驳回时刻 + 参数 `order.rejected_stale_days`（默认 7 个自然日） | `order.rejected_stale:drama_order:{dramaOrderId}:r{资质轮次 roundNo}`（本稿定） | 订阅者 `order.onQualificationDecided`（非终局驳回） | 不主动取消：重新提交后处理器守卫不成立即 skipped | 仍待开工，且门店当前的资质轮次就是键里的第 r 轮、仍为 rejected（商家重新提交后第 r + 1 轮又被驳回的，第 r 轮的定时器 skipped，由第 r + 1 轮的定时器在其驳回满 7 天时提醒）→ `order.rejected_stale`（客服待办） | d3:2972；09:1042 |
| `usage.end` | `order_item` | 是 | `order_item.usage_end_date` 次日 00:00（Asia/Shanghai） | `usage.end:order_item:{orderItemId}:{usageEndDate}`（本稿定；01:318 的示例已按 A96 改为 `order_item`） | `admin.deliveryTicket.pushPackage`；止日改写时（定时器 `usage.resync`、平台原因终止）按前缀 `usage.end:order_item:{orderItemId}:` 取消旧行再登记 | 工单终止、订单项取消（取消执行事务） | 工单在待上线、上线核验或服务中 → reevaluate 进入到期下架（10:186-187）；同事务 `launch.void` / `launch.settle`、`ensureTakedownTasks`、撤销下载授权、关闭补发跟进 → `ticket.step_changed`、`takedown.created`、`launch.voided` / `launch.settled` | d3:2971；01:600 |
| `usage.resync` | `order_item` | 是 | 登记时刻（立即） | `usage.resync:order_item:{orderItemId}:{dramaCopyrightRevisionId}`（本稿定） | 订阅者 `publish.onLicenseExtended`（扇出，每个受影响订单项一行） | — | usage_end_source = license、工单未进入到期下架且未归档未终止、剧目当前授权止日晚于 usage_end_date（只顺延、不缩短：止日变早时不自动改订单，09:367 I6，由 `order.onLicenseShortened` 生成人工待办）→ 顺延止日；按前缀重设 `usage.end`、`takedown.create`；作废止日前 30 天尚未到的待商家下架任务（11:661）；重开最后一个因到期关闭的成片包（10:884）→ `order.item.usage_end_changed`、`takedown.voided` | d3:1798、2968；01:600 |
| `takedown.create` | `order_item` | 是 | `usage_end_date` − 30 天的 00:00 | `takedown.create:order_item:{orderItemId}:{usageEndDate}`（本稿定） | `admin.deliveryTicket.pushPackage`（距止日 ≥ 30 天时；不足 30 天在推送事务内直接生成）；`usage.resync` 按前缀改期 | 订单项终止、归档 | 订单项未终止、未归档 → `ensureTakedownTasks`（11:653）→ `takedown.created`（node = T-30） | d3:2947；11:745 |
| `sla.breach` | `delivery_ticket_stage` | 否 | 环节的 `due_at` | `sla.breach:delivery_ticket_stage:{deliveryTicketStageId}`（本稿定） | 进入有员工时限的环节（transition 的环节切换）；暂停恢复、日历重算时同键改期 | 离开环节、工单暂停 | 环节未完成、工单未暂停 → 写 `is_breached = true` → `ticket.sla_breached` | d3:2942；10:234 |
| `sla.breach` | `ad` | 否 | 广告首版 `first_due_at` 或修改轮次的 `due_at` | 首版 `sla.breach:ad:{adId}:first:{resubmit_count}`；修改版 `sla.breach:ad:{adId}:rev:{revision_no}` | `m.ad.create`、`m.ad.submit`（首版，补充后换新序号）；`m.ad.requestChange`、`admin.ad.requestChange`（修改版） | `admin.ad.return`（首版）；该轮被满足（`admin.adVersion.push`）；取消执行 | 仍未满足 → 写 `first_breached_at` 或 `ad_revision.breached_at`（门店资质在审的待指派广告只提醒、不写）→ `ad.sla_breached` | 09:813；01:602 |
| `sla.breach` | `approval_request` | 否 | 审批单 `due_at`；有执行步四类为领域行 `exec_due_at` | `sla.breach:approval_request:{approvalRequestId}:decision`；`sla.breach:approval_request:{approvalRequestId}:execution` | 审批单提交且 `due_at` 非空（decision；A93 定的补偿延长、积分调整、受控财务配置、对公二人复核不设决定时限，不登记）；四类有执行步的审批通过（execution） | 决定或撤回（decision）；execution：退款申请执行时取消（→ executing 或线下登记 → done，08:527-528；执行失败回到待执行不重新计时，08:532），回调晚到直接 done 时若仍在一并取消（08:529），取消申请 done 或作废时取消（09:559） | decision：仍 pending；execution：领域行仍是 `pending_execution` → `approval.sla_breached` | 01:603；03:751、830；09:559；08:524、527 |
| `sla.breach` | `assignment_history` | 否 | `assignment_history.contact_due_at`（转移 + 1 个工作日） | `sla.breach:assignment_history:{assignmentHistoryId}`（本稿定） | staff 的 `reassign` 写改派记录时（禁用移交、转移交付经理、自动改派） | `admin.assignmentHistory.markContacted`；改派记录作废 | 仍未联系 → `assignment.sla_breached` | 03:471；d3:2974 |
| `sla.breach` | `store_asset` | 否 | `store_asset.due_at`（上传后 1 个工作日） | `sla.breach:store_asset:{storeAssetId}`（本稿定） | `m.storeAsset.create`、`admin.storeAsset.create` | `admin.storeAsset.review`；素材删除 | 仍未复核 → `asset.sla_breached` | 06:1133；M22 |
| `sla.breach` | `transfer_proof` | 否 | `transfer_proof.due_at`（上传后 1 个工作日） | `sla.breach:transfer_proof:{transferProofId}`（本稿定） | `m.paymentOrder.transferProof.create`、`admin.paymentOrder.transferProof.create` | 凭证离开 pending（确认、驳回、被替换、差异单关联） | 仍 pending → `transfer.sla_breached` | 08:366、403、413 |
| `sla.breach` | `invoice_request` | 否 | `invoice_request.due_at`（配置了时限时） | `sla.breach:invoice_request:{invoiceRequestId}`（本稿定） | `m.invoiceRequest.create` | 申请离开 pending | 仍 pending → `invoice.sla_breached` | 08:1066、1110 |
| `ad.returned_stale` | `ad` | 否 | 退回时刻 + 参数 `ad.returned_stale_days`（默认 7 个自然日） | `ad.returned_stale:ad:{adId}:{resubmit_count}`（本稿定） | `admin.ad.return` | `m.ad.submit`（补充）；取消执行 | 仍 returned → `ad.returned_stale`（客服待办） | d3:1285-1286、2980 |
| `service.first_response_due` | `service_ticket` | 否 | `service_ticket.response_due_at` | `service.first_response_due:service_ticket:{serviceTicketId}:r{reopened_count}` | `m.serviceTicket.create`（r0）；`m.serviceTicket.reopen`；日历重算同键改期 | 负责人回复；进入待商家确认；关闭 | 仍 pending 或 processing 且 response_due_at 与登记时一致 → escalate（12:161）→ `service_ticket.escalated` | 12:185；01:604 |
| `service.solution_due` | `service_ticket` | 否 | `service_ticket.solution_due_at`（创建 + 24 自然小时） | `service.solution_due:service_ticket:{serviceTicketId}` | `m.serviceTicket.create`、`admin.serviceTicket.create`；人工纠偏重开已关闭的工单（`admin.serviceTicket.forceTransition`）且尚无方案、截止未过时以原键重新登记（原行已 cancelled，不占键） | 给出方案（solution_at 写入）；关闭 | 尚无方案 → `service_ticket.solution_overdue`（不改状态） | 12:186；01:604 |
| `service.auto_resolve` | `service_ticket` | 是 | `service_ticket.auto_resolve_at`（进入待确认 + 3 自然日） | `service.auto_resolve:service_ticket:{serviceTicketId}:{awaiting_confirm_at 的 Unix 毫秒数}` | `admin.serviceTicket.submitResult` | `m.serviceTicket.confirm`、`m.serviceTicket.reopen`、`admin.serviceTicket.close` | 仍 awaiting_confirm 且 auto_resolve_at 一致 → resolved（12:155）→ `service_ticket.resolved` | 12:187；01:604 |
| `takedown.overdue` | `takedown_task` | 否 | `due_date` 次日 09:00 | `takedown.overdue:takedown_task:{takedownTaskId}:{dueDate}` | 下架任务生成（11:653）；抽查仍在线、依据重开且应完成日次日 09:00 未到时重新登记；应完成日改写时按前缀取消再登记 | 商家确认、核查、作废 | 仍 pending_merchant → escalate（11:659）→ `takedown.escalated` | 11:653；01:605 |
| `patrol.followup` | `patrol_task` | 否 | 发现异常 + 3 个自然日 | `patrol.followup:patrol_task:{patrolTaskId}`（本稿定；一个任务只会进入一次异常） | `admin.patrolTask.markAbnormal` | `admin.patrolTask.recover`；作废 | 仍 abnormal → 经 staff 接口写系统跟进待办（follow_up，11:549），不发事件 | 11:544、549；01:606 |
| `content.license_end` | `drama` | 否 | `license_end_date` 次日 00:00 | `content.license_end:drama:{dramaId}:{licenseEndDate}`（A96；05:155、445 已改） | `admin.drama.shelve`（上架、重新上架）；止日变更（`admin.drama.dramaCopyrightRevision.create`）按前缀 `content.license_end:drama:{dramaId}:` 取消旧行再登记 | `admin.drama.delist` | 重读止日，仍已过期且已上架 → delisted（05:146）→ `drama.delisted` | 05:155、445；01:610 |
| `po.expire` | `billing_order` | 是 | `expires_at` + 60 秒 | `po.expire:billing_order:{billingOrderId}`（本稿定） | `m.paymentOrder.create`（微信） | 付款单已支付或已取消；`m.paymentOrder.cancel` 遇微信不可达时同键把 fire_at 提前到当前，由处理器查单后取消（m07 3.11） | 仍待支付 → 先查单：已支付则 recordChannelSuccess + 入账（`payment_txn.succeeded`、`billing_order.paid` 等，入口见 5.1）；未支付则关单（payment_txn closed）并取消（`billing_order.cancelled`）。查单发现与回调同类的事实（已成功的收款微信单号或实收又不符）按 h01 2.6 的键开差异单（`status_mismatch:{out_trade_no}`，`detected_by = query`；同键已有则跳过） | d2:1176；08:153、166 |
| `po.transfer_ttl` | `billing_order` | 否 | 对公付款单 `expires_at` | `po.transfer_ttl:billing_order:{billingOrderId}:{expires_at 的 Unix 毫秒数}`（本稿定） | `m.paymentOrder.create`、`admin.paymentOrder.create`（对公）；凭证被驳回（`admin.transferProof.reject`）时按当前 `expires_at` 重新登记（顺延后是新键；升级单不顺延、同键，旧行已 cancelled 不占键；已过期则 fire_at 取当前、立即到点） | 上传或重新上传凭证时取消（`m.paymentOrder.transferProof.create`、`admin.paymentOrder.transferProof.create`，d2:454-456，与 m07 一致）；付款单已支付或已取消 | 仍 pending_payment 且没有待确认凭证 → cancelled（08:175）→ `billing_order.cancelled`；有待确认凭证则 skipped（防御，正常已在上传时取消） | d2:1177、454-456；08:170、175 |
| `rf.poll` | `refund_txn` | 否 | 提交后 5 分钟起，退避至 1 小时；abnormal 每日一次 | `rf.poll:refund_txn:{refundTxnId}:n{第几次查询}`（本稿定） | `admin.refundRequest.execute` 内联提交后；订阅者 `billing.submitRefundTxn`；处理器每次未到终态时登记下一次 | 退款交易到达终态 | 查询退款并落结果（08:663-669，与回调同一段退款结果处理代码）→ 驱动退款申请、付款单、开票申请、差异单 → `refund.completed` / `refund.execution_failed`、`billing_order.refunded` 等。查到超额退款、迟到成功、退款金额不符时按 h01 2.6 的键开差异单（`refund_over:{out_refund_no}`、`status_mismatch:refund:{out_refund_no}`、`refund_amount_mismatch:{out_refund_no}`，`detected_by = query`；同键已有则跳过，不与回调各开一张） | d2:1178、909；08:1534 |
| `pricing.drama_price_effective` | `drama_price_revision` | 否 | 调价修订的 `effective_at` | `pricing.drama_price_effective:drama_price_revision:{dramaPriceRevisionId}` | `admin.drama.dramaPriceRevision.create`（effective_at 晚于保存时刻） | `admin.dramaPriceRevision.withdraw`（生效前撤销） | 只发 `pricing.drama_price_changed`；价格按时间取值，定时器没跑也不会错价 | 07:1586；01:613 |

纯提醒不登记定时器行（R6；01:399、615）：d3 的 `sample.remind`、`ad.confirm_remind`、`launch.remind`、`launch.overdue`、`takedown.remind`、`drama.license_remind`、`followup.remind` 与 d4 的 `approval.remind`，都由周期任务 `notify.remind_scan` 按规则 R1–R7 派生（13:1214-1226）。账务时钟不登记（`subscription.expire`、月度发放、期末清零由 advance 驱动，01:615）。

### 4.2 周期任务（无主体）

登记在各模块的 `register.ts`（计划 第 5.1、9.3 节；`apps/worker/src/recurring.ts` 只是汇总入口，把本环境生效的汇成一张表，自己不登记任务）；定时器行 `subject_type`、`subject_id` 为空（M45），`dedupe_key = {kind}:{本期的栅格时刻}`，`payload.scheduledFor` 为本期计划时刻，运行摘要写 `result`（01:318、681-682）。“模式”取 d7:1572：`tx` 在一个事务里做完，`job` 认领后在事务外执行、按租期续租。“漏跑级别”是 ops 告警规则“周期任务漏跑”的级别（01:383）。

| kind | 节奏（Asia/Shanghai） | 模式 | 漏跑级别 | 归属 | 做什么 | 出处 |
| --- | --- | --- | --- | --- | --- | --- |
| `billing.sweep.daily` | 每日 00:00 | job | P1 | billing（07） | 对 next_due_at 已到的主体执行 advance（发放与清零兜底）；累加 billing_entity_daily；跑估值 | 07:1587；d7:1578 |
| `bill.download` | 每日 10:30；失败 30 分钟后重试，14:00 仍失败告警；补扫近 90 天未完成的账单日 | job | P1 | billing（08） | 下载、校验、归档微信账单；解析入 wx_bill_line；匹配交易，补建孤儿交易，开或自愈差异单（`detected_by = reconciliation`；账单上发现的退款成功走与回调同一段退款结果处理代码，08:529、531、669；与回调、查单同类的事实用 h01 2.6 的同一套键，同键已有则跳过），写 recon_day，发 `recon.day_closed` | 08:852；d2:1179；d7:1579 |
| `tx.unapplied_scan` | 每 5 分钟 | tx | P2 | billing（08） | 成功未入账且没有未决差异单的收款 → applyPayment | 08:307；d2:1180 |
| `receipt.daily_digest` | 每日 18:00 | job | P3 | billing（08） | 当日对公确认清单（含流水号冲突放行标记）推送超级管理员 | d2:1182；08:1534 |
| `order.pending_start_sweep` | 每 5 分钟 | tx | P2 | order（09） | 待开工、资质已通过、无在途取消（`drama_order.open_cancel_request_id` 为空）、没有 scheduled / dispatched 的 order.start 的订购单 → timers.arm 补登记或复活（漏了“无在途取消”会让有在途取消的单每 5 分钟复活、到点、跳过地空转） | 09:203、212；01:378；d3:2970、3218 |
| `patrol.weekly_generate` | 每周一 09:00 | tx | P2 | publish（11） | 按周幂等取批次行，抽样生成巡检任务（`patrol.created`） | 11:463；d3:1887 |
| `calendar.coverage_check` | 每月 1 日 10:00 | tx | P3 | sla（01） | 未来 60 天缺日历、12 月 1 日起下一年放假安排未导入 → 告警超级管理员 | 01:538；d3:2889、2976 |
| `media.sweep` | 每 10 分钟；清除运行在每日首轮（03:00 后） | job | P2 | media（06） | pending 文件过期置 expired、清理拒收写入区对象、无引用文件置 purge_after；上传批次过期；建清除运行并执行清除；ZIP 与清单文件清除后改 zip_bundle；ocr 原始返回到期清空；素材需求到期提醒（06:1874） | 01:625；d7:1584；d5:329、1065-1070 |
| `content.stat_refresh` | 每小时 | tx | P3 | content（05） | 经 DramaUsagePort 取数，覆盖 drama_stat | 05:390 |
| `content.archive_sweep` | 每日 02:30（草案未给时刻，本稿定） | tx | P3 | content（05） | 已下架、授权已结束、名下没有未结束订单项的剧写 archived_at，释放文件引用并 retireDramaMedia | 05:153 |
| `notify.remind_scan` | 每 5 分钟 | job | P2 | notify（13） | 按规则 R1–R7、跟进到期、待审批提醒，调各领域只读端口派生通知 | 13:1212-1226；d6:146 |
| `notify.sms_keepalive` | 每日 10:20 | job | P3 | notify（13） | 短信签名保活 | 13:1212；d6:150 |
| `notify.sms_balance` | 每日 10:20 | job | P3 | notify（13） | 短信余量检查 | 13:1212；d6:150 |
| `docs.sweep` | 每 5 分钟 | job | P2 | docs（13） | 协议版本到点簿记翻转；重投 queued、租约过期的授权书版次 | 13:766、1039；d6:147 |
| `evidence.consent_digest` | 每日 00:40 | job | P2 | docs（13） | 前一日同意记录按 seq 求 SHA-256，写入 secure 桶；次日校验 | 13:864；d6:151 |
| `analytics.partitions` | 每月 20 日 | job | P2 | analytics（14） | 预建未来 3 个月的埋点分区（迁移账号） | 14:746 |
| `analytics.dedup_purge` | 每日 04:10 | job | P3 | analytics（14） | 删除 8 天前的去重行 | 14:777 |
| `export.sweep` | 每 5 分钟 | job | P2 | exports（14） | 回收租约过期的导出任务；到期置 expired 并删除文件 | 14:982-984 |
| `reports.finalize` | 每日 00:30 | job | P2 | reports（14） | 续费率到期满 7 天后定稿，重出月度快照 | 14:890 |
| `invariant.full` | 每日 03:30 | job | P2 | ops（15） | 运行 modes 含 full 的全部检查项（含 every = week 的项按周），按 heal 策略自愈 | 15:338-351；d7:1581 |
| `invariant.quick` | 每 10 分钟 | job | P2 | ops（15） | 运行 modes 含 quick 的检查项（如 media.I10、I11，notify.N2） | 15:338-351；d7:1581 |
| `ops.retention` | 每小时（“每日”项在当日第一轮） | tx | P3 | ops（15） | 15:592-606 的清理清单：幂等行、已触发的周期定时器行（90 天）、票据、会话、验证码、激活码、auth_event、已恢复告警、回调载荷 | 15:592；d7:1586 |
| `ops.cert_check` | 每日 09:00 | job | P3 | ops（15） | 证书剩余天数检查 | 15:580；d7:1587 |
| `backup.pgdump` | 每日 03:10 | job | P1 | ops（15） | 逻辑备份；结果写定时器行 result | 01:621；d7:1580 |
| `stg.pay.autorefund` | 每 5 分钟（只在预发注册） | job | — | ops（15） | 预发环境自动退款 | 01:621；d7:1588 |

### 4.3 进程内循环（不建定时器行）

主 worker 进程内的循环，Redis 不可用时照跑；由探针直接量它们所扫的表的滞后（d7:1590；01:630）。

| 循环 | 节奏 | 做什么 | 出处 |
| --- | --- | --- | --- |
| 出站中继 | 每秒 | 按 seq 扫描 published_at 为空的事件，为每个订阅者展开 outbox_delivery（01:275） | 01:189、275 |
| 出站派发 | 每秒 | 派发到期投递行（jobId `evt-{事件 id}-{订阅者}-{序号}`），租约 2 分钟；Redis 不可用时关键类订阅者进程内直接执行 | 01:276-278；d3:2700 |
| 定时器扫描 | 每 20 秒 | 认领到期定时器（jobId `tmr-{id}-{序号}`），租约 5 分钟；关键类在 Redis 不可用时进程内执行 | 01:367-369 |
| ensureRecurring | 每 60 秒 | 按周期任务登记表补登记本期定时器行（不依赖上一期是否执行完） | 01:360；d7:1595 |
| 探针 probe() | 每 60 秒 | 按 15 分组的规则求值，开、升级、恢复 alert_event | 15:251-258；d7:1590 |
| 账务推进 advance | 每分钟 | next_due_at ≤ now 的主体逐个 FOR UPDATE SKIP LOCKED 后 advance：发放、清零、预约周期接续 | 07:1580；d1:842 |
| notify.scan | 每 5 秒 | 投递租约回收、到期投递入队；入队失败进程内直接执行 | 13:1212；d6:146 |
| webhook.reprocess | 不超过 1 分钟 | 领取 received / failed 且到期的收件行，调处理函数 | 15:124；d2:1181 |
| media_job 执行循环 | 每 15 秒 | 领取 next_run_at 到期的媒体任务，提交或回查云端任务 | 06:660；d5:1337-1345 |
| flow.reevaluate_sweep | 每 5 分钟 | 找“条件已满足却仍停在原步骤”的未暂停工单，逐张 reevaluate，并经 invariants.report 上报 flow.STUCK_TICKET | d3:2978、3219；15:431 |
| flow.reconcile_sweep | 每 5 分钟（止日对账每小时） | ① 开工超过 10 分钟仍缺授权书 → 对齐；② 终局驳回后缺整店取消 → 生成；③ license 来源的使用期止日早于剧目当前授权止日 → 登记 usage.resync（只顺延）；晚于授权止日的只告警，交给 `order.onLicenseShortened` 生成的人工待办（09:367 I6） | d3:2979、3220 |

### 4.4 队列任务

BullMQ 只是执行通道：任务一律 `attempts: 1`，重试、到期、租约都由数据库行驱动（d6:139；01:233）。

| 通道 | 执行 | 推进的表 | 出处 |
| --- | --- | --- | --- |
| 出站投递 | 订阅者的 consume() | outbox_delivery 行 | 01:233 |
| 定时器执行 | runTimer() | timer 行 | 01:304 |
| promote | 文件入库：条件复制到正式区、核对、加标 | file_object | 06:194 |
| 媒体任务 | 体检、转码、水印、规格化、补标、识别、审核（local / remote） | media_job | 06:679 |
| zip_package | 成片包打包与发布清单文件 | media_job → zip_bundle | 06:962-974 |
| notify（并发 4，按通道限速） | 通知投递 | notification_delivery | 13:426；d6:139 |
| docs（并发 2） | 授权书 PDF 渲染与签名 | license_letter_revision | 13:1037；d6:139 |
| export（并发 1） | 导出文件生成 | export_job | 14:979 |

### 4.5 回调处理

`x-auth: signed`，去重靠 `uq_webhook_event_provider_event_id`（C6）。内联模式在接口进程的事务里处理；收件箱模式落库即应答成功，同事务发 `webhook.received`（15:114-117）。微信支付两个回调的兜底行（T1′ 写下的 `received` / `failed`）在同一事件再次到达时由该回调在本事务内重处理（15:117），否则由 `webhook.reprocess` 领取。各处理函数的接口侧写法见 h01。

| operationId | 模式 | 处理函数做什么 |
| --- | --- | --- |
| `hooks.wechatpay.transaction.notify` | 内联；事务失败落收件箱兜底（15:116） | recordChannelSuccess（payment_txn → succeeded）+ 提交后内联 applyPayment；不成功由 `payment_txn.succeeded` 的订阅者与 `tx.unapplied_scan` 兜底 |
| `hooks.wechatpay.refund.notify` | 内联；事务失败落收件箱兜底（15:116，与支付回调同走 T1′，h01 3.2） | 退款交易落结果，驱动退款申请（含 08:529 回调晚到）、付款单、开票申请、差异单；兜底 `rf.poll`、`bill.download` |
| `hooks.wechat.message.receive` | 收件箱（发 `webhook.received`） | 订阅消息回执与额度（13 分组 2.5“回执回写”）；内容安全异步结果转入 media_job（按 trace_id）。订阅消息事件的 `payload.wechatIdentityId` 为 null（openid 对不上微信身份）时整条记 `ignored`（15:540） |
| `hooks.wecom.event.receive` | 收件箱（发 `webhook.received`） | 写 wecom_contact（添加、删除外部联系人）。回调的 `userid` 对不上任何 `staff.wecom_userid` 时整条记 `ignored`；删除事件早于有效行 `added_at` 的不处理（h01 3.6） |
| `hooks.ci.mediaJob.wake` | 内联，只唤醒 | 把 media_job.next_run_at 置为当前，结果以回查为准 |
| `hooks.asr.mediaJob.wake` | 内联，只唤醒 | 同上 |
| `hooks.sms.statusReport.receive` | 内联（收件箱为备选；h01 按作者默认定为内联） | 短信状态回执只追加 notification_delivery 的 `receipt_status`、`receipt_reported_at`，不改投递状态、不触发补发（13:381、441） |

### 4.6 命令行

随 worker 镜像提供，需要服务器权限；以员工身份执行的写 `audit_log.client = cli`（M102）。

| 命令 | 出处 | 做什么 |
| --- | --- | --- |
| `staff:bootstrap` | 03:217；d4:1040 | 建第一位超级管理员（staff → active） |
| `refund:abandon-txn` | 08:668；d2:937 | 两人确认放弃异常退款交易（refund_txn abnormal → abandoned），驱动 08:532 |
| `ops analytics:repartition <YYYY-MM>` | 14:748 | 兜底分区搬迁（迁移账号） |
| `cli.alerts.ack / 关闭告警、重置死信回调` | 15:120、260 | 以 `--staff` 指定的员工身份写 alert_event、webhook_event 与审计（client = cli） |

### 4.7 草案提到、不单独登记的任务（去向）

| 草案里的任务 | 出处 | 去向 |
| --- | --- | --- |
| 每分钟 sweep、每日 00:20 快照、每日估值 | d1:842、1612、1375 | 进程内循环“账务推进”；周期任务 `billing.sweep.daily` |
| 每日 02:00 不变量、每日 10:00 续费提醒 | d1:1539、1147 | `invariant.full`；`notify.remind_scan` 规则 R1（07:1589） |
| `recon.wechat.daily`、`billing.reconcile` | d7:1579；d3:2953 | `bill.download`（01:624） |
| `invariant.check`、`flow.health_check` | d2:1183；d3:2888；d7:1590 | `invariant.full` / `invariant.quick`；探针（d7:1590） |
| `webhook.reprocess` | d2:1181 | 进程内循环（15:124） |
| `events.redeliver` | d7:1582 | 不保留，由投递行的租约与退避驱动（M65） |
| `subscription.expire`、`billing.grant_scan` | d3:2933、2932 | advance（01:615） |
| `asset_request.due` | d3:2963 | `media.sweep` 按 `due_date` 扫描（06:1874） |
| `report.daily_snapshot`、`report.daily`、`notify.reconcile`、`reports.verify` | d3:2965；d7:1583；d6:154 | `billing.sweep.daily`、`reports.finalize`；`notify.reconcile` 删除；`reports.verify` 并入 `reports.N10`（每周，01:628） |
| `purgeRun`、上传清扫、upload_batch 过期、ocr 原始返回清空 | d5:329、1065、1155、936 | `media.sweep` |
| `media.invariants`、收敛扫描、库与桶对账 | d5:2047-2072 | `invariant.full` / `invariant.quick`（media.I8、I10、I11 等，15:338-351） |
| 配额检查（OCR / ASR 资源包、STS 失败率） | d5:2075 | 探针规则（15 分组），不设周期任务 |
| `audit_image_wx` 超过 deadline 改走数据万象 | d5:1358 | media_job 执行循环内判定 |
| `profile.invariants` | d9:726 | `invariant.full`（04:642） |
| 租户不变量巡检、敏感操作与审计配对、会话与事件清理 | d4:1972、1975、1979 | `invariant.full`；`ops.retention` |
| 回调积压（每 5 分钟）、收件箱扫描兜底 | d4:1977、1834 | 探针；进程内循环 `webhook.reprocess` |
| 待审批超期 | d4:1978 | `notify.remind_scan` 的待审批提醒；审批单的 `sla.breach` |
| 名额超限清单（每日）、手机号组件用量对账（每月）、权限复核清单（每周） | d4:1973、1974、1976 | 数据模型没有落点，见 8 节待确认 9 |

## 5. 非 HTTP 迁移归属表

### 5.1 读法

收录数据模型状态机表（含技术状态与派生阶段）里触发者不是“人经接口”的每一行，以及触发者写了“系统”、实际随某个接口事务联动的行。由人经接口触发的行写在各接口文档“触发的状态迁移”一栏（C81、C84），本表不重复；终态的“任何 → 不变”行不收。

“方式”取值：**定时器**（`runTimer()` 调 4.1 的处理器）；**订阅者**（2.5 的订阅者消费事务）；**周期任务**（4.2）；**进程内循环**（4.3）；**回调处理**（4.5，含其提交后的内联处理）；**任务进程**（4.4 的队列任务收尾）；**命令行**（4.6）；**内核**（`kernel.tx.run()` 等基础设施）；**随调用方事务**（不独立触发，发生在所列接口或任务的同一事务里；所列 operationId 的接口文档须在“触发的状态迁移”里写出这一行）。

**入账入口**（07、08 多处引用）：收款入账 `applyPayment` 与履约 `fulfill()` 的全部入口——回调 `hooks.wechatpay.transaction.notify`（提交后内联）；订阅者 `billing.applyPaymentFallback`（消费 `payment_txn.succeeded`）；周期任务 `tx.unapplied_scan`；定时器 `po.expire`（查单为已支付）；周期任务 `bill.download`（对账补建后入账）；以及接口 `m.paymentOrder.sync`、`m.paymentOrder.wechatPrepay`（老板换了微信号、关旧尝试前查单为已支付）、`m.paymentOrder.cancel`（取消前查单为已支付）、`admin.transferProof.confirm`、`admin.transferProof.approveReview`、`admin.paymentException.resolve`（补单、关联到付款单、重试履约）。这些入口用同一段入账代码（d2:635），发出的事件相同；接口入口由各接口文档写出迁移，本表只列非接口的入口为负责方。

### 5.2 内核（01）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `01:87` | `idempotency_record.state` | —→done | `kernel.tx.run()`，与所在用例同一事务（接口、订阅者、定时器处理器都经它） | 内核 |
| `01:88-90` | `idempotency_record.state` | —→in_progress→done；过期后续占 | 三段式与多事务用例（约定 C51 的登记表，以它为准，如 `m.paymentOrder.wechatPrepay`、`m.paymentOrder.cancel`、`admin.refundRequest.execute` / `retry` / `confirmNotAccepted`、`admin.paymentException.resolve`（恢复、补记渠道退款）、`m.file.complete`、`admin.notifyScene.testSend`）的重复请求 | 内核 |
| `01:91` | `idempotency_record` | 过期行删除 | 周期任务 `ops.retention` | 周期任务 |
| `01:275` | `outbox_delivery.status` | —→pending | 进程内循环“出站中继” | 进程内循环 |
| `01:276-278` | `outbox_delivery.status` | pending/retry→leased；租约过期重派；入队失败回 pending | 进程内循环“出站派发” | 进程内循环 |
| `01:279-282` | `outbox_delivery.status` | leased→done / retry / dead | `consume()`（各订阅者的消费事务与失败短事务；281 次数耗尽告警 `outbox.exhausted`） | 订阅者 |
| `01:360-366` | `timer.status` | timers.arm：新建、改期、复活 | 各 kind 的登记方（4.1“登记”栏）在业务事务里调用；周期任务行由 `ensureRecurring` 与认领时登记下一期；365 另有周期任务 `order.pending_start_sweep` | 随调用方事务 |
| `01:367-369` | `timer.status` | scheduled→dispatched；租约过期重认领；入队失败回 scheduled | 进程内循环“定时器扫描” | 进程内循环 |
| `01:370-372` | `timer.status` | dispatched→fired / skipped / scheduled / failed | `runTimer()` 调 4.1、4.2 的处理器；失败短事务退避；372 非关键类耗尽告警 | 定时器 |
| `01:373` | `timer.status` | scheduled/dispatched→cancelled | 各 kind 的登记方在业务事务里 `timers.cancel`（4.1“取消”栏） | 随调用方事务 |

### 5.3 身份与租户（02）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `02:129` | `merchant_user.status` | active→deleted（purge_empty） | 换绑事务内联动：`m.me.changePhone`、`admin.accountChangeRequest.approve` | 随调用方事务 |
| `02:524` | `entity.lifecycle` | active→abandoned | `m.invitation.accept`（受邀人名下是空草稿）；`m.session.phoneLogin` 的休眠保护（d4:450-460） | 随调用方事务 |
| `02:542` | `entity.verification_status` | pending→rejected（系统） | 订阅者 `profile.onQualificationApproved`；`profile.I7` 自愈（`invariant.full`） | 订阅者 |
| `02:543` | `entity.verification_status` | pending→提交前的值（qualification.withdraw） | 订阅者 `profile.onTenantLifecycle`（`entity.abandoned`、`entity.closed`） | 订阅者 |
| `02:611` | `store.lifecycle` | active→archived（entity_abandoned） | 与 02:524 同一事务 | 随调用方事务 |
| `02:626` | `store.qualification_status` | pending→提交前的值（qualification.withdraw） | 订阅者 `profile.onTenantLifecycle` | 订阅者 |
| `02:628` | `store.qualification_status` | verified→verified（qualification.change_withdraw） | 订阅者 `profile.onTenantLifecycle` | 订阅者 |
| `02:692` | `entity_member.status` | active(clerk)→removed（cascade_remove 的系统部分） | 休眠保护随 `m.session.phoneLogin`；注销、门店全部停用、主体关闭随 `m.me.deletion.create`、`m.store.archive`、`admin.entity.close` | 随调用方事务 |
| `02:695` | `entity_member.status` | active(owner)→removed（空草稿让位） | 与 02:524 同一事务 | 随调用方事务 |
| `02:788` | `invitation.status` | pending→revoked（系统联动部分） | `m.store.archive`、`m.store.delete`、`admin.entity.close`、`m.me.deletion.create` 的同一事务 | 随调用方事务 |
| `02:789` | `invitation.status` | pending→expired | 定时器 `invitation.expire`；`tenant.I30` 自愈（`invariant.full`） | 定时器 |
| `02:905` | `portal_ticket.status` | pending 超过 expires_at（不改状态） | 读时判定，无人负责写入；行由 `ops.retention` 7 天后删除 | 周期任务 |
| `02:907` | `portal_ticket.status` | approved→rejected（系统） | `portal.portalTicket.exchange` 同一事务里判定 | 随调用方事务 |

### 5.4 员工与审批（03）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `03:217` | `staff.status` | —→active（命令行引导） | 命令行 `staff:bootstrap` | 命令行 |
| `03:804` | `approval_request.status` | —→pending（系统提交） | 订阅者 `order.onQualificationDecided`（终局驳回生成整店取消）；`admin.launchSubmission.revoke` 重开核验时同事务新建 | 订阅者 |
| `03:805` | `approval_request.status` | pending→approved（免审批，系统） | `cancel.auto_execute`，随取消申请的提交事务（`admin.order.cancelRequest.create`、`admin.ad.cancelRequest.create`、`m.cancelRequest.create`（V1.1）、订阅者 `order.onQualificationDecided`） | 随调用方事务 |
| `03:806` | `approval_request.status` | pending→rejected（系统） | 订阅者 `profile.onQualificationApproved`；`profile.I7` 自愈 | 订阅者 |
| `03:807` | `approval_request.status` | pending→withdrawn（系统代撤） | 随调用方事务：`m.me.deletion.create`（账号变更申请）；空账号清理（`m.me.changePhone`、`admin.accountChangeRequest.approve`）；主体关闭撤回待审批的取消申请（`admin.entity.close`）；`m.channelAccount.unbind`；`launch.void` / `launch.settle`（定时器 `usage.end`、`admin.cancelRequest.execute`、`m.takedownTask.confirm`、`admin.deliveryTicket.reevaluate`）；订阅者 `profile.onTenantLifecycle`（资质轮次） | 随调用方事务 |

### 5.5 档案（04）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `04:344` | qualification_submission（派生阶段） | 草稿→已关闭（discarded，系统部分） | 订阅者 `profile.onTenantLifecycle`（`store.draft_deleted`、`store.archived`、主体放弃或关闭；`m.store.delete` 不在本事务丢弃，m02 请求） | 订阅者 |
| `04:346` | qualification_submission（派生阶段） | 在审→已关闭（rejected，duplicate_entity） | 订阅者 `profile.onQualificationApproved`；`profile.I7` 自愈 | 订阅者 |
| `04:347` | qualification_submission（派生阶段） | 在审→已关闭（withdrawn） | 订阅者 `profile.onTenantLifecycle` | 订阅者 |
| `04:479` | qualification_doc（派生阶段） | 草稿中→已移除（草稿被系统丢弃） | 与 04:344 同一事务 | 订阅者 |
| `04:480` | qualification_doc（派生阶段） | 在审→verdict（系统驳回部分） | 与 04:346 同一事务 | 订阅者 |
| `04:482` | qualification_doc（派生阶段） | 在审→不变（轮次被撤回） | 与 04:347 同一事务 | 订阅者 |

### 5.6 短剧库（05）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `05:146` | `drama.status` | listed→delisted（drama.license_expire） | 定时器 `content.license_end` | 定时器 |
| `05:153` | drama.archived_at（不是迁移） | 写归档时间 | 周期任务 `content.archive_sweep` | 周期任务 |

### 5.7 媒体（06）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `06:189` | `file_object.status` | —→stored（系统写入） | 任务进程：files.putSystemFile（授权书、导出、账单）、派生物取回、打包产物登记 | 任务进程 |
| `06:193` | `file_object.status` | pending→expired（过期清扫部分） | 周期任务 `media.sweep` | 周期任务 |
| `06:194-195` | `file_object.status` | promoting→stored / rejected | 任务进程 `promote` | 任务进程 |
| `06:197` | `file_object.moderation_state` | stored→stored（审核判定） | 任务进程：媒体任务收尾（内容安全异步结果经 `hooks.wechat.message.receive` 转入） | 任务进程 |
| `06:198` | `file_object.status` | stored→deleting→deleted | 周期任务 `media.sweep`（清除运行；清除后钩子另起事务） | 周期任务 |
| `06:196` | `file_object.status` | stored→stored（引用、释放） | 同 06:279-283：引用方在自己的事务里调 `files.link()` / `files.release()` | 随调用方事务 |
| `06:279-283` | `file_ref.state` | link、release、重新 link、顺延 | 引用方在自己的事务里调 `files.link()` / `files.release()`；278 由打包收尾（任务进程）与导出完成（任务进程）建立即释放 | 随调用方事务 |
| `06:355-357` | `file_purge_run.state` | —→proposed / held / running | 周期任务 `media.sweep`（每日首轮） | 周期任务 |
| `06:360-362` | `file_purge_run.state` | approved→running→done / aborted | 周期任务 `media.sweep` | 周期任务 |
| `06:526-527` | `upload_batch.state` | uploading→verifying→ready | 任务进程：入库与体检任务的收尾事务；员工跳过或替换条目后同事务复判由 `admin.uploadBatchItem.update` 承担（A141） | 任务进程 |
| `06:532` | `upload_batch.state` | 未结束→expired | 周期任务 `media.sweep` | 周期任务 |
| `06:602-605` | `upload_batch_item.state` | pending→uploaded / rejected；uploaded→checked / rejected | 任务进程：入库与体检任务的收尾事务 | 任务进程 |
| `06:683` | `media_job.state` | —→queued | 各流程在业务事务里创建（入库、体检、广告登记、打包、识别） | 随调用方事务 |
| `06:684-693` | `media_job.state` | 领取、提交、回查、成功、重试、失败 | 进程内循环“media_job 执行循环”与任务进程；`hooks.ci.mediaJob.wake`、`hooks.asr.mediaJob.wake` 只唤醒；691 超过 deadline_at 另由 `media.I10`（`invariant.quick`）兜底 | 任务进程 |
| `06:695` | `media_job.state` | 任意未结束状态→canceled | 业务对象作废的那个事务（随调用方，如剧目因版权下架时 `admin.drama.delist` 取消预告片资产未完成的任务，A141） | 随调用方事务 |
| `06:779` | `production_record.pipeline_state` | —→uploading（规格化、补标产物，worker 部分） | 任务进程：规格化、补标任务收尾 | 任务进程 |
| `06:780-783` | `production_record.pipeline_state` | uploading→checking / rejected；checking→ready / rejected | 任务进程：入库与体检任务收尾；779 的上传过期由 `media.sweep` | 任务进程 |
| `06:896` | `playable_asset.state` | —→processing（样片体检通过，worker 部分） | 任务进程：体检收尾 | 任务进程 |
| `06:897-900` | `playable_asset.state` | processing→ready / failed / retired；ready→retired | 任务进程：转码、水印任务收尾；898 剧目下架停用预告片随 `admin.drama.delist` 同事务 | 任务进程 |
| `06:901` | `playable_asset.state` | processing / failed→retired（剧目因版权或许可下架） | 随 `admin.drama.delist`（rights_issue）同事务调 `media.retireDramaMedia`，并取消该资产未完成的媒体任务（A141） | 随调用方事务 |
| `06:902` | `playable_asset.state` | failed→ready（worker 部分） | 任务进程（`admin.mediaJob.retry` 之后的收尾） | 任务进程 |
| `06:962-970` | `zip_bundle.zip_state` | ensureZip | delivery 在调用方事务里调：`portal.orderItem.downloadUrls`、`admin.deliveryRelease.pack`、`admin.deliveryTicket.pushPackage`（预打包）；小程序只取单集，不调。下载页 `kind = zip`：`failed` 时请求带 `retry: true` 才重打（failed → building），不带则停在 failed（failed → failed，A99）；`kind = publish_list` 用只查不建的 `peek`：不建行、不建任务，只有 ready → ready 顺延保留期（p01 3.8；`retry`、`peek` 待 06 分组回写 ensureZip 签名） | 随调用方事务 |
| `06:972-974` | `zip_bundle.zip_state` | building→ready / 不变 / failed | 任务进程 `zip_package` 收尾 | 任务进程 |
| `06:975` | `zip_bundle.zip_state` | →none（作废缓存） | delivery 在调用方事务里调：清单修订 `admin.deliveryTicket.publishList.replace`、补发 `admin.reissue.publish`、成片包关闭（定时器 `usage.end`、`admin.cancelRequest.execute`） | 随调用方事务 |
| `06:976-977` | `zip_bundle.zip_state` | ready→none；清单文件列置空 | 周期任务 `media.sweep`（清除后另起事务） | 周期任务 |
| `06:1183` | `store_asset.processing_state` | pending→processing（worker 部分） | 任务进程：第一个理解任务被创建 | 任务进程 |
| `06:1184` | `store_asset.processing_state` | →processed | 任务进程：理解任务收尾 | 任务进程 |
| `06:1190` | `store_asset.adopted_count` | 写入采用记录 | 上层模块的业务事务：`admin.deliveryTicket.episodeOutput.create`、`admin.ad.adVersion.create` | 随调用方事务 |
| `06:1193` | store_asset.due_at（日历重算） | 重算并重设 sla.breach | 订阅者 `media.onCalendarImported` | 订阅者 |
| `06:1500` | `ocr_result.status` | —→pending | 随凭证上传事务：`m.paymentOrder.transferProof.create`、`admin.paymentOrder.transferProof.create` | 随调用方事务 |
| `06:1501` | `ocr_result.status` | pending→ok / unavailable / unreadable | 任务进程：识别任务收尾 | 任务进程 |

### 5.8 账本（07）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `07:436` | `billing_account.sub_status` | none/expired→active（fulfill） | 入账入口（见 5.1） | 回调处理 |
| `07:437` | `billing_account.sub_status` | active→active（续接、升级、延长） | 入账入口（见 5.1）；到期续接由 advance（进程内循环“账务推进”、`billing.sweep.daily`） | 进程内循环 |
| `07:438` | `billing_account.sub_status` | active→expired | advance：进程内循环“账务推进”、写操作开头、周期任务 `billing.sweep.daily` | 进程内循环 |
| `07:440` | `billing_account.sub_status` | active→expired / none（退款收回） | 退款执行与差异单处理的事务：`admin.refundRequest.execute`、`admin.refundRequest.recordOffline`、`admin.paymentException.resolve` | 随调用方事务 |
| `07:539-540` | `subscription_term.status` | （新建）→scheduled / active | 入账入口（见 5.1） | 回调处理 |
| `07:541` | `subscription_term.status` | scheduled→active | advance（进程内循环“账务推进”、`billing.sweep.daily`）；退款提前生效随退款执行事务 | 进程内循环 |
| `07:542` | `subscription_term.status` | scheduled→cancelled | 随 `admin.refundRequest.execute`、`admin.refundRequest.recordOffline` | 随调用方事务 |
| `07:543` | `subscription_term.status` | active→ended | advance | 进程内循环 |
| `07:545-547` | `subscription_term.status` | →refunded / cancelled | 随退款执行与差异单处理：`admin.refundRequest.execute`、`admin.refundRequest.recordOffline`、`admin.paymentException.resolve` | 随调用方事务 |
| `07:553-556` | subscription_term.refund_request_id（标记） | 开、合 | 随退款申请的提交、驳回、撤回、作废、执行与差异单处理事务 | 随调用方事务 |
| `07:687` | `grant_schedule.status` | pending→granted | advance（进程内循环“账务推进”、`billing.sweep.daily`）；fulfill（入账入口（见 5.1）） | 进程内循环 |
| `07:688` | `grant_schedule.status` | pending→cancelled | 随退款执行与差异单处理事务 | 随调用方事务 |
| `07:844` | `point_hold.status` | held→captured（开工） | 定时器 `order.start`；`admin.ad.assign` 与超次修改另由接口承担 | 定时器 |
| `07:845-846` | `point_hold.status` | held→released；captured→refunded_* | 随取消执行事务（`admin.cancelRequest.execute`；`cancel.auto_execute` 随提交事务）；applyAdjustment 随 `admin.pointAdjustmentRequest.approve` | 随调用方事务 |

### 5.9 付款（08）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `08:164` | `billing_order.status` | pending_payment→paid（applyPayment） | 入账入口（见 5.1） | 回调处理 |
| `08:165` | `billing_order.status` | →cancelled（金额或付款人不符） | 入账入口（见 5.1） | 回调处理 |
| `08:166` | `billing_order.status` | pending_payment（微信）→cancelled（超时） | 定时器 `po.expire`（先查单，名下尝试都 closed 才取消） | 定时器 |
| `08:175` | `billing_order.status` | pending_payment（对公）→cancelled（到期） | 定时器 `po.transfer_ttl` | 定时器 |
| `08:177` | `billing_order.status` | paid→refunded | 退款交易成功（含 08:529 回调晚到）：回调 `hooks.wechatpay.refund.notify`、定时器 `rf.poll`、周期任务 `bill.download`；`admin.refundRequest.recordOffline`、`admin.paymentException.resolve`（补记渠道退款）由接口承担 | 回调处理 |
| `08:199` | `billing_order.fulfillment_status` | none→done / blocked | 入账入口（见 5.1） | 回调处理 |
| `08:317` | `payment_txn.status` | created/prepaid/closed→succeeded | 回调 `hooks.wechatpay.transaction.notify`；定时器 `po.expire`（查单）；周期任务 `bill.download`；`m.paymentOrder.sync`、`m.paymentOrder.wechatPrepay`、`m.paymentOrder.cancel`（查单为已支付）由接口承担 | 回调处理 |
| `08:318` | `payment_txn.status` | created/prepaid→closed | 定时器 `po.expire`（关单）；`m.paymentOrder.cancel`、`m.paymentOrder.sync`、`m.paymentOrder.wechatPrepay`（换付款人）由接口承担 | 定时器 |
| `08:319` | `payment_txn.status` | —→succeeded（对账补建孤儿交易） | 周期任务 `bill.download` | 周期任务 |
| `08:404` | `transfer_proof.check_result` | pending→pending（识别完成） | 订阅者 `billing.onOcrCompleted` | 订阅者 |
| `08:529` | `refund_request.status` | pending_execution→done（退款回调晚到，A102） | 回调 `hooks.wechatpay.refund.notify`；周期任务 `bill.download`（与 08:531 同一段退款结果处理代码；`rf.poll` 在交易到达失败终态时已取消，正常走不到这一行）；同事务取消执行时限定时器（若仍在） | 回调处理 |
| `08:531` | `refund_request.status` | executing→done | 回调 `hooks.wechatpay.refund.notify`；定时器 `rf.poll`；周期任务 `bill.download` | 回调处理 |
| `08:532` | `refund_request.status` | executing→pending_execution | 回调 `hooks.wechatpay.refund.notify`；定时器 `rf.poll`；命令行 `refund:abandon-txn`；`admin.refundRequest.confirmNotAccepted` 由接口承担 | 回调处理 |
| `08:663` | `refund_txn.status` | created→processing | `admin.refundRequest.execute` 三段式第 ③ 步；内联失败时订阅者 `billing.submitRefundTxn`；定时器 `rf.poll`；结果先于提交结果落库的竞态由回调 `hooks.wechatpay.refund.notify` 先按“微信受理”补这一步（h01 3.2） | 订阅者 |
| `08:664` | `refund_txn.status` | created→created（记 fail_code，同单号重试） | 订阅者 `billing.submitRefundTxn`；`admin.refundRequest.retry` 由接口承担 | 订阅者 |
| `08:666-667` | `refund_txn.status` | processing→closed / abnormal | 回调 `hooks.wechatpay.refund.notify`；定时器 `rf.poll` | 回调处理 |
| `08:668` | `refund_txn.status` | abnormal→abandoned | 命令行 `refund:abandon-txn`（两人确认） | 命令行 |
| `08:669` | `refund_txn.status` | 任意→succeeded | 回调 `hooks.wechatpay.refund.notify`；定时器 `rf.poll`；周期任务 `bill.download` | 回调处理 |
| `08:760` | `payment_exception.status` | —→open（系统开单） | 入账入口（见 5.1）；退款结果处理（回调、`rf.poll`）；查单（`po.expire`、`rf.poll`，`detected_by = query`）；周期任务 `bill.download`（对账差异）；键按 h01 2.6，同键已有则跳过；`m.paymentOrder.*`、`admin.reconciliation.rerun`、`admin.transferProof.confirm` 等由接口承担 | 回调处理 |
| `08:761` | `payment_exception.status` | —→auto_healed（对账自愈留痕） | 定时器 `po.expire`（查单补记）、周期任务 `bill.download`；`m.paymentOrder.sync`、`m.paymentOrder.wechatPrepay`、`m.paymentOrder.cancel` 由接口承担 | 周期任务 |
| `08:763` | `payment_exception.status` | resolving→resolved | 随退款申请完成（08:529、531：回调、`rf.poll`、`bill.download`；线下登记由接口承担） | 回调处理 |
| `08:764` | `payment_exception.status` | resolving→open | 随 `admin.refundRequest.reject` / `withdraw` / `void` | 随调用方事务 |
| `08:767` | `payment_exception.status` | open→auto_healed（bill_only 重新归类） | 入账入口（见 5.1） | 回调处理 |
| `08:768` | `payment_exception.status` | open→auto_healed（platform_only） | 周期任务 `bill.download` | 周期任务 |
| `08:852-857` | `wx_bill_file.status` | 全部迁移 | 周期任务 `bill.download` | 周期任务 |
| `08:935-939` | `wx_bill_line.match_state` | 写入与重跑 | 周期任务 `bill.download`；后台“重新对账”由接口承担 | 周期任务 |
| `08:1008-1011` | `recon_day.status` | wait / ok / diff / fixed | 周期任务 `bill.download`；差异处理完后的 fixed 随 `admin.paymentException.resolve` | 周期任务 |
| `08:1114` | `invoice_request.status` | pending→rejected（order_refunded） | 随付款单退款成功（08:177：回调、`rf.poll`、`bill.download`，含 08:529 回调晚到） | 回调处理 |
| `08:1115` | `invoice_request.status` | issued→red_pending | 随 `admin.refundRequest.approve`、`admin.paymentException.resolve` | 随调用方事务 |
| `08:1117` | `invoice_request.status` | red_pending→issued | 随 `admin.refundRequest.void`（驳回、撤回发生在审批通过之前，那时还没有 red_pending） | 随调用方事务 |
| `08:1213-1214` | `invoice_doc.email_state` | none→queued / skipped | 随 `admin.invoiceRequest.issue` | 随调用方事务 |
| `08:1215-1216` | `invoice_doc.email_state` | queued→sent / failed | 订阅者 `billing.onMailResult` | 订阅者 |

### 5.10 订购与广告（09）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `09:197` | drama_order.status（推导） | pending_start→producing | 定时器 `order.start` | 定时器 |
| `09:198` | drama_order.status（推导） | 随工单步骤变化（系统部分） | 随工单的系统迁移：定时器 `usage.end`、`flow.reevaluate()` 所在事务 | 随调用方事务 |
| `09:199-201` | drama_order.status（推导） | →after_sale / 恢复 / 执行结果（系统部分） | 订阅者 `order.onQualificationDecided`（整店取消提交）；`cancel.auto_execute` 随提交事务 | 订阅者 |
| `09:352` | `order_item.phase` | pending_start→producing | 定时器 `order.start` | 定时器 |
| `09:353` | `order_item.phase` | pending_start→cancelled（系统部分） | `cancel.auto_execute` 随取消申请提交事务 | 随调用方事务 |
| `09:358` | `order_item.phase` | to_launch/live→ended / refunded（系统部分） | 随 10:188 的系统求值 | 随调用方事务 |
| `09:547` | `cancel_request.status` | —→pending_approval（整店取消） | 订阅者 `order.onQualificationDecided` | 订阅者 |
| `09:550` | `cancel_request.status` | pending_approval→not_executed（对象失效时系统撤回） | 使对象失效的那个事务（如 `admin.entity.close`） | 随调用方事务 |
| `09:551` | `cancel_request.status` | pending_execution→done（触发者列的“系统”） | V1.0 没有系统执行入口：免审批的自动执行走 09:553，其余（含整店取消）由财务经 `admin.cancelRequest.execute` 执行；触发者列的“系统”请 09 分组删去或注明只指 09:553 | 随调用方事务 |
| `09:552` | `cancel_request.status` | pending_execution→not_executed（对象失效时系统作废） | 使对象失效的那个事务 | 随调用方事务 |
| `09:553` | `cancel_request.status` | pending_approval→done（auto_execute） | 随取消申请的提交事务：`admin.order.cancelRequest.create`、`admin.ad.cancelRequest.create`、`m.cancelRequest.create`（V1.1）、订阅者 `order.onQualificationDecided` | 随调用方事务 |
| `09:808-809` | `ad.status` | →cancelled | 随取消执行（`admin.cancelRequest.execute`、`cancel.auto_execute`） | 随调用方事务 |
| `09:1087` | ad、ad_revision、cancel_request 的时限（日历重算） | 重算并重设 sla.breach | 订阅者 `order.onCalendarImported` | 订阅者 |

### 5.11 交付（10）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `10:173` | `delivery_ticket.step` | plan_confirm→ad_prep（系统求值部分） | `flow.reevaluate()`，随 `m.deliveryPlan.confirm`、暂停恢复的事务；进程内循环 `flow.reevaluate_sweep`；`delivery.I3` 自愈 | 随调用方事务 |
| `10:174` | `delivery_ticket.step` | ad_prep→sample_making（ads.ready） | `flow.reevaluate()`，随广告就绪的写入（`m.ad.confirm` 等）同事务；补偿同上 | 随调用方事务 |
| `10:179` | `delivery_ticket.step` | →ad_prep（ad.reopened） | `flow.reevaluate()`，随 `m.ad.requestChange`、`admin.ad.requestChange` 同事务；补偿同上 | 随调用方事务 |
| `10:180` | `delivery_ticket.step` | batch_compose→delivering | `flow.reevaluate()`，随 `admin.deliveryTicket.inspectEpisodes`、`admin.deliveryTicket.inspectPackage` 同事务；补偿同上 | 随调用方事务 |
| `10:183-185` | `delivery_ticket.step` | launch.changed | `flow.reevaluate()`，随 `m.launchTask.submit`、`admin.launchSubmission.approve` / `reject` / `revoke` 同事务；补偿同上 | 随调用方事务 |
| `10:186-187` | `delivery_ticket.step` | →takedown（usage.ended） | 定时器 `usage.end`；下架任务全部由商家确认时随 `m.takedownTask.confirm` 的 reevaluate | 定时器 |
| `10:188` | `delivery_ticket.step` | takedown→archived | `flow.reevaluate()`，随 `admin.takedownTask.check`、`admin.takedownTask.batchCheck`、`m.takedownTask.confirm`（抽查放行）；补偿同上 | 随调用方事务 |
| `10:189-190` | `delivery_ticket.step` | ticket.hold / ticket.resume（from = to） | 随加、解暂停原因的事务：取消申请提交与关闭（接口、订阅者 `order.onQualificationDecided`）、方案修订与确认（接口）；`delivery.I2` 自愈 | 随调用方事务 |
| `10:191-192` | `delivery_ticket.step` | →terminated / takedown（ticket.terminate） | 随取消执行（`admin.cancelRequest.execute`、`cancel.auto_execute`） | 随调用方事务 |
| `10:193` | `delivery_ticket.step` | in_service→launch_verify（launch.verify_revoked） | 随 `admin.launchSubmission.revoke` | 随调用方事务 |
| `10:272` | delivery_ticket_stage.due_at（日历重算） | 重算并重设 sla.breach（工单另写 from = to） | 订阅者 `delivery.onCalendarImported` | 订阅者 |
| `10:641` | `sample.status` | uploaded→check_rejected | 订阅者 `delivery.onProductionChecked` | 订阅者 |
| `10:648` | `sample.status` | →superseded（系统） | 随 `admin.deliveryTicket.sample.create`（新版本）；广告重新打开时随 `flow.reevaluate()` | 随调用方事务 |
| `10:649` | `sample.status` | confirmed→superseded | 随 `admin.deliveryTicket.rework` | 随调用方事务 |
| `10:724` | `episode_output.status` | uploaded→check_rejected | 订阅者 `delivery.onProductionChecked` | 订阅者 |
| `10:881-883` | `delivery_release.state` | pushed→superseded / closed | 随推送与补发（接口）；883 随定时器 `usage.end` 与归档求值；882 随取消执行 | 随调用方事务 |
| `10:884` | `delivery_release.state` | closed→pushed（版权续期） | 定时器 `usage.resync` | 定时器 |
| `10:1036` | `download_grant.state` | active→revoked | 随定时器 `usage.end`、取消执行、工单终止 | 随调用方事务 |

### 5.12 发布（11）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `11:299` | `launch_task.review_status` | —→pending | 随 `admin.deliveryTicket.pushPackage`（delivery 调 publish） | 随调用方事务 |
| `11:304-305` | `launch_task.review_status` | launch.void / launch.settle | delivery 同一事务调用：定时器 `usage.end`（第 15、15b 行）；下架任务全部由商家确认时随 `m.takedownTask.confirm` 的 reevaluate；`admin.deliveryTicket.reevaluate`；`admin.cancelRequest.execute`（第 19、20 行） | 定时器 |
| `11:401` | `launch_submission.result` | pending→withdrawn | 与 11:304-305 同一事务 | 定时器 |
| `11:542` | `patrol_task.status` | —→pending（系统部分） | 周期任务 `patrol.weekly_generate` | 周期任务 |
| `11:547` | `patrol_task.status` | →void | 随订单项终止（`admin.cancelRequest.execute`）、使用期结束（定时器 `usage.end`）、核验撤销（`admin.launchSubmission.revoke`） | 随调用方事务 |
| `11:549` | follow_up（巡检跟进待办） | 写系统跟进待办 | 定时器 `patrol.followup` | 定时器 |
| `11:653` | `takedown_task.status` | —→pending_merchant（系统） | 定时器 `takedown.create`；定时器 `usage.end`（进入到期下架）；随 `admin.deliveryTicket.pushPackage`、`admin.cancelRequest.execute` | 定时器 |
| `11:656` | `takedown_task.status` | merchant_confirmed→checked（sample_release） | 随 `m.takedownTask.confirm`（抽签未中） | 随调用方事务 |
| `11:658` | `takedown_task.status` | merchant_confirmed→pending_merchant（basis_reopen） | 随 `admin.launchSubmission.approve` | 随调用方事务 |
| `11:659` | `takedown_task.status` | pending_merchant→不变（escalate，系统部分） | 定时器 `takedown.overdue` | 定时器 |
| `11:661` | `takedown_task.status` | pending_merchant→void | 定时器 `usage.resync` | 定时器 |
| `11:671` | takedown_task.check_due_at（日历重算） | 重算（另写 from = to） | 订阅者 `publish.onCalendarImported` | 订阅者 |

### 5.13 客服（12）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `12:155` | `service_ticket.status` | awaiting_confirm→resolved（auto_resolve） | 定时器 `service.auto_resolve` | 定时器 |
| `12:159-160` | `service_ticket.status` | assign / transfer（from = to，系统部分） | 员工禁用移交随 `admin.staff.disable`、`admin.staff.handover`；转移交付经理随 `admin.store.reassignDeliveryManager`（A136）；`staff.I10` 自动改派（`invariant.full`） | 随调用方事务 |
| `12:161` | `service_ticket.status` | escalate（from = to） | 定时器 `service.first_response_due` | 定时器 |
| `12:189` | service_ticket.response_due_at（日历重算） | 重算并改期（另写 from = to） | 订阅者 `support.onCalendarImported` | 订阅者 |

### 5.14 通知与文书（13）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `13:246-247` | `wx_template_slot.status` | active→disabled（template_invalid、field_mismatch_streak） | 任务进程：notify 投递任务按微信返回码判定，同时告警 | 任务进程 |
| `13:424` | `notification_delivery.status` | —→pending（派发、补发判定） | 订阅者 `notify.onEvent` 的派发函数；周期任务 `notify.remind_scan`；补发判定随失败终态事务 | 订阅者 |
| `13:425` | `notification_delivery.status` | —→sending（直发） | `notify.sendDirect`：identity 在验证码、换绑事务提交后调用；员工激活码（A95）；ops 值班告警；`admin.notifyScene.testSend`、`admin.smsTemplate.testSend` 由接口承担 | 随调用方事务 |
| `13:426-434` | `notification_delivery.status` | 认领、守卫、预检、顺延、调用、成功、重试、失败 | 任务进程：notify 队列的投递任务 | 任务进程 |
| `13:431、433-434` | `notification_delivery.status` | 直发测试投递 sending→sent / failed | 随 `admin.notifyScene.testSend`、`admin.smsTemplate.testSend` 的第三段事务写入，不经任务进程（a09；C51）；租约过期后的 failed 仍归 `notify.scan`（13:436） | 随调用方事务 |
| `13:435-436` | `notification_delivery.status` | sending 租约过期→pending / failed | 进程内循环 `notify.scan` | 进程内循环 |
| `13:437` | `notification_delivery.status` | failed→sent（迟到的成功） | 任务进程：投递任务（回执回写只追加 `receipt_status`、`receipt_reported_at`，不改投递状态，13:381、441） | 任务进程 |
| `13:766-767` | `agreement_version.status` | pending→active；active→superseded | 周期任务 `docs.sweep` | 周期任务 |
| `13:940-946` | `license_letter.status` | 建信、生效、止日变化、作废（对齐函数） | 订阅者 `docs.onLicenseFacts`；成片交付守卫 `docs.ensureLetters` 随 `admin.deliveryTicket.pushPackage`；`docs.N6` 自愈（`invariant.full`） | 订阅者 |
| `13:1036` | `license_letter_revision.render_status` | —→queued | 同 13:940-946 的对齐函数（另有 `admin.licenseLetter.correct`、`admin.licenseLetter.void` 由接口承担） | 订阅者 |
| `13:1037-1038` | `license_letter_revision.render_status` | queued→rendering→ready | 任务进程：docs 渲染队列（订阅者 `docs.onRevisionQueued` 入队） | 任务进程 |
| `13:1039-1040` | `license_letter_revision.render_status` | rendering→queued / failed（租约过期） | 周期任务 `docs.sweep` | 周期任务 |

### 5.15 配置与数据（14）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `14:388` | `site_config_revision.status` | published→archived | 随 `admin.siteConfig.publish` | 随调用方事务 |
| `14:528` | `site_notice.status` | —→announced | 随 `admin.plan.planRevision.create`、`admin.pricingChange.create`、`admin.agreementVersion.schedule` | 随调用方事务 |
| `14:662` | `checklist_template.status` | active→retired | 随 `admin.checklistTemplate.activate` | 随调用方事务 |
| `14:889` | `report_month_close.status` | —→closed | 订阅者 `reports.onMonthClosed`（预留：billing.month_closed 补建后才有） | 订阅者 |
| `14:890` | `report_month_close.status` | closed→superseded（系统部分） | 周期任务 `reports.finalize`；重出由 `admin.reportMonthClose.reissue` 承担 | 周期任务 |
| `14:979` | `export_job.status` | queued→running | 任务进程：export 队列 | 任务进程 |
| `14:981` | `export_job.status` | running→succeeded | 任务进程：export 队列 | 任务进程 |
| `14:982` | `export_job.status` | running→queued | 周期任务 `export.sweep` | 周期任务 |
| `14:983` | `export_job.status` | running→failed | 任务进程；周期任务 `export.sweep` | 任务进程 |
| `14:984` | `export_job.status` | succeeded→expired | 周期任务 `export.sweep`；下载时复核不通过由 `admin.exportJob.downloadUrls` 承担 | 周期任务 |

### 5.16 集成与运维（15）

| 出处 | 表.列 | 迁移 | 负责方 | 方式 |
| --- | --- | --- | --- | --- |
| `15:114` | `webhook_event.process_state` | —→processed / ignored（内联） | 回调处理：`hooks.wechatpay.transaction.notify`、`hooks.wechatpay.refund.notify`、`hooks.ci.mediaJob.wake`、`hooks.asr.mediaJob.wake`、`hooks.sms.statusReport.receive`（内联模式时） | 回调处理 |
| `15:115-116` | `webhook_event.process_state` | —→received / failed（收件箱、兜底写入） | 回调处理：`hooks.wechat.message.receive`、`hooks.wecom.event.receive`；116 为微信支付内联事务失败后的兜底 | 回调处理 |
| `15:117-119` | `webhook_event.process_state` | received/failed→processed / ignored / failed / dead | 订阅者 `security.onWebhookReceived`；进程内循环 `webhook.reprocess`；117 另含同一事件再次到达时的内联处理 | 订阅者 |
| `15:127` | webhook_event.payload（不是迁移） | 到期清除载荷 | 周期任务 `ops.retention` | 周期任务 |
| `15:120` | `webhook_event.process_state` | dead→received（人工重置） | 命令行（须 `--staff` 指定员工）；后台由 `admin.webhookEvent.retry` 承担；都不发 `webhook.received`，由进程内循环 `webhook.reprocess` 领取 | 命令行 |
| `15:251-253` | `alert_event.status` | —→open；再次越限、升级 | 进程内循环“探针”；告警端口 `alerts.raise`（ops 的独立短事务） | 进程内循环 |
| `15:255-256` | `alert_event.status` | open/acked→resolved（探针恢复、静默期满） | 进程内循环“探针” | 进程内循环 |
| `15:258` | `alert_event.status` | resolved→新建 open | 进程内循环“探针”；`alerts.raise` | 进程内循环 |
| `15:254、257` | `alert_event.status` | open→acked；open/acked→resolved（人工） | 命令行 `cli.alerts.*`（指定员工身份）；后台由 `admin.alert.acknowledge`、`admin.alert.resolve` 承担 | 命令行 |
| `15:331-334` | `invariant_run.status` | —→running→succeeded / failed | 周期任务 `invariant.full`、`invariant.quick`；发布编排与演练脚本；`admin.invariantRun.create` 由接口承担 | 周期任务 |
| `15:427-430` | invariant_violation（处理过程） | 新建、再次发现、自愈 | 周期任务 `invariant.full`、`invariant.quick`；端口 `invariants.report`（如 `flow.STUCK_TICKET`） | 周期任务 |
| `15:431` | invariant_violation（处理过程） | 人工处理 | 命令行（指定员工身份）；后台由 `admin.invariantViolation.resolve` 承担 | 命令行 |
| `15:432` | invariant_violation（处理过程） | 已解决→再次发现新建 | 周期任务 `invariant.full`、`invariant.quick` | 周期任务 |


## 6. 事件的版本与兼容

出站事件、定时器 kind 与载荷不进 OpenAPI，不受小程序在役标签约束；兼容的对象是**同时在跑的 api 与 worker 两个版本**（滚动发布、回滚），以及事件行永久保留带来的**重放**（M65；人工重投、自愈重放）。规则（C84；C79 的 E1；d7:247）：

| 编号 | 规则 |
| --- | --- |
| V1 | 事件名、`aggregate_type`、载荷键名一经在某个服务端发布标签里写出即冻结；要改名就新开一个事件，新旧并行一个发布周期后再停发旧的 |
| V2 | 载荷只增字段：新字段在 Zod schema 里是可选的（或带默认值），订阅者缺字段时有兜底；不删字段、不改类型、不改含义；必有的键不能改成可空 |
| V3 | 载荷枚举加值：订阅者对未知值走兜底分支（记日志后按“无需处理”返回成功），不抛错；需要处理新值的订阅者与发出方的改动同批上线、订阅者先发布 |
| V4 | 新事件类型、新枚举值、新订阅者遵守 E1：版本 N 先在契约里登记并让订阅者能识别（只进读路径），版本 N+1 才由发出方写出。否则旧 worker 收到不认识的事件会按 01:282 每 5 分钟重试、24 小时后记为失败 |
| V5 | 确需破坏载荷时把 `v` 加 1：订阅者先发布、能同时处理 `v` 与 `v + 1`，之后发出方才写 `v + 1`；旧版本的分支保留到该事件的全部投递行都已 `done` 或人工处理完 |
| V6 | 下线事件：先移除订阅者登记，再停发；契约里的 schema 标 `deprecated` 保留，供重放与“流程运维”展示历史载荷 |
| V7 | 订阅者改名等于新订阅者（投递行按名展开）：旧名的 `pending`、`retry`、`dead` 行在“流程运维”处理完后才从登记表移除 |
| V8 | 定时器同理：`kind` 改名等于新 kind；`timer.payload` 只增字段；去重键的写法改变时，在途的 `scheduled` 行由迁移脚本取消旧键再登记新键（同一语义目标只能有一行未取消的定时器，`uq_timer_dedupe_key_live`）；处理器必须能处理旧载荷 |
| V9 | 契约自测（本稿补充）：`contract:compat` 对事件目录与定时器登记表做结构比较，按 V1–V3、V8 判定破坏性变更；事件名、订阅者名、kind 的格式按 01 分组的 CHECK 校验 |

## 7. 自查

### 7.1 状态机表的覆盖

脚本扫描 15 份分组文档里全部状态机表（含技术状态、派生阶段、子状态）共 515 行：288 行进入第 5 节（其中“随调用方事务”的行同时要求对应接口文档写出）；6 行是终态“任何 → 不变”；其余 221 行由人经接口触发，归各接口文档。第 5 节另有 22 行不是状态迁移表的行（日历重算、归档时间、跟进待办、匹配结果、对账汇总、载荷清除），一并列出负责方。触发者写“系统”、却找不到系统入口的一行（09:551）在 5.10 写明，请 09 分组改写。以上是初稿时的计数；第三轮按现行数据模型重扫，新增或改写的状态机行 8 行：系统迁移 2 行补进第 5 节（08:529 退款回调晚到，A102；06:901 剧目下架停用资产，A141），06:695 改写为“任意未结束状态 → canceled”；其余（02:125、690 的老板更换建号与建老板关系，06:199-201 员工彻底删除）由员工经接口触发，归 a03、a01。另补一行非迁移归属：直发测试投递的 13:431、433-434 随测试发送接口的第三段事务。

### 7.2 路线图对照

路线图 653 条接口的 `notes` 与 `transitions` 里出现的点分名，第一段与本文事件前缀相同的共 118 个：

- 事件名 10 个，都在目录里：`calendar.imported`、`drama.tier_changed`、`license_letter.revision_queued`、`merchant_user.phone_changed`、`payment_txn.succeeded`、`plan.confirmed`、`sample.change_requested`、`sample.confirmed`、`store.qualification.approved`、`webhook.received`。
- 状态迁移事件码 43 个（写在 `transitions` 的括号里，如 `plan.confirm`、`launch.changed`、`ticket.hold`），按 N4 不是出站事件，不要求在目录里。
- 其余 65 个是表名列名（`ad.status`、`store.lifecycle`）、权限点与能力点（`billing.adjust.approve`、`asset.upload`）、函数名（`billing.applyAdjustment`、`media.ensureZip`）与文件名，不是事件。
- 对不上的事件名：无。初稿发现的一处列名笔误（`admin.entity.close` 的 `transitions` 把门店生命周期列写错，应为 `store.lifecycle`，02:610）a03 第二轮已改。

路线图没有结构化的“事件”字段；各接口文档按 C81 在“触发的状态迁移”里写事件名时，取第 3 节的名字。

### 7.3 其他接口文档对照（第三轮）

对照其余 19 份结构化清单（`frag/*.json`）里全部接口的 `events`：第三轮之前不在目录里的 4 个（a05 的 `order.item.launch_rescheduled`、`package.reissue_opened`、`ticket.episode_qc_failed`，m08 的 `service_ticket.supplemented`）已补登进 3.9、3.10、3.12，现在全部在目录里。初稿记的两处不一致已关闭：m01 改用 `merchant_user.wechat_bound`，m07 改用 `invoice.requested`。各清单写出的发出方与第 3 节“触发”栏逐个对过，本轮补齐了触发栏漏列的接口（如 `admin.store.assignDeliveryManager`、`admin.reconciliation.rerun`、`admin.licenseLetterRevision.rerender`、`m.takedownTask.confirm`）。

## 8. 待确认

只留需要产品、业务、法务决定的事。初稿第 1–8、10–13、15、16 项已关闭（已由裁决定下，或属数据模型回写与本文默认做法，去向见第 9 节“第三轮”），保留的两项沿用原编号，便于其他文档引用。

| # | 问题 | 默认做法 | 影响 |
| --- | --- | --- | --- |
| 9 | d4 的三项周期巡检在数据模型没有落点：名额超限清单（每日）、手机号组件用量对账（每月）、权限复核清单（每周） | 名额超限的通知由订阅者 `tenant.onEntitlementChanged`（`billing.subscription.rolled_over` / `.expired`）承担；另外两项做成 a02 报表或导出，不设周期任务 | 业务确认；若要周期任务，01 分组 3.3 与 4.2 补登 |
| 14 | `drama.license_scope_changed`、`drama.permit_changed` 的订阅者（d8 第 9 节、10-Q5：授权书是否换版、在途订单怎么办） | V1.0 只发不订阅 | 法务、业务定后补订阅者 |

## 9. 修订记录

| 日期 | 改动 | 依据 |
| --- | --- | --- |
| 2026-10-03 | 初稿：事件目录 216 个（另不发 7、预留 1）、订阅者 34 个、定时器 18 个 kind、周期任务 25 个、进程内循环 11 个、非 HTTP 迁移归属 192 行；命名规则 N1–N7、载荷规则 P1–P7、发事件规则 E1–E8、版本规则 V1–V9 | A40；C79；C84 |
| 2026-10-03 | 第三轮（含第二轮未做完的输入）。① 行号：初稿早于 08 分组插入 A102 一行，08:≥529 的引用全部 +1；“a、b”并列写法里第二个起的行号此前未随数据模型更新，按现行文件重排（06:194、195、902，10:966，01:615、680、681-682 等），归属表单元格里的裸行号同改（278、691、779、898、882、883）。② 事件：补登 `order.item.launch_rescheduled`、`ticket.episode_qc_failed`、`package.reissue_opened`（a05，取代初稿名）与 `service_ticket.supplemented`（A144），目录 220 个；`file.uploaded` 改为确认时发（06:191，A141）；`entity_member.promoted` 并入新建老板关系（create_owner，A143）；`merchant_user.registered` 加 `via`，补老板更换建号的发出方；`entity_member.stores_changed` 加 `invitationId?` 并补 `m.invitation.accept`；`service_ticket.transferred` 加 `assignmentBatchId?`；`ad.returned` 删 `reasonCode`（P5）；`pricing.drama_price_changed` 的 `cause` 加 `tier_template`、触发补 `admin.pricingChange.create`；P3 改为不跟随路径参数名并列出照用的简写。③ 订阅：`service_ticket.closed`（员工关单通知提交人）、`service_ticket.supplemented`、三个新事件、`pricing.drama_price_changed`（选剧单变价提示）、`payment_exception.refund_requested`（原型“已通知商家”）补 `notify.onEvent`；`support.onBizEvent` 补 `approval.withdrawn`；“场景待登记”按 a09 2.9 写出场景键。④ 触发栏按 19 份清单的 `events` 补齐：`admin.store.reassignDeliveryManager`（A136）、`admin.store.assignDeliveryManager`、`m.paymentOrder.wechatPrepay` / `cancel` 就地入账（5.1 入账入口同改）、`admin.ad.cancelRequest.create` 免审批分支、`admin.sample.requestChange`、`admin.licenseLetterRevision.rerender`、`m.takedownTask.confirm`、`admin.deliveryTicket.reevaluate`、`admin.reconciliation.rerun` 等；08:529 回调晚到写进 `approval.executed`、`refund.completed`、`billing_order.refunded`、`invoice.rejected`、`payment_exception.resolved`；`invoice.red_cancelled` 只由作废触发；`m.cancelRequest.create` 标 V1.1。⑤ 定时器与任务：2.3 的 `tmr:` 只用于一次执行只发一条事件的处理器，`events.emit()` 撞键跳过；客服三个键的类型段改为 `service_ticket`（A144）；`service.solution_due` 补 `admin.serviceTicket.forceTransition` 重登；审批 `sla.breach` 只在 `due_at` 非空时登记，退款执行时取消执行时限；`usage.resync` 与对账 ③ 只顺延不缩短（I6）；`po.transfer_ttl` 改为上传凭证取消、驳回重登（d2）；`po.expire` 补取消时提前；`order.rejected_stale` 守卫按轮次；`order.pending_start_sweep` 补“无在途取消”；`rf.poll`、`po.expire`、`bill.download` 开差异单用 h01 2.6 的键。⑥ 回调：退款回调走 T1′ 兜底；短信回执定为内联；收件箱两条 `ignored` 规则；死信人工重置不发 `webhook.received`。⑦ 归属表：列名改 `webhook_event.process_state`、`delivery_release.state`、`download_grant.state`；补 08:529、06:901、直发测试投递（13:431、433-434）三行，共 195 行；06:526-527 补 `admin.uploadBatchItem.update`；ensureZip 一行删小程序整包、写明 `retry` 与 `peek`；13:437 删回执括注；13:425 补 `admin.smsTemplate.testSend`；01:88-90 改引 C51。⑧ 待确认只留第 9、14 项（其余已裁决或转数据模型回写）；文本内容安全不登记补检事件（A137，目录本无占位）；api-check 第 5 节点名的 7 处已改（草案名去掉代码格式、列名改正、初稿自拟的员工激活事件名随待确认第 2 项删除） | A95、A96、A102、A136、A137、A141、A143、A144；C51、C84；review/r3-in、xdoc、r2-xd、r2-reviews（x01） |
| 2026-10-03 | 第四轮（收尾）：r4 输入的 11 条请求（a05 三个事件、a03 建号来源与新老板分支及转移交付经理触发方、m08/a08 的 service_ticket.supplemented 与 closed 订阅者、去重键 service_ticket 全称与 solution_due 的纠偏登记方、m07/a07 入账与差异单入口、tier_template 起因、a09 短信模板测试直发）在第三轮已落地，逐条核对文档与清单一致，本轮无内容改动 | review/r4-in（x01）；A136、A143、A144、A148 |
