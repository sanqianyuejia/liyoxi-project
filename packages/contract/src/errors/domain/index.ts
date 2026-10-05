// 领域错误码的汇总：一个定义方文档一个文件，各导出一个 errors；这里自动收集，不手抄。
// 加一个文件，在下面 import 并放进 DOMAIN_ERROR_GROUPS；漏加时契约自测会红（目录里的文件与这里收的要一一对应）。
// 纯常量：经 ./errors 子路径给小程序与 shared 用，本目录的文件不引任何包。
import { errors as a01System } from "./a01-system.js";
import { errors as a02WorkbenchReport } from "./a02-workbench-report.js";
import { errors as a03Merchant } from "./a03-merchant.js";
import { errors as a04Content } from "./a04-content.js";
import { errors as a05OrderDelivery } from "./a05-order-delivery.js";
import { errors as a06Publish } from "./a06-publish.js";
import { errors as a07BillingFinance } from "./a07-billing-finance.js";
import { errors as a08Support } from "./a08-support.js";
import { errors as a09Ops } from "./a09-ops.js";
import { errors as h01Hooks } from "./h01-hooks.js";
import { errors as m01Account } from "./m01-account.js";
import { errors as m02Tenant } from "./m02-tenant.js";
import { errors as m03ProfileAsset } from "./m03-profile-asset.js";
import { errors as m04MallOrder } from "./m04-mall-order.js";
import { errors as m05DeliveryPublish } from "./m05-delivery-publish.js";
import { errors as m06Ad } from "./m06-ad.js";
import { errors as m07Billing } from "./m07-billing.js";
import { errors as m08SupportMisc } from "./m08-support-misc.js";
import { errors as p01Portal } from "./p01-portal.js";

/** 各文档定义的领域错误码，按文档名排序 */
export const DOMAIN_ERROR_GROUPS = [
  a01System,
  a02WorkbenchReport,
  a03Merchant,
  a04Content,
  a05OrderDelivery,
  a06Publish,
  a07BillingFinance,
  a08Support,
  a09Ops,
  h01Hooks,
  m01Account,
  m02Tenant,
  m03ProfileAsset,
  m04MallOrder,
  m05DeliveryPublish,
  m06Ad,
  m07Billing,
  m08SupportMisc,
  p01Portal,
] as const;
