// a06-publish 定义的领域错误码（docs/api/a06-publish.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors("a06-publish", [[46200, 46299]], {
  PATROL_NOT_ELIGIBLE: def(46202, 409, false, "当前不能发起巡检，作品不在上线中", "details"),
  PUBLISH_LIST_LOCKED: def(46204, 409, false, "商家已提交上线链接，发布清单已锁定", "details"),
  PUBLISH_LIST_IMPORT_INVALID: def(
    46205,
    400,
    false,
    "导入内容有错，整批未写入，请按提示修改后重新导入",
    "details",
  ),
  ACCOUNT_COMPARE_MISMATCH: def(46206, 409, false, "比对有不一致的项，不能通过", "details"),
  LAUNCH_VERIFY_COUNT_OUT_OF_RANGE: def(
    46207,
    400,
    false,
    "核验集数不在允许的范围内，请重新填写",
    "details",
  ),
  LAUNCH_REVOKE_WINDOW_CLOSED: def(46208, 409, false, "已超过撤销核验通过的时限", "details"),
  LAUNCH_REVOKE_BLOCKED: def(
    46209,
    409,
    false,
    "该订单项已有商家确认或已核查的下架任务，不能撤销核验通过",
    "details",
  ),
  TAKEDOWN_NOT_OVERDUE: def(46210, 409, false, "还没过应完成日，不能升级或发违约提醒", "details"),
  TAKEDOWN_BATCH_REJECTED: def(
    46211,
    409,
    false,
    "批量核查中有任务不满足条件，整批未处理，请按提示调整",
    "details",
  ),
});
