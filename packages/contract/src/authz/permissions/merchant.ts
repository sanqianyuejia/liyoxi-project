// 后台权限点：登记文档 docs/api/registry-permissions.md 第 1 节“商家管理”一小节。
// 键、名称、默认授予、再验证、待分配池、起始版本与登记文档对账（pnpm api-registries:check）。
// 默认授予里超级管理员不逐行写（它拥有全部）；括号里的说明不登记。键写出即冻结：路由与角色配置都按它引用。
import { SUPER_ADMIN_ONLY, definePermissions, lead, permission, roles } from "../define.js";

export const permissions = definePermissions("merchant", [
  permission("merchant.profile.proxy_edit", "代改门店档案", roles("cs", "delivery_manager")),
  permission("merchant.manager.assign", "首次分配交付经理", roles(lead("delivery_manager")), {
    pool: "store_manager",
  }),
  permission("merchant.manager.transfer", "转移交付经理", roles(lead("delivery_manager")), {
    pool: "store_manager",
  }),
  permission("merchant.qualification.review", "资质审核（通过、驳回、修正识别字段）", roles("cs")),
  permission(
    "merchant.qualification.override",
    "比对异常时放行（处理器追加判定）",
    SUPER_ADMIN_ONLY,
  ),
  permission("merchant.asset.review", "素材复核（整理、确认肖像授权）", roles("delivery_manager")),
  permission("merchant.asset.demand.create", "发起与结束素材需求", roles("delivery_manager")),
  permission(
    "merchant.asset.upload_on_behalf",
    "代商家上传素材与肖像授权材料",
    roles("delivery_manager", "cs"),
  ),
  permission("merchant.user.disable", "禁用、启用商家账号", roles(lead("cs")), { stepUp: true }),
  permission("merchant.user.force_logout", "强制商家账号下线", roles("cs")),
  permission(
    "merchant.account_change.request",
    "发起账号变更（换绑手机号、老板更换、老板复核）",
    roles("cs"),
  ),
  permission("merchant.account_change.approve", "审批账号变更", roles(lead("cs")), {
    stepUp: true,
  }),
  permission("merchant.quota.override", "门店与成员上限覆盖", SUPER_ADMIN_ONLY, { stepUp: true }),
  permission("merchant.entity.close", "后台关闭经营主体", SUPER_ADMIN_ONLY, { stepUp: true }),
  permission("merchant.referral_code.manage", "渠道码登记、停用、启用", roles(lead("cs"))),
  permission("pii.phone.reveal", "明文查看手机号", roles("cs", "delivery_manager", "finance")),
  permission(
    "pii.license.view",
    "明文查看证照号与证照原图",
    roles("cs", "delivery_manager", "finance"),
  ),
]);
