// 权限只影响“显示什么”：菜单、路由守卫、按钮（D7 第 5.4 节）。接口每次请求即时鉴权，前端不做防线。
// 数据来自 GET /admin/auth/me（admin.auth.me.get）。M0 没有登录与这条接口：权限数据经一个可替换的来源读取，
// 本包只给夹具实现（src/dev/，只进开发与测试构建），真实来源由 W1-02 接上（任务书 第 11 节第 1 项）。
import type { AdminModuleKey, ModuleLevel } from "./menu-types";

export interface AccessSnapshot {
  staff: { id: string; name: string; roleKey: string; roleName: string };
  isLead: boolean;
  /** 13 个模块各自的等级；没列的按 n */
  moduleLevels: Readonly<Partial<Record<AdminModuleKey, ModuleLevel>>>;
  /** 已开启的敏感操作权限点 */
  actions: readonly string[];
  dataScope: "own" | "group" | "all";
  /** release.* 开关的求值结果；没列的按关 */
  releases: Readonly<Record<string, boolean>>;
}

/** 权限数据的来源。返回 null 表示没有登录 */
export interface AccessSource {
  load(): Promise<AccessSnapshot | null>;
}

/** 缺省来源：没有登录。生产构建在 W1-02 接上真实来源之前就是它 */
export const NO_ACCESS_SOURCE: AccessSource = { load: () => Promise.resolve(null) };

const LEVEL_RANK: Readonly<Record<ModuleLevel, number>> = { n: 0, v: 1, o: 2, e: 3 };

export function moduleLevelOf(access: AccessSnapshot | null, module: AdminModuleKey): ModuleLevel {
  return access?.moduleLevels[module] ?? "n";
}

/** 模块等级是否够：n < v（查看）< o（本人任务）< e（编辑） */
export function hasModuleLevel(
  access: AccessSnapshot | null,
  module: AdminModuleKey,
  need: Exclude<ModuleLevel, "n"> = "v",
): boolean {
  return LEVEL_RANK[moduleLevelOf(access, module)] >= LEVEL_RANK[need];
}

/** 敏感操作权限点是否已开启 */
export function canAction(access: AccessSnapshot | null, action: string): boolean {
  return access?.actions.includes(action) ?? false;
}

/** 开关是否打开；键为 null 表示不受开关控制 */
export function isReleased(access: AccessSnapshot | null, release: string | null): boolean {
  if (release === null) return true;
  return access?.releases[release] === true;
}
