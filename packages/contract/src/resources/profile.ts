// profile 模块的表对应的资源名（docs/api/working/resources.json；约定 C10）。一张表一个资源名，三端同名。
// 表、资源名、参数名、端、别名与 resources.json 对账（pnpm api-registries:check）。
import { defineResources, resource } from "./define.js";

export const resources = defineResources("profile", [
  resource(
    "store_profile",
    "store-profiles",
    null,
    ["m", "admin"],
    [
      "/m/store-profile",
      "/m/store-profile/basic",
      "/m/store-profile/contact",
      "/admin/stores/{storeId}/profile",
    ],
  ),
  resource("store_profile_media", "store-profile-media", null, ["m"], ["/m/store-profile/media"]),
  resource("store_service_item", "store-service-items", null, ["m"], ["/m/store-profile/service"]),
  resource(
    "qualification_submission",
    "qualification-submissions",
    "qualificationSubmissionId",
    ["m", "admin"],
    ["/m/store-profile/qualification", "/admin/stores/{storeId}/qualification"],
  ),
  resource("qualification_doc", "qualification-docs", "qualificationDocId", ["m", "admin"]),
]);
