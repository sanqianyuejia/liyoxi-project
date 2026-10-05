// m07-billing 定义的领域错误码（docs/api/m07-billing.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors(
  "m07-billing",
  [
    [43000, 43099],
    [44000, 44099],
  ],
  {
    PLAN_NOT_AVAILABLE: def(43001, 409, false, "该套餐或积分包已不可购买，请刷新后重新选择"),
    CYCLE_NOT_AVAILABLE: def(43002, 400, false, "所选购买周期暂不可用，请重新选择", "details"),
    UPGRADE_NOT_ALLOWED_TODAY: def(
      43003,
      409,
      false,
      "今天不能立即升级，可改为下个周期生效",
      "details",
    ),
    SCHEDULED_TERM_LIMIT: def(43004, 409, false, "预约的续费周期已达上限", "details"),
    TOPUP_REQUIRES_ACTIVE_PLAN: def(43005, 409, false, "套餐生效后才能加购积分"),
    PLAN_REFUND_IN_PROGRESS: def(43006, 409, false, "套餐退款处理中，暂不能购买、订购或提交广告"),
    QUOTE_CHANGED: def(43007, 409, false, "价格已变化，请确认新报价", "details"),
    ACCOUNT_BUSY: def(43008, 503, true, "系统繁忙，请稍后重试"),
    POINTS_INSUFFICIENT: def(43009, 409, false, "可用积分不足", "details"),
    SUBSCRIPTION_INACTIVE: def(43010, 409, false, "套餐未生效，暂不能进行该操作"),
    PURCHASE_NOT_OFFERED: def(44001, 403, false, "当前不提供在线购买，请联系服务经理", "details"),
    CHANNEL_NOT_ALLOWED: def(44002, 403, false, "所选支付方式暂不可用，请换一种", "details"),
    PURCHASE_QUALIFICATION_REQUIRED: def(
      44003,
      409,
      false,
      "请先提交并通过主体资质审核，再购买",
      "details",
    ),
    OPEN_ORDER_EXISTS: def(44004, 409, false, "已有未完成的付款单，请先完成或取消", "details"),
    OPEN_ORDER_EXPIRING: def(
      44005,
      409,
      false,
      "同内容的付款单即将超时，请取消后重新下单",
      "details",
    ),
    PAYMENT_ORDER_EXPIRED: def(44006, 409, false, "付款单已超时，请重新下单", "details"),
    PAYMENT_ORDER_CLOSED: def(44007, 409, false, "付款单已取消，请重新下单"),
    TRANSFER_PROOF_PENDING: def(44008, 409, false, "转账凭证待财务确认，暂不能取消"),
    TRANSFER_PROOF_LOCKED: def(44009, 409, false, "财务正在复核到账，暂不能更换凭证"),
    INVOICE_NOT_ELIGIBLE: def(44010, 409, false, "该付款单暂不能开票", "details"),
    INVOICE_REQUEST_EXISTS: def(44011, 409, false, "该付款单已有开票申请", "details"),
    INVOICE_TITLE_UNVERIFIED: def(44012, 409, false, "主体认证通过后才能开票"),
    INVOICE_APPLY_EXPIRED: def(44013, 409, false, "已超过开票申请期限", "details"),
    INVOICE_FILE_UNAVAILABLE: def(44014, 409, false, "该发票暂无可下载的文件"),
  },
);
