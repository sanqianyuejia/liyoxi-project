# notify 系统告警公口

W2-24 必要伴随 `sendSystemAlert(tx, { alertId, fingerprint, severity, recovered, noticeNo, at })` 接受真实 UUID 告警单据与通知序号；L4 ops 向下调用 L1 notify，notify 不查告警或其他上层私表，不做外呼。

唯一场景 `s.system_alert` 的 audience=staff，vars={alertId,fingerprint,severity,recovered}，N0，bizType=alert_event。模板标题/正文分别表达告警级别、恢复与指纹，链接 `/sys/health` 携带告警UUID。收件人是在职 super_admin；缺场景受控错误，禁用/无人返回 disabled/no_recipients。并发用 notification 唯一 dedupe={alert UUID,open/recovered,noticeNo,N0,staff UUID} 判新，再在同TX写 staff_message 和 inbox delivery。sent 只代表实际站内三表写入；不证明任何外部到达。

W2-17 接通知框架时复用 SYSTEM_ALERT_SCENE vars/模板、这个公开producer与去重，不另发业务事件或建立第二套告警消息。已有63场景/槽位/模板种子不改，其他场景派发、提醒扫描、消息页面与企业微信真通道保持各包拥有者。

真库验收：`pnpm exec vitest run --project services packages/services/src/notify/system-alert.db.test.ts`，覆盖三严重度/不同super、并发重复、恢复、禁用/无人/场景缺失与真实delivery状态。
