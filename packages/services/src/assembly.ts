// 组合根（W0-07b）：services 的全部模块在这里汇成一份装配结果，api 与 worker 启动时各调一次。
// 依据：计划 第 5.1、9.3 节；01 第 5 节；D7 第 2.3 节规则 3、7。机制与用法见 kernel/assembly/README.md。
//
// 自动收集：下面把各模块的入口整体引入，哪个模块的 index.ts 给出了 registration 就收哪个。
// 模块加登记时只动自己的目录（建 register.ts，在自己的 index.ts 里加一行再导出），不改本文件。
// 本文件只在模块目录增减时才改（那要先改 infra/ci/layers.json，走单独的 gate-change PR）；
// 清单与模块目录对不上、目录里有 register.ts 而入口没给出，assembly.test.ts 会红。
// 本文件是包级文件，不属于任何一层：只引各模块的 index.ts，模块不得反过来引它。
// providers 不在清单里：驱动的入口只许 kernel 引（D7 第 2.2 节 D8），它也没有要登记的东西，
// 十二个外部能力由 createProviders 按环境选实现，不走 register.ts。
import * as ad from "./ad/index.js";
import * as analytics from "./analytics/index.js";
import * as approval from "./approval/index.js";
import * as audit from "./audit/index.js";
import * as authz from "./authz/index.js";
import * as billing from "./billing/index.js";
import * as config from "./config/index.js";
import * as content from "./content/index.js";
import * as delivery from "./delivery/index.js";
import * as docs from "./docs/index.js";
import * as events from "./events/index.js";
import * as exportsModule from "./exports/index.js";
import * as flow from "./flow/index.js";
import * as identity from "./identity/index.js";
import * as kernel from "./kernel/index.js";
import * as media from "./media/index.js";
import * as notify from "./notify/index.js";
import * as ops from "./ops/index.js";
import * as order from "./order/index.js";
import * as portal from "./portal/index.js";
import * as profile from "./profile/index.js";
import * as publish from "./publish/index.js";
import * as reports from "./reports/index.js";
import * as security from "./security/index.js";
import * as sla from "./sla/index.js";
import * as staff from "./staff/index.js";
import * as support from "./support/index.js";
import * as tenant from "./tenant/index.js";
import * as timers from "./timers/index.js";
import * as workbench from "./workbench/index.js";
import type { AppEnv, Assembly, AssemblyEntry, ModuleRegistration } from "./kernel/index.js";

/** 不参加收集的模块：目录里不得有 register.ts（自测会查） */
export const UNCOLLECTED_MODULES: readonly string[] = ["providers"];

/** 参加收集的全部模块的入口，键是模块目录名 */
export const MODULE_ENTRIES: Readonly<Record<string, object>> = {
  ad,
  analytics,
  approval,
  audit,
  authz,
  billing,
  config,
  content,
  delivery,
  docs,
  events,
  exports: exportsModule,
  flow,
  identity,
  kernel,
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
  workbench,
};

/** 当前带登记的模块各自的登记，按模块名排序 */
export function moduleRegistrations(): ModuleRegistration[] {
  return kernel.collectRegistrations(MODULE_ENTRIES);
}

export interface AssembleServicesOptions {
  /** 哪个进程在装配 */
  readonly entry: AssemblyEntry;
  /** 当前环境：取 loadEnv 给出的 APP_ENV */
  readonly appEnv: AppEnv;
}

/**
 * 装配全部模块。登记有重名、缺实现即抛 AssemblyError：进程启动失败，问题一次列全。
 * 两个入口收到的内容相同；只属于某个环境的登记项（envs）在别的环境里不出现。
 */
export function assembleServices(options: AssembleServicesOptions): Assembly {
  return kernel.assemble({ ...options, registrations: moduleRegistrations() });
}
