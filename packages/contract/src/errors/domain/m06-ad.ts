// m06-ad 定义的领域错误码（docs/api/m06-ad.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors("m06-ad", [[45200, 45299]], {
  AD_CANCEL_IN_PROGRESS: def(45201, 409, false, "广告有取消申请在处理中，暂不能操作"),
  AD_VERSION_STALE: def(45202, 409, false, "广告已更新，请刷新后查看最新版本", "details"),
  AD_PREVIEW_CHANNEL_UNAVAILABLE: def(
    45203,
    409,
    false,
    "这一版广告没有提供这种查看方式，请换一种",
    "details",
  ),
  AD_NOT_VIEWED: def(45204, 409, false, "请先按所选方式查看这一版广告，再确认", "details"),
  CHARGE_CHANGED: def(45205, 409, false, "本次修改需要扣减的积分有变化，请确认后再提交", "details"),
  PLAYABLE_UNAVAILABLE: def(45206, 409, false, "视频暂时无法播放，请稍后再试", "details"),
});
