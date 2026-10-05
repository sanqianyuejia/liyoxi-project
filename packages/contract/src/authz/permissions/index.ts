// 权限点的汇总：登记文档 第 1 节一个小节一个文件，各导出一个 permissions；这里自动收集，不手抄。
// 加一个文件，在下面 import 并放进 PERMISSION_GROUPS；漏加时契约自测会红。纯常量：本目录的文件不引任何包。
import { permissions as merchant } from "./merchant.js";
import { permissions as order } from "./order.js";
import { permissions as delivery } from "./delivery.js";
import { permissions as publish } from "./publish.js";
import { permissions as service } from "./service.js";
import { permissions as drama } from "./drama.js";
import { permissions as billing } from "./billing.js";
import { permissions as finance } from "./finance.js";
import { permissions as report } from "./report.js";
import { permissions as ops } from "./ops.js";
import { permissions as system } from "./system.js";
import { permissions as exportSection } from "./export.js";
import { permissions as v11 } from "./v1-1.js";

/** 各小节的权限点，顺序同登记文档 */
export const PERMISSION_GROUPS = [
  merchant,
  order,
  delivery,
  publish,
  service,
  drama,
  billing,
  finance,
  report,
  ops,
  system,
  exportSection,
  v11,
] as const;
