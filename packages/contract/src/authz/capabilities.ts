// 商家端能力点（登记文档 docs/api/registry-permissions.md 第 2 节；约定 C55、C56、C66）。
// 键、含义、老板、店员、已停用门店的老板与登记文档对账（pnpm api-registries:check）。
// 门店是否认证、套餐是否生效这些业务状态不归能力点管，由各业务服务判断。
// 下载页的会话代表授权它的老板：delivery.download、sample.view、ad.view 在下载页按老板判定（约定 C5）。
// 纯常量：本文件不引任何包。
import { NO, YES, capability, limited, type CapabilityDef } from "./define.js";

export const CAPABILITIES = [
  capability("catalog.read", "浏览短剧商城", limited("游客视图"), YES),
  capability("store.profile.read", "看门店档案", limited("裁剪"), YES),
  capability("store.profile.edit", "改门店档案", NO, NO),
  capability("store.qualification.edit", "提交、修改资质", NO, NO),
  capability("store.create", "新建门店", NO, NO),
  capability("store.archive", "停用门店", NO, NO),
  capability("store.restore", "恢复门店", NO, YES),
  capability("asset.read", "看本店素材", YES, YES),
  capability("asset.demand.read", "看素材需求", YES, YES),
  capability("asset.upload", "上传素材", YES, NO),
  capability("asset.feedback", "素材反馈", YES, NO),
  capability("member.list", "看成员列表", limited("裁剪"), NO),
  capability("member.manage", "邀请、调整、移除、撤回成员", NO, NO),
  capability("cart.*", "购物车（组键）", NO, NO),
  capability("order.create", "下订购单", NO, NO),
  capability("order.read", "看订购单", NO, YES),
  capability("plan.purchase", "购买与续费套餐", NO, limited("主体级")),
  capability("points.topup", "加购积分", NO, limited("主体级")),
  capability("wallet.read", "看积分账户", NO, limited("主体级")),
  capability("ledger.read", "看积分明细", NO, limited("主体级")),
  capability("delivery.confirm_plan", "确认方案", NO, NO),
  capability("delivery.confirm_sample", "确认样片", NO, NO),
  capability("ad.request", "申请广告、提修改", NO, NO),
  capability("ad.confirm", "确认广告版本", NO, NO),
  capability("channel.manage", "管理渠道账号", NO, NO),
  capability("publish.submit_link", "提交上线链接", NO, NO),
  capability("publish.read", "看发布任务", NO, YES),
  capability("publish.takedown_confirm", "确认到期下架", NO, YES),
  capability("delivery.download", "下载成片（小程序与下载页）", NO, YES),
  capability("portal.authorize", "授权电脑下载页", NO, YES),
  capability("contract.read", "合同页数据、协议同意计数", NO, limited("主体级")),
  capability("invoice.*", "开票申请（组键）", NO, limited("主体级")),
  capability("ticket.*", "客服工单（组键）", NO, YES),
  capability("message.read", "站内消息（门店上下文）", limited("仅“门店”类"), YES),
  capability("me.*", "本人资料、账号与安全、退出、注销、退出门店（组键）", YES, YES),
  capability("todo.read", "首页待办", limited("仅素材相关"), YES),
  capability("support.manager.read", "服务经理名片", YES, YES),
  capability("sample.view", "下载页预览样片", NO, YES),
  capability("ad.view", "下载页预览广告", NO, YES),
] as const;

/** 能力点的键 */
export type CapabilityKey = (typeof CAPABILITIES)[number]["key"];
export const CAPABILITY_KEYS: readonly CapabilityKey[] = CAPABILITIES.map((item) => item.key);

export function isCapabilityKey(value: unknown): value is CapabilityKey {
  return typeof value === "string" && (CAPABILITY_KEYS as readonly string[]).includes(value);
}

/** 按键找登记项 */
export function capabilityByKey(key: string): CapabilityDef | undefined {
  return (CAPABILITIES as readonly CapabilityDef[]).find((item) => item.key === key);
}

/**
 * 按角色区分响应时的判别字段 viewerRole（约定 C55）：老板、店员，另有游客（裁决 A122：没有成员关系也能看的
 * 视图，如短剧商城）。各接口用其中哪几个取值，由该接口的结构定。
 */
export const VIEWER_ROLES = ["owner", "clerk", "guest"] as const;
export type ViewerRole = (typeof VIEWER_ROLES)[number];
