// tenant 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, event, subscriber, timer } from "./define.js";

export const registry = defineRegistry("tenant", {
  events: [
    event("entity.created", "entity"),
    event("entity.abandoned", "entity"),
    event("entity.closed", "entity"),
    event("store.created", "store"),
    event("store.archived", "store"),
    event("store.draft_deleted", "store"),
    event("store.restored", "store"),
    event("entity_member.joined", "entity_member"),
    event("entity_member.removed", "entity_member"),
    event("entity_member.promoted", "entity_member"),
    event("entity_member.stores_changed", "entity_member"),
    event("invitation.created", "invitation"),
    event("invitation.accepted", "invitation"),
    event("invitation.revoked", "invitation"),
    event("invitation.expired", "invitation"),
  ],
  subscribers: [subscriber("tenant.onEntitlementChanged", "M2")],
  timers: [timer("invitation.expire", "invitation", "M2")],
});
