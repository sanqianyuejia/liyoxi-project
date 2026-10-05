// 资源登记的汇总：有表的按表所属的模块一个文件，没有表的在 views.ts；这里自动收集，不手抄。
// 加一个文件，在下面 import 并放进 RESOURCE_GROUPS；漏加时契约自测会红。
import { resources as ad } from "./ad.js";
import { resources as analytics } from "./analytics.js";
import { resources as approval } from "./approval.js";
import { resources as audit } from "./audit.js";
import { resources as billing } from "./billing.js";
import { resources as config } from "./config.js";
import { resources as content } from "./content.js";
import { resources as delivery } from "./delivery.js";
import { resources as docs } from "./docs.js";
import { resources as events } from "./events.js";
import { resources as exportsModule } from "./exports.js";
import { resources as flow } from "./flow.js";
import { resources as identity } from "./identity.js";
import { resources as media } from "./media.js";
import { resources as notify } from "./notify.js";
import { resources as ops } from "./ops.js";
import { resources as order } from "./order.js";
import { resources as portal } from "./portal.js";
import { resources as profile } from "./profile.js";
import { resources as publish } from "./publish.js";
import { resources as reports } from "./reports.js";
import { resources as security } from "./security.js";
import { resources as sla } from "./sla.js";
import { resources as staff } from "./staff.js";
import { resources as support } from "./support.js";
import { resources as tenant } from "./tenant.js";
import { resources as timers } from "./timers.js";
import { resources as views } from "./views.js";

/** 各文件的资源登记：模块按名字排序，没有表的排最后 */
export const RESOURCE_GROUPS = [
  ad,
  analytics,
  approval,
  audit,
  billing,
  config,
  content,
  delivery,
  docs,
  events,
  exportsModule,
  flow,
  identity,
  media,
  notify,
  ops,
  order,
  portal,
  profile,
  publish,
  reports,
  security,
  sla,
  staff,
  support,
  tenant,
  timers,
  views,
] as const;
