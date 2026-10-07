export { createProfile } from "./service.js";
export type { Profile } from "./service.js";
export type { ProfileDeps, ProfileViewer, WriteOptions } from "./context.js";
export { assignDeliveryManager } from "./assign-manager.js";
export type { AssignDeliveryManagerDeps } from "./assign-manager.js";
export { storeGate, assertProfileComplete, industryOpen, storeLocation } from "./gate.js";
export type { StoreGate } from "./gate.js";
export { orderManagerPort, deliveryManagerPort } from "./ports.js";
export type { ManagerAssignment, SyncStoreManager } from "./ports.js";
export { findViolations, PROFILE_INVARIANT_CODES } from "./invariants.js";
export { registration } from "./register.js";

export { adminProfileFactsPort, implementAdminProfileFacts } from "./admin-ports.js";
export type { AdminFacts, AdminFactsQuery, AdminFactSource } from "./admin-ports.js";

export { profilePiiFields } from "./pii-fields.js";
