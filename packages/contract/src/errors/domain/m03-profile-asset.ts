// m03-profile-asset 定义的领域错误码（docs/api/m03-profile-asset.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors(
  "m03-profile-asset",
  [
    [49000, 49099],
    [46000, 46099],
  ],
  {
    REVIEW_REQUIRED: def(
      49001,
      409,
      false,
      "修改门店名称、地址或行业与品类须重新审核，请确认后再保存",
      "details",
    ),
    PROFILE_REQUIRED_MISSING: def(
      49002,
      400,
      false,
      "已提交过资质的门店不能把必填项改空，请填写后再保存",
      "details",
    ),
    QUALIFICATION_IN_REVIEW: def(49003, 409, false, "资质正在审核中，暂不能修改", "details"),
    QUALIFICATION_CLOSED: def(49004, 409, false, "资质审核已终局驳回，不能再提交"),
    ENTITY_NOT_VERIFIED: def(49005, 409, false, "经营主体尚未认证，请先完成首家门店的资质审核"),
    STORE_PROFILE_INCOMPLETE: def(
      49006,
      409,
      false,
      "门店建档的必填项还没有填齐，请补全后再提交",
      "details",
    ),
    INDUSTRY_NOT_OPEN: def(49007, 409, false, "所选行业品类或地区暂未开放", "details"),
    QUALIFICATION_DOCS_INCOMPLETE: def(
      49008,
      409,
      false,
      "证照不齐、未核对，或被驳回的证照还没有补传，请补齐后再提交",
      "details",
    ),
    ENTITY_TYPE_MISMATCH: def(49009, 409, false, "所选主体类型与营业执照不一致，请核对", "details"),
    DECLARATION_REQUIRED: def(49010, 400, false, "请阅读并勾选信息确认", "details"),
    CONTACT_PHONE_UNVERIFIED: def(49011, 409, false, "请先验证联系人手机号"),
    USCC_TAKEN: def(49012, 409, false, "该统一社会信用代码已被其他主体认证，请联系客服"),
    ENTITY_LICENSE_CHANGE_PENDING: def(
      49013,
      409,
      false,
      "已有一轮更换营业执照的审核在进行，请等审核结束",
      "details",
    ),
    QUALIFICATION_DOC_NOT_ALLOWED: def(49014, 409, false, "本轮不需要上传这种证照", "details"),
    QUALIFICATION_NO_CHANGE: def(49015, 409, false, "没有需要提交审核的修改"),
    FILE_NOT_USABLE: def(46001, 400, false, "文件不可用，请重新上传", "details"),
    ASSET_UPLOAD_GATED: def(46002, 409, false, "门店资质审核通过前，店员暂不能上传素材"),
    ASSET_PORTRAIT_AUTH_FORBIDDEN: def(46003, 403, false, "只有老板或素材上传人可以补交肖像授权"),
    ASSET_FEEDBACK_DAILY_LIMIT: def(
      46004,
      409,
      false,
      "今天对这条素材的反馈次数已达上限，请明天再试",
      "details",
    ),
  },
);
