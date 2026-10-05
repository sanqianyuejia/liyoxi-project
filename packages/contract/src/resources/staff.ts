// staff 模块的表对应的资源名（docs/api/working/resources.json；约定 C10）。一张表一个资源名，三端同名。
// 表、资源名、参数名、端、别名与 resources.json 对账（pnpm api-registries:check）。
import { defineResources, resource } from "./define.js";

export const resources = defineResources("staff", [
  resource("staff", "staff", "staffId", ["admin"], ["/admin/auth/me"]),
  resource("staff_group", "staff-groups", "staffGroupId", ["admin"]),
  resource("staff_role", "roles", "roleKey", ["admin"]),
  resource(
    "staff_session",
    "staff-sessions",
    "staffSessionId",
    ["admin"],
    ["/admin/sessions/current"],
  ),
  resource(
    "assignment_pool_member",
    "assignment-pool-members",
    null,
    ["admin"],
    ["/admin/staff/{staffId}/pool-memberships", "/admin/staff/{staffId}/duty"],
  ),
  resource("assignment_history", "assignment-histories", "assignmentHistoryId", ["admin"]),
  resource("follow_up", "follow-ups", "followUpId", ["admin"]),
]);
