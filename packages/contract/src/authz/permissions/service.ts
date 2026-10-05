// 后台权限点：登记文档 docs/api/registry-permissions.md 第 1 节“客服工单”一小节。
// 键、名称、默认授予、再验证、待分配池、起始版本与登记文档对账（pnpm api-registries:check）。
// 默认授予里超级管理员不逐行写（它拥有全部）；括号里的说明不登记。键写出即冻结：路由与角色配置都按它引用。
import { definePermissions, lead, permission, roles } from "../define.js";

export const permissions = definePermissions("service", [
  permission("service.ticket.register", "登记工单", roles("cs", "delivery_manager")),
  permission(
    "service.ticket.reply",
    "提交处理结果；改类型与优先级、增删关联；工单附件上传",
    roles("cs", "delivery_manager"),
  ),
  permission("service.ticket.close", "关闭工单", roles("cs", "delivery_manager")),
  permission(
    "service.ticket.transfer",
    "负责人转出；主管可改派任意工单",
    roles("cs", "delivery_manager"),
  ),
  permission("service.ticket.assign", "分配无负责人的工单", roles(lead("cs")), {
    pool: "service_ticket",
  }),
]);
