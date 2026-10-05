// identity 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, event, subscriber } from "./define.js";

export const registry = defineRegistry("identity", {
  events: [
    event("merchant_user.registered", "merchant_user"),
    event("merchant_user.disabled", "merchant_user"),
    event("merchant_user.enabled", "merchant_user"),
    event("merchant_user.deleted", "merchant_user"),
    event("merchant_user.phone_changed", "merchant_user"),
    event("merchant_user.wechat_bound", "merchant_user"),
  ],
  subscribers: [subscriber("identity.onWechatBound", "M2")],
});
