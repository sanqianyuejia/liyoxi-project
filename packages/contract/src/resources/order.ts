// order 模块的表对应的资源名（docs/api/working/resources.json；约定 C10）。一张表一个资源名，三端同名。
// 表、资源名、参数名、端、别名与 resources.json 对账（pnpm api-registries:check）。
import { defineResources, resource } from "./define.js";

export const resources = defineResources("order", [
  resource("cart_item", "cart-items", "cartItemId", ["m"]),
  resource("drama_order", "orders", "orderId", ["m", "admin"]),
  resource("order_item", "order-items", "orderItemId", ["m", "admin", "portal"]),
  resource("cancel_request", "cancel-requests", "cancelRequestId", ["m", "admin"]),
]);
