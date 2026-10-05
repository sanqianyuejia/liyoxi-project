// 后台权限点：登记文档 docs/api/registry-permissions.md 第 1 节“运营管理”一小节。
// 键、名称、默认授予、再验证、待分配池、起始版本与登记文档对账（pnpm api-registries:check）。
// 默认授予里超级管理员不逐行写（它拥有全部）；括号里的说明不登记。键写出即冻结：路由与角色配置都按它引用。
import { SUPER_ADMIN_ONLY, definePermissions, permission, roles } from "../define.js";

export const permissions = definePermissions("ops", [
  permission("notify.resend", "人工重发外部通道投递", roles("content_ops", "cs")),
  permission("agreement.short_notice", "协议公告期不足时保存待生效", SUPER_ADMIN_ONLY, {
    stepUp: true,
  }),
  permission("docs.consent.evidence", "明文查看同意记录的手机号与信用代码", SUPER_ADMIN_ONLY, {
    stepUp: true,
  }),
]);
