# ops：探针、告警与备份

W2-24 PR2 复用已合的 kernel `detach`、worker 租约、原循环调度与 timer job 机制。无新 HTTP、表或状态；本包实现既有 `probe`、`backup.pgdump`、`ops.cert_check` 三项 x01。API 装配负责事件事实，worker 主实例负责探针和通知。

## 告警事实与通知

`createAlerts({ tx, clock, logger, providers, oncallPhones?, p2Immediate? })` 的 `raise(input)` 经 `detach(() => tx.run(...))` 独立短事务持久化。业务回滚不删告警，独立写失败只记录固定脱敏错误。指纹为 `rule[:dimension]`；部分唯一索引使 open/acked 同指纹只保留一行，并发次数不丢、级别只升。未知键转成 `ops.unknown_rule:<原键>` 并报告，非法维度拒绝。

生产事件键取自 `alert-rules.ts`，包括已有 calendar/auth/billing/order/outbox/timer/retention/webhook 调用与本包 backup/cert/heartbeat。部署未知 P2 白名单在启动时拒绝。`safeAlertDetail` 只保留有界诊断标量，号码、token、密文、原报文与错误对象不持久化。

探针连续三次正常才恢复；查询失败不清领域告警。事件默认静默六小时后恢复。恢复通知有独立去重空间；人工关闭不自动发恢复。已确认事件重复间隔乘四，级别升高即时提醒。

P1 的群机器人和短信独立并行，机器人使用 `WecomProvider.sendRobotMessage`，不冒充应用消息。短信失败记录固定失败事实并在机器人补充人工联系提示。即时 P2 的机器人连续三次 unavailable/rejected 才升级短信，计数持久化，重启不丢；未配置不冒充发送失败次数。P3 与降噪 P2 立即写真实后台铃铛，外部在北京时间 09:30 汇总；空汇总也发通道心跳，UUID 告警事实去重防止重启重发。

三个级别的铃铛都通过 notify 公开 `sendSystemAlert` 写 notification/staff_message/inbox delivery。`sent` 只指站内真实三表提交。场景禁用/无在职超级管理员是实际零收件人；缺场景或事务失败受控报告，告警事实仍在。每轮优先最多三条到期告警，外呼每通道最多两秒，在 probe 事务外；Provider 接受的结果不代表用户已收到。

真实机器人驱动交 W2-31 拆出的 G7-A 企业微信包；短信驱动/模板交 W2-22。默认未配通道保持 unconfigured，不将替身消息记为云端到达。W2-17 复用同一个 owned 系统告警 producer、模板与去重，不再造第二套通知框架。

## 探针

`createOpsRuntime` 建只读侧池：max=3、statement_timeout=2000ms、lock_timeout=1000ms；每轮60秒、整体20秒、采样并发最多3、单采样2秒。预算不可通过部署阈值提高。采样前后检查 primary holder，每次写在独立短TX里持 worker_lease SHARE 锁；仅完成轮次更新 probe_at，租约丢失/总超时不写完成。停止进程关闭读池与本包队列连接。

实际 SQL 读取 outbox_event/outbox_delivery、timer、invariant_violation、webhook_event、payment_txn/billing_order/refund_txn、当前库长事务、成功逻辑备份摘要，以及装配中每项已实现周期任务的最近计划行。缺备份是真 P1，不输出健康零。查询报错连续三次触发 probe.failed/P2，旧领域告警保留。

实际 BullMQ 队列为 outbox_delivery、timer_run、promote（阈值500/200/100）。只读待执行/活跃/累计失败、近10分钟finishedOn失败（有界2000行，截断显式标识）、最老年龄与暂停时长，暂停列表也计入；暂停优先读有界原队列事件时刻，事件已截掉时明确标为本进程observed起点；不认领、清理或恢复任务。Redis连接失败按实际 unavailable/P1。未来 notify/docs/export/maintenance 队列未运行，不能用空队列冒充已覆盖。

`PROBE_THRESHOLDS_FILE` 为部署显式文件：`{"timer.lag":{"p2":120,"p1":600}}`。只接 CONFIGURABLE_PROBE_RULES 中的实际数值规则；值有限非负、P1≥P2，未知键拒绝。日期均注入 clock，只有租约/数据库监测用库时钟。

D7 26规则的当前可测子集与未来接收方见运行手册2.4节；云监控、gateway窗口聚合、对账、通知失败率、平台额度、媒体清除与外部拨测未在本包伪造为健康，随各生产者/平台配置接入。

## 备份与证书

`createBackup` 使用 PostgreSQL17 `pg_dump -Fc --no-owner --no-password` → age 公钥加密 → StorageProvider 有界流；无未加密中间文件，不读取私钥。连接经 BACKUP_READONLY_URL_FILE、目标桶/前缀显式指定，角色必须由部署保证为 lyx_readonly；不能以配置名替代权限验收。现镜像已有 pg_dump/age，无新增依赖。

