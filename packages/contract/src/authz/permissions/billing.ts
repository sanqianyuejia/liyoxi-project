// 后台权限点：登记文档 docs/api/registry-permissions.md 第 1 节“套餐与积分”一小节。
// 键、名称、默认授予、再验证、待分配池、起始版本与登记文档对账（pnpm api-registries:check）。
// 默认授予里超级管理员不逐行写（它拥有全部）；括号里的说明不登记。键写出即冻结：路由与角色配置都按它引用。
import { definePermissions, permission, roles } from "../define.js";

export const permissions = definePermissions("billing", [
  permission("billing.plan.edit", "套餐与价目修订", roles("content_ops")),
  permission("billing.pack.edit", "积分包维护", roles("content_ops")),
  permission("billing.param.edit", "计费参数变更", roles("content_ops")),
  permission("billing.price.edit", "等级模板价与单剧调价", roles("content_ops")),
]);
