// portal 模块的表对应的资源名（docs/api/working/resources.json；约定 C10）。一张表一个资源名，三端同名。
// 表、资源名、参数名、端、别名与 resources.json 对账（pnpm api-registries:check）。
import { defineResources, resource } from "./define.js";

export const resources = defineResources("portal", [
  resource("portal_ticket", "portal-tickets", "portalTicketId", ["m", "portal"]),
]);
