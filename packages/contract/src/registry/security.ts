// security 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { callback, defineRegistry, event, loop, subscriber } from "./define.js";

export const registry = defineRegistry("security", {
  events: [event("webhook.received", "webhook_event")],
  subscribers: [subscriber("security.onWebhookReceived", "M2")],
  loops: [loop("webhook_reprocess", "webhook.reprocess", "M2")],
  callbacks: [
    callback("hooks.wechat.message.receive", "M2"),
    callback("hooks.wecom.event.receive", "M7"),
  ],
});
