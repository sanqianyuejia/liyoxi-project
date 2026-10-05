// 后台权限点：登记文档 docs/api/registry-permissions.md 第 1 节“V1.1 的键”一小节。
// 键、名称、默认授予、再验证、待分配池、起始版本与登记文档对账（pnpm api-registries:check）。
// 默认授予里超级管理员不逐行写（它拥有全部）；括号里的说明不登记。键写出即冻结：路由与角色配置都按它引用。
import {
  MODULE_VIEWERS,
  UNDECIDED,
  definePermissions,
  lead,
  permission,
  roles,
} from "../define.js";

export const permissions = definePermissions("v1_1", [
  permission("order.price_override.request", "改价发起", UNDECIDED, {
    stepUp: null,
    since: "v1.1",
  }),
  permission("order.price_override.approve", "改价审批", UNDECIDED, {
    stepUp: null,
    since: "v1.1",
  }),
  permission("publish.proxy", "代发布", UNDECIDED, { stepUp: null, since: "v1.1" }),
  permission("partner.*", "渠道管理（服务商、结算、等级）；届时拆成具体键", UNDECIDED, {
    stepUp: null,
    since: "v1.1",
  }),
  permission("publish.metrics.enter", "投放数据录入与审核", roles("publisher"), {
    stepUp: null,
    since: "v1.1",
  }),
  permission("service.quick_reply.manage", "快捷回复维护", roles(lead("cs")), {
    stepUp: null,
    since: "v1.1",
  }),
  permission("channel.export", "渠道管理导出", MODULE_VIEWERS, { stepUp: null, since: "v1.1" }),
]);
