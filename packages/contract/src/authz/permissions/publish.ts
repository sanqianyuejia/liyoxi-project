// 后台权限点：登记文档 docs/api/registry-permissions.md 第 1 节“发布管理”一小节。
// 键、名称、默认授予、再验证、待分配池、起始版本与登记文档对账（pnpm api-registries:check）。
// 默认授予里超级管理员不逐行写（它拥有全部）；括号里的说明不登记。键写出即冻结：路由与角色配置都按它引用。
import { definePermissions, lead, permission, roles } from "../define.js";

export const permissions = definePermissions("publish", [
  permission("publish.link.verify", "链接核验（通过、驳回）", roles("publisher")),
  permission(
    "publish.link.verify_revoke",
    "撤销链接核验通过",
    roles(lead("publisher"), lead("delivery_manager")),
  ),
  permission("publish.account.verify", "渠道账号核验（角色队列）", roles("publisher")),
  permission("publish.account.mark_abnormal", "标记渠道账号异常", roles("publisher")),
  permission(
    "publish.package.push",
    "推送成片包、发布补发",
    roles("publisher", "delivery_manager"),
  ),
  permission("publish.list.edit", "编辑、导入发布清单", roles("publisher", "delivery_manager")),
  permission("publish.patrol.do", "巡检", roles("publisher")),
  permission("publish.takedown.check", "下架核查", roles("publisher")),
  permission("publish.takedown.breach_notice", "违约提醒", roles("publisher")),
]);
