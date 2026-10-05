// profile 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, event, subscriber } from "./define.js";

export const registry = defineRegistry("profile", {
  events: [
    event("store.qualification.submitted", "store"),
    event("store.qualification.approved", "store"),
    event("store.qualification.rejected", "store"),
    event("store.qualification.withdrawn", "store"),
    event("store.qualification_change.submitted", "store"),
    event("store.qualification_change.approved", "store"),
    event("store.qualification_change.rejected", "store"),
    event("store.qualification_change.withdrawn", "store"),
    event("store.profile.changed", "store"),
  ],
  subscribers: [
    subscriber("profile.onTenantLifecycle", "M2"),
    subscriber("profile.onQualificationApproved", "M2"),
    subscriber("profile.onFileModerated", "M3"),
  ],
});
