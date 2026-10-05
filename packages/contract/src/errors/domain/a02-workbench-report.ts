// a02-workbench-report 定义的领域错误码（docs/api/a02-workbench-report.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors("a02-workbench-report", [[47200, 47299]], {
  EXPORT_CONCURRENCY_LIMIT: def(
    47201,
    409,
    false,
    "同时进行的导出任务已达上限，请等已有任务完成后再试",
    "details",
  ),
  EXPORT_ROW_LIMIT: def(47202, 409, false, "导出行数超过上限，请缩小筛选范围后重试", "details"),
  EXPORT_NOT_DOWNLOADABLE: def(
    47203,
    409,
    false,
    "导出任务尚未完成或未成功，暂不能下载",
    "details",
  ),
  EXPORT_FILE_EXPIRED: def(47204, 410, false, "导出文件已过期，请重新导出", "details"),
  REPORT_CLOSE_NOT_CURRENT: def(47205, 409, false, "月度快照已有新的修订，请刷新后查看", "details"),
});
