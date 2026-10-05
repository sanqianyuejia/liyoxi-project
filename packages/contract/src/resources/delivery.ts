// delivery 模块的表对应的资源名（docs/api/working/resources.json；约定 C10）。一张表一个资源名，三端同名。
// 表、资源名、参数名、端、别名与 resources.json 对账（pnpm api-registries:check）。
import { defineResources, resource } from "./define.js";

export const resources = defineResources("delivery", [
  resource("delivery_ticket", "delivery-tickets", "deliveryTicketId", ["admin"]),
  resource(
    "delivery_plan",
    "delivery-plans",
    "deliveryPlanId",
    ["m", "admin"],
    ["/admin/delivery-plans/{deliveryPlanId}/draft"],
  ),
  resource(
    "sample",
    "samples",
    "sampleId",
    ["m", "admin", "portal"],
    ["/m/order-items/{orderItemId}/sample", "/portal/order-items/{orderItemId}/sample"],
  ),
  resource("episode_output", "episode-outputs", "episodeOutputId", ["admin"]),
  resource(
    "delivery_release",
    "delivery-releases",
    "deliveryReleaseId",
    ["m", "admin", "portal"],
    ["/m/order-items/{orderItemId}/release", "/portal/order-items/{orderItemId}/release"],
  ),
  resource("delivery_reissue", "reissues", "reissueId", ["admin"]),
  resource("download_grant", "download-grants", "downloadGrantId", ["m"]),
  resource("delivery_download_log", "downloads", "downloadId", ["m", "admin", "portal"]),
  resource(
    "publish_list",
    "publish-lists",
    "publishListId",
    ["m", "admin", "portal"],
    [
      "/m/order-items/{orderItemId}/publish-list",
      "/portal/order-items/{orderItemId}/publish-list",
      "/admin/delivery-tickets/{deliveryTicketId}/publish-list",
    ],
  ),
]);
