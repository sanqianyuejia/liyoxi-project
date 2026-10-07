// config 模块（L0）的出口。W0-18 交付读侧：字典、参数、开关求值、站点配置、清单模板，共用一套版本号缓存。
// 用法见本目录的 README.md。写侧（保存、发布、启停）随各自的接口包，提交后调 cache.bump。
import type { ParamDef } from "@liyoxi/shared/params";

import type { Clock } from "../kernel/index.js";

import { createConfigCache } from "./cache.js";
import type { ConfigCache, VersionStore } from "./cache.js";
import { createChecklists } from "./checklists.js";
import type { Checklists } from "./checklists.js";
import { createDicts } from "./dicts.js";
import type { Dicts } from "./dicts.js";
import { createFlags } from "./flags.js";
import type { Flags } from "./flags.js";
import { assertParamDefs, createParams } from "./params.js";
import type { Params } from "./params.js";
import { createSiteConfig } from "./site-config.js";
import type { SiteConfig } from "./site-config.js";
import { reportToConsole } from "./types.js";
import type { ConfigDb, ConfigProblem, ConfigReport } from "./types.js";

export interface ConfigOptions {
  /** 只读的库句柄：进程装配时传 Prisma 客户端 */
  db: ConfigDb;
  clock: Clock;
  /** 放版本号的 Redis；不给（null）即没有跨进程的“变了”信号 */
  redis: VersionStore | null;
  /** Redis 键的前缀，如 lyx:prod:；连接自己带了 keyPrefix 的不用给 */
  keyPrefix?: string;
  /** 读取时发现的问题往哪报；不给即 console.error。装配方接上日志与告警 */
  report?: ConfigReport;
  /** 参数定义表，缺省取 @liyoxi/shared/params 的；只为用例能换一张 */
  paramDefs?: readonly ParamDef[];
}

export interface Config {
  cache: ConfigCache;
  dicts: Dicts;
  params: Params;
  flags: Flags;
  siteConfig: SiteConfig;
  checklists: Checklists;
  /** 自检：库里的参数值、开关行对代码里的定义与登记，返回问题清单（config.N8、N17、N19） */
  selfCheck(): Promise<ConfigProblem[]>;
}

/**
 * 建配置服务。进程装配时调一次；先过参数定义的自检：
 * 登记的参数键缺定义（或默认值不合定义）即抛 ParamDefsError，进程起不来。
 */
export function createConfig(options: ConfigOptions): Config {
  assertParamDefs(undefined, options.paramDefs);
  const { db, clock } = options;
  const report: ConfigReport = options.report ?? reportToConsole;
  const cache = createConfigCache({
    clock,
    redis: options.redis,
    report,
    ...(options.keyPrefix === undefined ? {} : { keyPrefix: options.keyPrefix }),
  });
  const params = createParams({
    db,
    clock,
    cache,
    report,
    ...(options.paramDefs === undefined ? {} : { defs: options.paramDefs }),
  });
  const flags = createFlags({ db, cache, report });
  return {
    cache,
    dicts: createDicts({ db, cache }),
    params,
    flags,
    siteConfig: createSiteConfig({ db, cache, report }),
    checklists: createChecklists({ db, cache, report }),
    async selfCheck() {
      return [...(await params.selfCheck()), ...(await flags.selfCheck())];
    },
  };
}

export {
  CONFIG_NAMESPACES,
  createConfigCache,
  HARD_EXPIRE_MS,
  PROBE_INTERVAL_MS,
  STALE_TOLERANCE_MS,
  versionKey,
} from "./cache.js";
export type {
  ConfigCache,
  ConfigCacheOptions,
  ConfigNamespace,
  Loaded,
  VersionStore,
} from "./cache.js";
export { createChecklists, listChecklistTemplates } from "./checklists.js";
export type { ChecklistCode, Checklists, ChecklistTemplateView } from "./checklists.js";
export { createDicts } from "./dicts.js";
export type { DictItemView, DictListOptions, Dicts, DictTypeItems } from "./dicts.js";
export { createFlags, matchesRule } from "./flags.js";
export type { FlagContext, Flags } from "./flags.js";
export { assertParamDefs, createParams, ParamDefsError, paramsAt } from "./params.js";
export type { ParamCurrent, Params, ParamsAtOptions, ParamSnapshot } from "./params.js";
export { createSiteConfig } from "./site-config.js";
export type { PublishedSiteConfig, SiteConfig, SiteConfigKey } from "./site-config.js";
export type { ConfigDb, ConfigProblem, ConfigProblemKind, ConfigReport } from "./types.js";
export { compareVersions, matchesVersionRange, parseVersion } from "./version.js";
export type { Version } from "./version.js";
// W0-21 种子与五条配置类不变量的 SQL 断言
export { seed } from "./seed.js";
export { configSeedAssertions } from "./invariants.js";
export {
  CHECKLIST_TEMPLATE_SEEDS,
  DICT_ITEM_SEEDS,
  DICT_TYPE_SEEDS,
  HOME_RECOMMEND_CONFIG_SEED,
  MALL_CONFIG_SEED,
  SITE_CONFIG_SEEDS,
  SYSTEM_DICT_ITEMS,
} from "./seed-data.js";
export type { ChecklistTemplateSeed, DictItemSeed, DictTypeSeed } from "./seed-data.js";
// W0-24：六条配置类不变量登记进不变量框架
export { CONFIG_SQL_INVARIANTS, registration } from "./register.js";
// W1-03：规则变更公告的最小实现（只有“建”；撤回与读取随 G2-B）
export { createNotices } from "./notices.js";
export type { AnnouncedNotice, NoticeAnnouncement, Notices, NoticesDeps } from "./notices.js";

export { insertDictItemsMissing } from "./insert-dict-items.js";

export { createConfigAdmin } from "./admin.js";
export type { ConfigAdmin, ConfigActor, ConfigAdminDeps } from "./admin.js";
