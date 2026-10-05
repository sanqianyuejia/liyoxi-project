// 后台权限点：登记文档 docs/api/registry-permissions.md 第 1 节“订单管理”一小节。
// 键、名称、默认授予、再验证、待分配池、起始版本与登记文档对账（pnpm api-registries:check）。
// 默认授予里超级管理员不逐行写（它拥有全部）；括号里的说明不登记。键写出即冻结：路由与角色配置都按它引用。
import { SUPER_ADMIN_ONLY, definePermissions, lead, permission, roles } from "../define.js";

export const permissions = definePermissions("order", [
  permission("order.refund.request", "发起套餐退款、订购取消、广告取消", roles("cs")),
  permission("order.payment.create_offline", "线下开单", roles("finance"), { stepUp: true }),
  permission("billing.extension.request", "发起补偿延长有效期", roles("delivery_manager")),
  permission("billing.extension.approve", "审批补偿延长", roles(lead("delivery_manager"))),
  permission("billing.adjust.request", "发起积分调整", roles("cs", "delivery_manager")),
  permission("order.license_letter.manage", "授权书更正、作废并重出", roles(lead("cs"))),
  permission("order.renewal.remind", "套餐到期人工提醒", roles("delivery_manager", "cs")),
  permission("refund.override.request", "规则外套餐退款（发起）", SUPER_ADMIN_ONLY, {
    stepUp: true,
  }),
]);
