// m08-support-misc 定义的领域错误码（docs/api/m08-support-misc.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors(
  "m08-support-misc",
  [
    [45500, 45599],
    [47000, 47099],
  ],
  {
    TICKET_REOPEN_WINDOW_CLOSED: def(
      45501,
      409,
      false,
      "工单已解决较久，不能重新打开，请提交新工单",
      "details",
    ),
    DICT_ITEM_DISABLED: def(
      47001,
      409,
      false,
      "所选选项已停用或不存在，请刷新后重新选择",
      "details",
    ),
    FILE_TYPE_NOT_ALLOWED: def(47051, 400, false, "不支持该文件类型", "details"),
    FILE_TOO_LARGE: def(47052, 400, false, "文件超过大小上限", "details"),
    UPLOAD_EXPIRED: def(47053, 409, false, "上传已过期或已取消，请重新上传"),
    UPLOAD_CREDENTIAL_LIMIT: def(47054, 409, false, "上传凭证续签次数已达上限，请重新上传"),
    CONFIRM_IN_PROGRESS: def(47055, 409, true, "正在确认上传结果，请稍候"),
    UPLOAD_NOT_FOUND: def(47056, 409, false, "没有收到文件，请重新上传"),
    UPLOAD_REJECTED: def(47057, 400, false, "文件与登记信息不符，已拒收，请重新上传", "details"),
  },
);
