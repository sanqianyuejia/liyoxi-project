// m05-delivery-publish 定义的领域错误码（docs/api/m05-delivery-publish.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors(
  "m05-delivery-publish",
  [
    [45100, 45199],
    [46100, 46199],
  ],
  {
    ORDER_IN_AFTER_SALE: def(
      45101,
      409,
      false,
      "订单有取消申请在处理中，方案暂不能操作",
      "details",
    ),
    PLAN_VERSION_STALE: def(45102, 409, false, "方案已更新，请刷新后查看最新版本", "details"),
    TICKET_ON_HOLD: def(
      45103,
      409,
      false,
      "交付已暂停，待取消申请或方案修订处理完后再试",
      "details",
    ),
    SAMPLE_VERSION_STALE: def(45104, 409, false, "样片已更新，请刷新后查看最新版本", "details"),
    AD_CHANGED: def(45105, 409, false, "样片所用的广告已有变化，暂不能确认", "details"),
    SAMPLE_NOT_VIEWABLE: def(45106, 409, false, "请先按所选方式查看样片，再确认", "details"),
    SAMPLE_VIEW_CHANNEL_NOT_OFFERED: def(
      45107,
      409,
      false,
      "这一版样片没有提供这种查看方式，请换一种",
      "details",
    ),
    SAMPLE_PREVIEW_NOT_READY: def(45108, 409, false, "样片还在生成，请稍后再试"),
    DOWNLOAD_GRANT_INVALID: def(45109, 409, false, "下载授权已失效，请重新生成", "details"),
    DOWNLOAD_NOT_AVAILABLE: def(45110, 409, false, "成片当前不可下载", "details"),
    DOWNLOAD_REGRANT_LIMIT: def(
      45111,
      409,
      false,
      "今天重新生成下载授权的次数已达上限，请明天再试",
      "details",
    ),
    LICENSE_LETTER_NOT_READY: def(45112, 409, false, "授权书还在生成，请稍后再试", "details"),
    CHANNEL_ACCOUNT_TAKEN: def(46101, 409, false, "该账号已被绑定"),
    CHANNEL_ACCOUNT_IN_USE: def(
      46102,
      409,
      false,
      "账号还有在办的订单或未核查的下架任务，暂不能解绑",
      "details",
    ),
    LINK_INVALID: def(46103, 400, false, "上线链接不符合要求，请检查后重新填写", "details"),
    LAUNCH_SUBMISSION_OUT_OF_RANGE: def(
      46104,
      400,
      false,
      "填写的上线日期或集数超出允许的范围，请重新填写",
      "details",
    ),
    LAUNCH_WINDOW_CLOSED: def(46105, 409, false, "已过使用期，不能再回填上线链接", "details"),
    TAKEDOWN_METHOD_NOT_ALLOWED: def(
      46106,
      409,
      false,
      "该账号已核验上线，不能选择“未发布”",
      "details",
    ),
  },
);
