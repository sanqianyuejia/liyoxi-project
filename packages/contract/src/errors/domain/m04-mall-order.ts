// m04-mall-order 定义的领域错误码（docs/api/m04-mall-order.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors(
  "m04-mall-order",
  [
    [45000, 45099],
    [49300, 49399],
  ],
  {
    CART_LIMIT_REACHED: def(45001, 409, false, "选剧单已达上限，请先移除部分短剧", "details"),
    CART_PRICE_CHANGED: def(45002, 409, false, "价格又有变化，请确认最新价格", "details"),
    ORDER_ACCOUNT_INVALID: def(
      45003,
      409,
      false,
      "所选发布账号不能用于本次订购，请重新选择",
      "details",
    ),
    ORDER_AD_INVALID: def(45004, 409, false, "所选广告不能用于本次订购，请重新选择", "details"),
    LAUNCH_DATE_TOO_EARLY: def(45005, 400, false, "期望上线日过早，请选择更晚的日期", "details"),
    STORE_NOT_QUALIFIED: def(45008, 409, false, "门店资质尚未通过，暂不能进行该操作", "details"),
    DRAMA_NOT_ORDERABLE: def(49301, 409, false, "该短剧当前不可订购", "details"),
  },
);
