// 后台权限点：登记文档 docs/api/registry-permissions.md 第 1 节“短剧库管理”一小节。
// 键、名称、默认授予、再验证、待分配池、起始版本与登记文档对账（pnpm api-registries:check）。
// 默认授予里超级管理员不逐行写（它拥有全部）；括号里的说明不登记。键写出即冻结：路由与角色配置都按它引用。
import { definePermissions, permission, roles } from "../define.js";

export const permissions = definePermissions("drama", [
  permission("drama.shelf", "上架与下架", roles("content_ops")),
  permission("drama.copyright.revise", "修订版权期限", roles("content_ops")),
  permission("drama.media.manage", "原片与预告片管理", roles("content_ops")),
]);
