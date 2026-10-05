// p01-portal 定义的领域错误码（docs/api/p01-portal.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors(
  "p01-portal",
  [
    [41200, 41299],
    [46500, 46599],
    [47500, 47599],
  ],
  {
    PORTAL_TICKET_INVALID: def(41201, 410, false, "二维码已失效，请刷新后重新扫码", "details"),
    PORTAL_SESSION_INVALID: def(41202, 401, false, "登录已失效，请重新扫码登录", "details"),
    LICENSE_VERIFICATION_NOT_FOUND: def(47501, 404, false, "未查到这份授权书，请核对验真码"),
  },
);
