// publish 模块的表对应的资源名（docs/api/working/resources.json；约定 C10）。一张表一个资源名，三端同名。
// 表、资源名、参数名、端、别名与 resources.json 对账（pnpm api-registries:check）。
import { defineResources, resource } from "./define.js";

export const resources = defineResources("publish", [
  resource("channel_account", "channel-accounts", "channelAccountId", ["m", "admin"]),
  resource(
    "channel_account_submission",
    "channel-account-submissions",
    "channelAccountSubmissionId",
    ["admin"],
  ),
  resource("launch_task", "launch-tasks", "launchTaskId", ["m", "admin"]),
  resource("launch_submission", "launch-submissions", "launchSubmissionId", ["admin"]),
  resource("patrol_task", "patrol-tasks", "patrolTaskId", ["admin"]),
  resource("takedown_task", "takedown-tasks", "takedownTaskId", ["m", "admin"]),
]);
