// 后台权限点：登记文档 docs/api/registry-permissions.md 第 1 节“各模块导出”一小节。
// 键、名称、默认授予、再验证、待分配池、起始版本与登记文档对账（pnpm api-registries:check）。
// 默认授予里超级管理员不逐行写（它拥有全部）；括号里的说明不登记。键写出即冻结：路由与角色配置都按它引用。
import { MODULE_VIEWERS, definePermissions, permission, roles } from "../define.js";

export const permissions = definePermissions("export", [
  permission("order.export", "订单管理导出", MODULE_VIEWERS),
  permission("finance.export", "财务管理导出", MODULE_VIEWERS),
  permission("merchant.export", "商家管理导出", MODULE_VIEWERS),
  permission("report.export", "数据报表导出（D1 `billing.report.export` 并入）", MODULE_VIEWERS),
  permission("delivery.export", "交付管理导出", MODULE_VIEWERS),
  permission("service.export", "客服工单导出", MODULE_VIEWERS),
  permission("drama.export", "短剧库导出", MODULE_VIEWERS),
  permission("billing.export", "套餐与积分导出", MODULE_VIEWERS),
  permission("export.unmasked", "明文导出（另需原因）", roles("finance"), { stepUp: true }),
]);
