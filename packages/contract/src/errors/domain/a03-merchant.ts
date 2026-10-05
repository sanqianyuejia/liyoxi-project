// a03-merchant 定义的领域错误码（docs/api/a03-merchant.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors(
  "a03-merchant",
  [
    [41300, 41399],
    [48200, 48299],
    [49100, 49199],
    [46300, 46399],
  ],
  {
    ENTITY_CLOSE_BLOCKED: def(41301, 409, false, "主体还有未办结的事项，暂不能关闭", "details"),
    REFERRAL_CODE_TAKEN: def(41302, 409, false, "该渠道码已被登记，请换一个", "details"),
    STORE_MANAGER_UNASSIGNED: def(41303, 409, false, "门店还没有交付经理，不能转移，请先指派"),
    STORE_MANAGER_ASSIGNED: def(
      41305,
      409,
      false,
      "门店已有交付经理，请使用“转移交付经理”",
      "details",
    ),
    APPROVAL_NOT_PENDING: def(48201, 409, false, "该申请已处理或已撤回，请刷新后查看", "details"),
    APPROVAL_SELF_FORBIDDEN: def(48202, 403, false, "不能审批自己发起的申请"),
    APPROVAL_ALREADY_PENDING: def(
      48203,
      409,
      false,
      "该对象已有一张待审批的同类申请，请等它处理完",
      "details",
    ),
    APPROVAL_WITHDRAW_FORBIDDEN: def(48204, 403, false, "只有发起人可以撤回申请"),
    QUALIFICATION_CHECK_FAILED: def(
      49101,
      409,
      false,
      "系统比对有不通过的项，请修正字段或驳回",
      "details",
    ),
    QUALIFICATION_FINAL_NOT_ALLOWED: def(49102, 409, false, "变更重审不能终局驳回"),
    FIELD_NOT_PROXY_EDITABLE: def(
      49103,
      400,
      false,
      "门店名称、地址、行业与品类、联系人及资质须由商家提交修改",
      "details",
    ),
    PROXY_EDIT_NO_CHANGE: def(49104, 400, false, "没有检测到修改内容"),
    ASSET_ALREADY_ADOPTED: def(
      46301,
      409,
      false,
      "素材已被采用，不能改为需补拍或需肖像授权",
      "details",
    ),
    ASSET_PORTRAIT_AUTH_MISSING: def(46302, 409, false, "还没有肖像授权材料，不能确认授权"),
    ASSET_NOT_PROCESSED: def(46303, 409, false, "素材还在识别中，请稍后再整理", "details"),
  },
);
