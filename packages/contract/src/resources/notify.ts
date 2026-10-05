// notify 模块的表对应的资源名（docs/api/working/resources.json；约定 C10）。一张表一个资源名，三端同名。
// 表、资源名、参数名、端、别名与 resources.json 对账（pnpm api-registries:check）。
import { defineResources, resource } from "./define.js";

export const resources = defineResources("notify", [
  resource("notify_scene", "notify-scenes", "sceneKey", ["admin"]),
  resource("wx_template_slot", "wx-template-slots", "slotKey", ["admin"]),
  resource("sms_template", "sms-templates", "templateKey", ["admin"]),
  resource("notification_delivery", "notification-deliveries", "notificationDeliveryId", ["admin"]),
  resource("merchant_message", "messages", "messageId", ["m"]),
  resource("staff_message", "staff-messages", "staffMessageId", ["admin"]),
]);
