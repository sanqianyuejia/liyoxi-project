// a08-support 定义的领域错误码（docs/api/a08-support.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors("a08-support", [[45600, 45699]], {
  SERVICE_TICKET_ALREADY_ASSIGNED: def(
    45601,
    409,
    false,
    "工单已有负责人，请使用“转派”",
    "details",
  ),
  SERVICE_TICKET_NOT_ASSIGNED: def(45602, 409, false, "工单还没有负责人，请使用“分配”"),
  SERVICE_TICKET_NOT_OWNER: def(
    45604,
    403,
    false,
    "只有当前负责人或主管可以执行这个操作",
    "details",
  ),
  SERVICE_TICKET_REF_EXISTS: def(45605, 409, false, "这条业务已经关联在本工单上", "details"),
});
