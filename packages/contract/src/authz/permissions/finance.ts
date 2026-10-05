// 后台权限点：登记文档 docs/api/registry-permissions.md 第 1 节“财务管理”一小节。
// 键、名称、默认授予、再验证、待分配池、起始版本与登记文档对账（pnpm api-registries:check）。
// 默认授予里超级管理员不逐行写（它拥有全部）；括号里的说明不登记。键写出即冻结：路由与角色配置都按它引用。
import { definePermissions, permission, roles } from "../define.js";

export const permissions = definePermissions("finance", [
  permission("finance.refund.approve", "审批取消与退款", roles("finance"), { stepUp: true }),
  permission("finance.refund.execute", "执行退款与退回", roles("finance"), { stepUp: true }),
  permission("billing.adjust.approve", "审批积分调整", roles("finance"), { stepUp: true }),
  permission("finance.receipt.confirm", "对公收款确认、二人复核", roles("finance"), {
    stepUp: true,
  }),
  permission("finance.receipt.reject", "驳回对公凭证", roles("finance")),
  permission("finance.invoice.issue", "开票", roles("finance")),
  permission("finance.invoice.red", "红冲", roles("finance")),
  permission("finance.recon.resolve", "对账差异处理", roles("finance"), { stepUp: true }),
  permission("finance.config.propose", "提议受控财务配置", roles("finance"), { stepUp: true }),
  permission("finance.config.approve", "审批受控财务配置", roles("finance"), { stepUp: true }),
  permission("billing.month.close", "月结", roles("finance")),
  permission("billing.invariant.resolve", "处理资金类不变量违规", roles("finance")),
  permission("pii.bank.reveal", "明文查看银行账号", roles("finance")),
]);
