// config 模块的表对应的资源名（docs/api/working/resources.json；约定 C10）。一张表一个资源名，三端同名。
// 表、资源名、参数名、端、别名与 resources.json 对账（pnpm api-registries:check）。
import { defineResources, resource } from "./define.js";

export const resources = defineResources("config", [
  resource("dict_type", "dict-types", "dictTypeKey", ["admin"]),
  resource("dict_item", "dict-items", "dictItemId", ["m", "admin"]),
  resource("param_value", "param-values", "paramValueId", ["admin"]),
  resource(
    "site_config_revision",
    "site-configs",
    "configKey",
    ["admin"],
    ["/admin/site-configs/{configKey}/draft", "/admin/site-configs/{configKey}/revisions"],
  ),
  resource("home_banner", "home-banners", "homeBannerId", ["admin"]),
  resource("site_notice", "site-notices", "siteNoticeId", ["m", "admin"]),
  resource("feature_flag", "feature-flags", "flagKey", ["admin"]),
  resource("checklist_template", "checklist-templates", "checklistTemplateId", ["admin"]),
]);
