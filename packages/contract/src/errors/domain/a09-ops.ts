// a09-ops 定义的领域错误码（docs/api/a09-ops.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors("a09-ops", [[47100, 47199]], {
  BANNER_LIMIT_EXCEEDED: def(
    47101,
    409,
    false,
    "同一时间生效的 Banner 将超过上限，请调整生效时间",
    "details",
  ),
  BANNER_ORDER_STALE: def(47102, 409, false, "Banner 列表已变化，请刷新后重新排序", "details"),
  BANNER_TARGET_INVALID: def(47103, 400, false, "Banner 的跳转目标无效，请重新选择", "details"),
  CONFIG_REV_CONFLICT: def(
    47104,
    409,
    false,
    "站点配置已有人发布过新版本，请刷新后重试",
    "details",
  ),
  CONFIG_REF_INVALID: def(
    47105,
    409,
    false,
    "站点配置引用的题材、行业或短剧已失效，请调整后再发布",
    "details",
  ),
  AGREEMENT_DRAFT_EXISTS: def(47106, 409, false, "该协议已有草稿，请在草稿上继续编辑", "details"),
  AGREEMENT_DRAFT_INCOMPLETE: def(
    47107,
    409,
    false,
    "协议草稿还缺文件、摘要、生效时间或法务审定，请补齐",
    "details",
  ),
  AGREEMENT_EFFECTIVE_TOO_SOON: def(
    47108,
    409,
    false,
    "生效时间须晚于当前时间 10 分钟以上",
    "details",
  ),
  AGREEMENT_SHORT_NOTICE: def(47109, 409, false, "距生效不足公告期，请推迟生效时间", "details"),
  AGREEMENT_PENDING_EXISTS: def(47110, 409, false, "该协议已有待生效的版本，请先撤回", "details"),
  AGREEMENT_WITHDRAW_TOO_LATE: def(
    47111,
    409,
    false,
    "版本即将生效、已经生效或已有人同意，不能撤回",
    "details",
  ),
  AGREEMENT_CONTENT_CONVERT_FAILED: def(
    47112,
    400,
    false,
    "Word 正文无法转换为展示格式，请检查文件后重新上传",
    "details",
  ),
  NOTIFY_SCENE_NOT_CONFIGURABLE: def(47113, 409, false, "该通知场景不支持这项设置", "details"),
  NOTIFY_CHANNEL_NOT_READY: def(
    47114,
    409,
    false,
    "订阅消息模板或短信模板未配置或已停用",
    "details",
  ),
  NOTIFY_TEST_RECIPIENT_MISSING: def(
    47115,
    409,
    false,
    "当前员工没有登记测试接收人，请联系超级管理员在参数配置里登记",
    "details",
  ),
  NOTIFY_RESEND_NOT_ALLOWED: def(47116, 409, false, "这条投递不能重发", "details"),
  WX_SLOT_FIELDS_MISMATCH: def(
    47117,
    400,
    false,
    "订阅消息模板的字段与场景不一致，请核对模板",
    "details",
  ),
  SMS_TEMPLATE_CONFIG_INVALID: def(
    47118,
    400,
    false,
    "短信模板配置不完整，或不允许这样修改",
    "details",
  ),
});
