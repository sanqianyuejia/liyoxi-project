// m02-tenant 定义的领域错误码（docs/api/m02-tenant.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors("m02-tenant", [[41100, 41199]], {
  ALREADY_IN_ENTITY: def(41101, 409, false, "您已是其他主体的店员，不能再创建主体", "details"),
  ALREADY_OWNER: def(41102, 409, false, "您已是该主体的老板，不能接受店员邀请"),
  PHONE_IN_OTHER_ENTITY: def(41103, 409, false, "该手机号已属于其他主体", "details"),
  SEAT_LIMIT_REACHED: def(
    41104,
    409,
    false,
    "成员名额已满，请先移除成员或撤回未接受的邀请",
    "details",
  ),
  STORE_LIMIT_REACHED: def(41105, 409, false, "门店额度已满，暂不能新增门店", "details"),
  QUOTA_EXCEEDED: def(41106, 409, false, "门店数超过上限，请先停用门店后再试", "details"),
  STORE_ARCHIVED: def(41107, 403, false, "门店已停用，只能做收尾操作"),
  STORE_HAS_OPEN_WORK: def(41108, 409, false, "门店有在办事项，暂不能停用或删除", "details"),
  LAST_ACTIVE_STORE: def(41109, 409, false, "请至少保留一家启用中的门店"),
  STORE_NOT_DRAFT: def(
    41110,
    409,
    false,
    "门店已提交过资质或已有业务，只能停用，不能删除",
    "details",
  ),
  INVITATION_INVALID: def(41111, 404, false, "邀请不存在或已失效，请联系老板重新邀请"),
  INVITATION_USED: def(41112, 410, false, "邀请已被使用，请联系老板重新邀请"),
  INVITATION_REVOKED: def(41113, 410, false, "邀请已撤回，请联系老板重新邀请"),
  INVITATION_EXPIRED: def(41114, 410, false, "邀请已过期，请联系老板重新邀请"),
  INVITATION_NOT_FOR_YOU: def(41115, 403, false, "该邀请限定了手机号，与当前账号不符"),
  INVITATION_DAILY_LIMIT: def(41116, 409, false, "今天发出的邀请已达上限，请明天再试", "details"),
  OWNER_CANNOT_LEAVE: def(41117, 409, false, "老板不能退出门店"),
});
