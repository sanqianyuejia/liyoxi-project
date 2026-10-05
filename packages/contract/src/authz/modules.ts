// 后台的 13 个菜单模块与模块等级（a01 第 4 节 ModuleKey；03 分组 第 2.1、4 节；D7 第 5.4 节）。
// 模块键是 staff_role.module_levels 的键，以这里为准：库里缺的键取代码默认值，这里没有的键被丢弃。
// 纯常量：本文件不引任何包。
export const ADMIN_MODULES = [
  { key: "workbench", name: "工作台" },
  { key: "drama", name: "短剧库管理" },
  { key: "billing", name: "套餐与积分" },
  { key: "merchant", name: "商家管理" },
  { key: "order", name: "订单管理" },
  { key: "delivery", name: "交付管理" },
  { key: "publish", name: "发布管理" },
  { key: "service", name: "客服工单" },
  { key: "finance", name: "财务管理" },
  { key: "report", name: "数据报表" },
  { key: "ops", name: "内容运营" },
  { key: "system", name: "系统设置" },
  // V1.1 启用；V1.0 的菜单按开关 release.partner 隐藏
  { key: "channel", name: "渠道管理" },
] as const;

/** 模块键 */
export type AdminModuleKey = (typeof ADMIN_MODULES)[number]["key"];
export const ADMIN_MODULE_KEYS: readonly AdminModuleKey[] = ADMIN_MODULES.map((item) => item.key);

export function isAdminModuleKey(value: unknown): value is AdminModuleKey {
  return typeof value === "string" && (ADMIN_MODULE_KEYS as readonly string[]).includes(value);
}

/** 模块等级：n 无权限、v 查看、o 本人任务、e 编辑 */
export const MODULE_LEVELS = ["n", "v", "o", "e"] as const;
export type ModuleLevel = (typeof MODULE_LEVELS)[number];

/** “本人任务”这一级只允许出现在这两个模块（不变量 staff.I7） */
export const OWN_TASK_MODULES = [
  "delivery",
  "publish",
] as const satisfies readonly AdminModuleKey[];
