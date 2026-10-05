// content 模块的表对应的资源名（docs/api/working/resources.json；约定 C10）。一张表一个资源名，三端同名。
// 表、资源名、参数名、端、别名与 resources.json 对账（pnpm api-registries:check）。
import { defineResources, resource } from "./define.js";

export const resources = defineResources("content", [
  resource(
    "drama",
    "dramas",
    "dramaId",
    ["m", "admin"],
    [
      "/admin/dramas/{dramaId}/basic",
      "/admin/dramas/{dramaId}/commercial",
      "/admin/dramas/{dramaId}/cast",
    ],
  ),
  resource("drama_episode", "drama-episodes", "dramaEpisodeId", ["admin"]),
  resource("drama_permit", "drama-permits", "dramaPermitId", ["admin"]),
  resource(
    "drama_copyright",
    "drama-copyrights",
    null,
    ["admin"],
    ["/admin/dramas/{dramaId}/copyright"],
  ),
  resource("drama_copyright_revision", "drama-copyright-revisions", null, ["admin"]),
]);