最多30分钟、timer原job租约续租/最多3次，完成子进程与上传后 HEAD 核大小≥上次50%，北京时间月首复制 monthly 对象；摘要写 timer.result。流/子进程取消、失败上传与大小错误都失败，不称成功恢复。MinIO 用独立备份目标能力，本业务四桶枚举不变；真实 COS 适配交 W3-01，预发桶/挂载由 W2-27 按授权接入。

证书只检查 CERT_DOMAINS 显式 DNS、443端口，验证信任链/主机名，按剩余天数告警；没有域名时写 cert.unconfigured，不连接猜测域名。测试注入TLS结果，不是部署域名演练。

W2-22 短信健康检查通过既有 Alerts 公口登记两个事件键：`notify.sms_balance_unconfigured` 为 P3、无维度，记录实际 `queried=false` 与完整统计范围/阈值未配；`notify.sms_suspect` 为 P3、维度为九个固定模板键，记录连续5次失败或近期失败过半的判据。它们参与原独立持久、同指纹去重、铃铛与每日汇总；不新增低余额数值规则，不把每日10:20的作业 kind 当告警键，不表示短信已到达。

W2-18 通过同一 Alerts 公口登记三个 P3 事件键：`notify.wx_banned` 与 `notify.wx_filtered` 的维度是服务端已配置的槽位键，详情只含订阅点位枚举、槽位键和 `ban` / `filter` 结果；未知模板不告警，订阅事务成功且非幂等重放后才触发。`analytics.anon_daily_cap` 无维度，详情只有本批匿名新事件的正整数丢弃数。运维侧不引入上报实现，不持久化用户、匿名标识、模板编号或原信封；三个事实沿用原持久化、重复计数、三表铃铛去重和汇总机制。端口接收已验不代表上报包或真实平台联调已完成。

## 实际验证入口

`pnpm exec vitest run --project services packages/services/src/ops/alerts.db.test.ts packages/services/src/ops/probe.db.test.ts packages/services/src/ops/queue-probes.test.ts packages/services/src/notify/system-alert.db.test.ts`：真DB独立提交/并发/恢复/三表站内通知、预算/租约与真Redis队列。

`pnpm exec vitest run --project worker apps/worker/test/probe.test.ts`：原worker装配与关闭；`pnpm exec vitest run --project api apps/api/src/http/admin-ip.test.ts`：真实可信来源和独立审计。

P95 `APP_ENV=test node infra/ci/p95.mjs --concurrency 20 --scale 10 --seed 42` 只认本机 test 连接，通过既有M1 owned守卫新建本轮库/Redis前缀，完成后只收本轮资源。services/testing 先经真实订单/账本/账号绑定用例构造原型，再补足测试助手中既有listed/verified快照的版权/全集/资格历史配套，媒体引用和完整度刷新仍用公开producer。UUIDv7短TX复制完整数据库图，非逐笔业务重放；约5000店/2万订单/98万entry，真实待审核账号单。默认前置执行全部当前可运行full检查（当前89项/17模块），明确flow.STUCK_TICKET只有上报端口。原型出站事件由既有expand/claim/consume路径排空；无匹配的已实现订阅者时实际消费数可为0，准确记录，不能称云通知到达。付款创建实际仅支持新开通，另建100个有完整资格历史配套的新购门店单列统计，采样前再次全89检查覆盖新增输入和全部数据库图，使用占位收款账户、真实bank_transfer创建；不向银行/支付平台发请求。

应用测真实TCP HTTP、正式处理器/鉴权/限流/幂等/响应schema；每目标100真实样本、并发20、固定500ms，错误或超限非0。主样本精确表/entry类型数、准备数量、真实prototype事件类型/匹配已实现subscriber/中继计数、机器load、逐接口错误率、延迟分布/P50/P90/P95进入 `apps/api/dist/p95/report.json`。小规模 smoke 显式标记未测写接口，不代替默认验收。尚未落地工作台四目标逐项 excluded，接收方为 G7-B/M7工作台读侧包（未拆编号）。nightly独立job先准备本作业DB/Redis再测，失败红/always保存报告，保留原Node26检查和required规则。

默认规模预检暴露订单I2逐单复读成本；必要伴随将父锁后复读限定同一初始ID集合的一次查询，并经delivery公开状态公口分批取项/step。完整保留原42项并扩至全部89项，原60秒事务上限、锁序、自愈/savepoint；预检失败报告也保存精确数据规模、检查完成数/耗时与脱敏错误类型，不以空HTTP样本报绿。

本地默认首轮构图失败/0HTTP与第二轮四目标P95超限均保留。第二轮当时仅42项五模块预检且图缺历史配套，不能称完整合法基线；修图后3店12单及额外新购buyer小图全89真实通过，只证明小图，不代替默认规模验收。当前必要性能伴随还在验证，包状态仍进行中。
