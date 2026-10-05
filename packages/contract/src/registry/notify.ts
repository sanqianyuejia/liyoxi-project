// notify 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { callback, defineRegistry, event, job, loop, queue, subscriber } from "./define.js";

export const registry = defineRegistry("notify", {
  events: [
    event("notify.mail_delivered", "notification_delivery"),
    event("notify.mail_failed", "notification_delivery"),
    event("manual_reminder.sent", "manual_reminder_log"),
  ],
  subscribers: [
    subscriber("notify.onEvent", "M2"),
    subscriber("notify.onMerchantUserDeleted", "M2"),
  ],
  jobs: [
    job("notify.remind_scan", "M2"),
    job("notify.sms_keepalive", "M2"),
    job("notify.sms_balance", "M2"),
  ],
  loops: [loop("notify_scan", "notify.scan", "M2")],
  queues: [queue("notify", "notify（并发 4，按通道限速）", "M2")],
  callbacks: [callback("hooks.sms.statusReport.receive", "M7")],
});
