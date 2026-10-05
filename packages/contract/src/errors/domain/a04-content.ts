// a04-content 定义的领域错误码（docs/api/a04-content.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors(
  "a04-content",
  [
    [49200, 49299],
    [43200, 43299],
  ],
  {
    DRAMA_ARCHIVED: def(49201, 409, false, "剧目已归档，资料只读，不能上架或变更版权", "details"),
    LISTING_CHECK_FAILED: def(
      49202,
      409,
      false,
      "上架校验有未通过的项，请按提示处理后再试",
      "details",
    ),
    TOTAL_EPISODES_LOCKED: def(49203, 409, false, "已上架的剧不能修改总集数，请先下架", "details"),
    EPISODE_HAS_MASTER: def(49204, 409, false, "要删去的剧集已有原片，请先处理原片", "details"),
    PLACEMENT_NOT_OPEN: def(49205, 400, false, "所选植入形式未开放或不适用于该类别", "details"),
    COPYRIGHT_REVISION_REQUIRED: def(49206, 409, false, "剧目上架过，版权信息请通过“版权变更”修改"),
    COPYRIGHT_CHANGE_KIND_MISMATCH: def(
      49207,
      400,
      false,
      "修订类型与填写的变更内容不符，请重新选择",
      "details",
    ),
    LICENSE_SHORTEN_NOT_OPEN: def(49208, 409, false, "暂不支持缩短授权期或把止日改早", "details"),
    COPYRIGHT_NO_CHANGE: def(49209, 400, false, "版权信息没有变化"),
    PERMIT_ACTIVE_EXISTS: def(
      49210,
      409,
      false,
      "同一平台、同一种编号已有生效中的许可信息",
      "details",
    ),
    PERMIT_FROZEN: def(
      49211,
      409,
      false,
      "剧目上架过，许可信息的平台、种类、编号不能直接修改，请换号",
    ),
    TRAILER_SOURCE_REJECTED: def(
      49212,
      409,
      false,
      "预告片源文件未通过检测，或对应的预告片已停用，请更换文件",
      "details",
    ),
    BATCH_FILE_INVALID: def(49213, 400, false, "上传清单里有不合规的文件，请按提示处理", "details"),
    BATCH_MATCH_INCOMPLETE: def(
      49214,
      409,
      false,
      "集号匹配或覆盖不完整，请补齐后再继续",
      "details",
    ),
    BATCH_PURPOSE_MISMATCH: def(
      49215,
      409,
      false,
      "批次用途不符，成片批次请在交付登记里提交",
      "details",
    ),
    TOTAL_EPISODES_MISSING: def(49216, 409, false, "剧目还没有填写总集数，不能上传原片"),
    BATCH_EPISODE_TAKEN: def(49217, 409, false, "该集已被本批次的另一个文件占用", "details"),
    TRAILER_SOURCE_CHECKING: def(49218, 409, true, "预告片源文件还在检测，请稍后再试", "details"),
    DRAMA_PRICE_LOCKED: def(
      43201,
      409,
      false,
      "剧目已停止订购、授权已结束或已归档，不能调价",
      "details",
    ),
    DRAMA_PRICE_UNCHANGED: def(43202, 400, false, "新积分价与当前积分价相同", "details"),
    HEAT_TIER_MISSING: def(43203, 409, false, "剧目没有热度等级，不能按模板定价"),
    DRAMA_PRICE_EFFECTIVE_AT_TAKEN: def(
      43204,
      409,
      false,
      "该剧在同一生效时间已有一条调价，请换一个时间",
      "details",
    ),
  },
);
