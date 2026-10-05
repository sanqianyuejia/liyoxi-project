// 后台权限点：登记文档 docs/api/registry-permissions.md 第 1 节“交付管理”一小节。
// 键、名称、默认授予、再验证、待分配池、起始版本与登记文档对账（pnpm api-registries:check）。
// 默认授予里超级管理员不逐行写（它拥有全部）；括号里的说明不登记。键写出即冻结：路由与角色配置都按它引用。
import { definePermissions, lead, permission, roles } from "../define.js";

export const permissions = definePermissions("delivery", [
  permission("delivery.ticket.assign_editor", "指派剪辑师", roles("delivery_manager"), {
    pool: "ticket_editor",
  }),
  permission(
    "delivery.ticket.assign_publisher",
    "改派发布专员",
    roles("delivery_manager", lead("publisher")),
    { pool: "ticket_publisher" },
  ),
  permission("delivery.ticket.rework", "工单返工", roles(lead("delivery_manager"))),
  permission("delivery.plan.edit", "编辑方案", roles("delivery_manager")),
  permission("delivery.plan.push", "推送方案", roles("delivery_manager")),
  permission("delivery.plan.reschedule", "方案改期", roles("delivery_manager")),
  permission("delivery.sample.upload", "上传样片", roles("editor")),
  permission("delivery.sample.qc", "样片质检", roles("delivery_manager")),
  permission(
    "delivery.sample.push",
    "推送样片；登记广告版本的企业微信发送",
    roles("delivery_manager"),
  ),
  permission("delivery.sample.feedback_on_behalf", "代录样片意见", roles("delivery_manager")),
  permission("delivery.episode.register", "成片登记与成片批次上传", roles("editor")),
  permission("delivery.episode.qc", "成片质检", roles("delivery_manager")),
  permission("delivery.ad.assign", "指派广告剪辑师", roles("delivery_manager"), {
    pool: "ad_editor",
  }),
  permission("delivery.ad.upload", "上传广告版本", roles("editor")),
  permission("delivery.ad.return", "退回补充素材", roles("editor", "delivery_manager")),
  permission(
    "delivery.download",
    "员工下载成片与原片",
    roles("delivery_manager", "editor", "publisher"),
  ),
  permission("delivery.package.reissue", "发起、取消补发", roles("delivery_manager")),
  permission("production.normalize", "成片规范化重做", roles("delivery_manager")),
  permission("production.restamp", "成片重打水印", roles("delivery_manager")),
  permission("production.recheck", "成片重新检测", roles("delivery_manager")),
]);
