// W0-21 种子：订阅槽位、短信模板、通知场景
export { seed } from "./seed.js";
export {
  DEFAULT_SCENE_BINDING,
  SCENE_BINDINGS,
  sceneBindingOf,
  SMS_TEMPLATE_SEEDS,
  WX_TEMPLATE_SLOT_SEEDS,
} from "./seed-data.js";
export type { SceneBinding, WxTemplateSlotKey } from "./seed-data.js";
// W2-24：唯一的系统告警站内派发，通知框架接入时复用场景/去重。
export { sendSystemAlert, SYSTEM_ALERT_SCENE } from "./system-alert.js";
export type { SystemAlertInput, SystemAlertResult } from "./system-alert.js";
