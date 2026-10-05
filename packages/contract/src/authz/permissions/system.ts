// 后台权限点：登记文档 docs/api/registry-permissions.md 第 1 节“系统设置”一小节。
// 键、名称、默认授予、再验证、待分配池、起始版本与登记文档对账（pnpm api-registries:check）。
// 默认授予里超级管理员不逐行写（它拥有全部）；括号里的说明不登记。键写出即冻结：路由与角色配置都按它引用。
import {
  ALL_STAFF,
  SUPER_ADMIN_ONLY,
  definePermissions,
  lead,
  permission,
  roles,
} from "../define.js";

export const permissions = definePermissions("system", [
  permission(
    "sys.staff.manage",
    "员工新增、编辑、启用、移交、重新生成激活码、解除锁定、设置分配池",
    SUPER_ADMIN_ONLY,
  ),
  permission("sys.staff.secure_ops", "员工禁用、重置密码、重置第二因子", SUPER_ADMIN_ONLY, {
    stepUp: true,
  }),
  permission("sys.staff.wecom_bind", "员工企业微信绑定", SUPER_ADMIN_ONLY),
  permission("sys.session.revoke", "在线会话、强制下线", SUPER_ADMIN_ONLY),
  permission("sys.role.edit", "保存角色权限", SUPER_ADMIN_ONLY, { stepUp: true }),
  permission("sys.param.edit", "系统参数", SUPER_ADMIN_ONLY),
  permission("sys.dict.edit", "字典", SUPER_ADMIN_ONLY),
  permission("flow.checklist.manage", "核对清单模板", SUPER_ADMIN_ONLY),
  permission("audit.export", "操作日志导出", SUPER_ADMIN_ONLY, { stepUp: true }),
  permission(
    "sys.super_admin",
    "只限超级管理员的操作（开关、部署核对、差异核销、场景总开关、协议升主版本、工作台视角）",
    SUPER_ADMIN_ONLY,
  ),
  permission("self.mfa.reset", "本人重新绑定动态口令（自助标记）", ALL_STAFF, { stepUp: true }),
  permission("flow.ops.view", "流程运维只读列表", SUPER_ADMIN_ONLY),
  permission("flow.ops.manage", "定时器重排与取消、死信重投、回调重置、手动校验", SUPER_ADMIN_ONLY),
  permission("flow.admin.transition", "人工纠偏（强制迁移）", SUPER_ADMIN_ONLY, { stepUp: true }),
  permission("sys.health.manage", "认领、关闭告警；处理非资金类违规", roles(lead("finance"))),
  permission("media.job.retry", "媒体任务人工重试", roles("content_ops")),
  permission("files.purge.approve", "放行、驳回文件清除运行", SUPER_ADMIN_ONLY, { stepUp: true }),
  permission("files.restore", "恢复已清除文件", SUPER_ADMIN_ONLY),
  permission("files.erase", "彻底删除文件（个人信息删除请求）", SUPER_ADMIN_ONLY, { stepUp: true }),
]);
