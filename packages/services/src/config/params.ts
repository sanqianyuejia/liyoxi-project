// 参数读取（W0-18）。依据：14 分组 第 2.3、4.2 节；D6 第 4.2.2、4.2.3 节。
//
// 定义在代码里（@liyoxi/shared/params），库里（param_value）只存值：一行 = 某个键从某时刻起的值。
// 当前值 = 未撤销、已生效的行里生效时间最晚的那一行；库里没有的键用代码默认值。
//   get(key)            当前值，走缓存；缓存的硬过期不晚于下一个预约值的生效时刻
//   getAt(key, at)      某一时刻的值，查库（核对与争议用）
//   snapshot(keys)      { values, revs }：单据创建时固化进自己的 jsonb 列，revs 是 param_value.seq
//   paramsAt(db, keys, at)  不经配置服务：拿给定的句柄（如事务句柄）查某一时刻的值，不走缓存（W0-30a）
// 库里的值不合定义、库里有没定义的键：不抛错，值回退到代码默认值并上报；清单另见 selfCheck。
import { PARAM_KEYS } from "@liyoxi/contract/config/params";
import { checkParamDefs, PARAM_DEFS, validateParamValue } from "@liyoxi/shared/params";
import type { DefinedParamKey, ParamDef, ParamDefIssue, ParamValue } from "@liyoxi/shared/params";

import type { Clock } from "../kernel/index.js";

import type { ConfigCache } from "./cache.js";
import { reportToConsole } from "./types.js";
import type { ConfigDb, ConfigProblem, ConfigReport } from "./types.js";

/** 参数定义表不完整：登记的键缺定义、定义重复或默认值不合定义。建配置服务时抛出，进程起不来 */
export class ParamDefsError extends Error {
  readonly issues: readonly ParamDefIssue[];

  constructor(issues: readonly ParamDefIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.key}: ${issue.problem}`);
    super(`参数定义不完整：\n${lines.join("\n")}`);
    this.name = "ParamDefsError";
    this.issues = issues;
  }
}

/** 启动自检：登记的键都有定义、默认值合定义。不过即抛 ParamDefsError */
export function assertParamDefs(
  registered: readonly string[] = PARAM_KEYS.map((item) => item.key),
  defs: readonly ParamDef[] = PARAM_DEFS,
): void {
  const issues = checkParamDefs(registered, defs);
  if (issues.length > 0) throw new ParamDefsError(issues);
}

/** 一个键此刻的值 */
export interface ParamCurrent {
  value: unknown;
  /** 生效中那一行的修订号（param_value.seq 的字符串）；用的是代码默认值时为 null */
  rev: string | null;
  /** 生效中那一行的生效时间；用的是代码默认值时为 null */
  effectiveAt: Date | null;
}

export interface ParamSnapshot<K extends string = string> {
  values: { [P in K]: P extends DefinedParamKey ? ParamValue<P> : unknown };
  revs: Record<K, string | null>;
}

export interface Params {
  /** 当前值；库里没有即代码默认值（默认值为 null 的键读到 null，即“未配置”） */
  get<K extends DefinedParamKey>(key: K): Promise<ParamValue<K>>;
  /** 某一时刻的值：查库，不走缓存 */
  getAt<K extends DefinedParamKey>(key: K, at: Date): Promise<ParamValue<K>>;
  /** 一组键此刻的值与修订号，存进单据的快照列 */
  snapshot<K extends DefinedParamKey>(keys: readonly K[]): Promise<ParamSnapshot<K>>;
  /** 全部有定义的键此刻的值（后台参数页、引导接口用） */
  all(): Promise<ReadonlyMap<string, ParamCurrent>>;
  /** 自检：库里未撤销的行（生效中与待生效）逐行对定义，返回问题清单（config.N8、N17） */
  selfCheck(): Promise<ConfigProblem[]>;
}

export interface ParamsOptions {
  db: ConfigDb;
  clock: Clock;
  cache: ConfigCache;
  report?: ConfigReport;
  /** 定义表，缺省取 @liyoxi/shared/params 的；只为用例能换一张 */
  defs?: readonly ParamDef[];
}

interface Row {
  key: string;
  value: unknown;
  seq: bigint;
  effectiveAt: Date;
}

const SELECT = { key: true, value: true, seq: true, effectiveAt: true } as const;

type DefMap = ReadonlyMap<string, ParamDef>;
const defMapOf = (defs: readonly ParamDef[] = PARAM_DEFS): DefMap =>
  new Map(defs.map((def) => [def.key, def]));

/** 一行对定义：合规返回 null */
function problemIn(defs: DefMap, row: Row): ConfigProblem | null {
  const def = defs.get(row.key);
  if (!def) {
    return { kind: "param_unknown_key", subject: row.key, detail: "库里的参数键没有定义" };
  }
  const issue = validateParamValue(def, row.value);
  return issue === null
    ? null
    : {
        kind: "param_invalid_value",
        subject: row.key,
        detail: `修订 ${String(row.seq)} 的值不合定义：${issue}`,
      };
}

const fallback = (def: ParamDef): ParamCurrent => ({
  value: def.default,
  rev: null,
  effectiveAt: null,
});

/** 一个键取到的那一行 → 值：库里没有，或值不合定义（上报），即代码默认值 */
function resolveRow(
  defs: DefMap,
  report: ConfigReport | undefined,
  def: ParamDef,
  row: Row | undefined,
): ParamCurrent {
  if (!row) return fallback(def);
  const problem = problemIn(defs, row);
  if (problem) {
    report?.(problem);
    return fallback(def);
  }
  return { value: row.value, rev: String(row.seq), effectiveAt: row.effectiveAt };
}

export interface ParamsAtOptions {
  /** 库里的值不合定义时往哪报；不给即 console.error */
  report?: ConfigReport;
  /** 定义表，缺省取 @liyoxi/shared/params 的；只为用例能换一张 */
  defs?: readonly ParamDef[];
}

/**
 * 一组键在某一时刻的值：拿给定的句柄查库，不经配置服务、不走缓存（W0-30a）。
 * 给手里只有事务句柄的地方用（装配时静态登记的端口实现与处理器拿不到进程里那个配置服务），
 * 读到的与同一事务里的写入一致。取值的规矩同 getAt：未撤销、at 之前已生效的行里生效时间最晚的一行；
 * 库里没有，或值不合定义，即代码默认值。一次查询取全部键。
 */
export async function paramsAt<K extends DefinedParamKey>(
  db: Pick<ConfigDb, "paramValue">,
  keys: readonly K[],
  at: Date,
  options: ParamsAtOptions = {},
): Promise<{ [P in K]: ParamValue<P> }> {
  const defs = defMapOf(options.defs);
  const report = options.report ?? reportToConsole;
  const rows = await db.paramValue.findMany({
    where: { key: { in: [...keys] }, cancelledAt: null, effectiveAt: { lte: at } },
    orderBy: [{ key: "asc" }, { effectiveAt: "desc" }],
    distinct: ["key"],
    select: SELECT,
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const values: Record<string, unknown> = {};
  for (const key of keys) {
    const def = defs.get(key);
    if (!def) throw new TypeError(`参数 ${key} 没有定义`);
    values[key] = resolveRow(defs, report, def, byKey.get(key)).value;
  }
  return values as { [P in K]: ParamValue<P> };
}

export function createParams(options: ParamsOptions): Params {
  const { db, clock, cache, report } = options;
  const defs = defMapOf(options.defs);
  const problemOf = (row: Row): ConfigProblem | null => problemIn(defs, row);
  const resolve = (def: ParamDef, row: Row | undefined): ParamCurrent =>
    resolveRow(defs, report, def, row);

  async function load() {
    const now = clock.now();
    const [rows, next] = await Promise.all([
      // 每个键取未撤销、已生效的行里生效时间最晚的一行（部分唯一索引 uq_param_value_key_effective_at）
      db.paramValue.findMany({
        where: { cancelledAt: null, effectiveAt: { lte: now } },
        orderBy: [{ key: "asc" }, { effectiveAt: "desc" }],
        distinct: ["key"],
        select: SELECT,
      }),
      db.paramValue.findFirst({
        where: { cancelledAt: null, effectiveAt: { gt: now } },
        orderBy: { effectiveAt: "asc" },
        select: { effectiveAt: true },
      }),
    ]);
    const byKey = new Map(rows.map((row) => [row.key, row]));
    for (const row of rows) {
      if (!defs.has(row.key)) report?.(problemOf(row)!);
    }
    const data = new Map<string, ParamCurrent>();
    for (const def of defs.values()) data.set(def.key, resolve(def, byKey.get(def.key)));
    return { data: data as ReadonlyMap<string, ParamCurrent>, nextSwitchAt: next?.effectiveAt };
  }

  const all = (): Promise<ReadonlyMap<string, ParamCurrent>> => cache.read("param", load);

  function defOf(key: string): ParamDef {
    const def = defs.get(key);
    if (!def) throw new TypeError(`参数 ${key} 没有定义`);
    return def;
  }

  async function current(key: string): Promise<ParamCurrent> {
    const def = defOf(key);
    return (await all()).get(key) ?? fallback(def);
  }

  return {
    all,

    async get<K extends DefinedParamKey>(key: K) {
      return (await current(key)).value as ParamValue<K>;
    },

    async getAt<K extends DefinedParamKey>(key: K, at: Date) {
      const def = defOf(key);
      const row = await db.paramValue.findFirst({
        where: { key, cancelledAt: null, effectiveAt: { lte: at } },
        orderBy: { effectiveAt: "desc" },
        select: SELECT,
      });
      return resolve(def, row ?? undefined).value as ParamValue<K>;
    },

    async snapshot<K extends DefinedParamKey>(keys: readonly K[]) {
      const values: Record<string, unknown> = {};
      const revs: Record<string, string | null> = {};
      for (const key of keys) {
        const { value, rev } = await current(key);
        values[key] = value;
        revs[key] = rev;
      }
      return { values, revs } as ParamSnapshot<K>;
    },

    async selfCheck() {
      const now = clock.now();
      const rows = await db.paramValue.findMany({
        where: { cancelledAt: null },
        orderBy: [{ key: "asc" }, { effectiveAt: "desc" }],
        select: SELECT,
      });
      // 已被取代的历史行不查：每个键只看待生效的行与生效中的那一行
      const seenCurrent = new Set<string>();
      const problems: ConfigProblem[] = [];
      for (const row of rows) {
        const pending = row.effectiveAt > now;
        if (!pending && seenCurrent.has(row.key)) continue;
        if (!pending) seenCurrent.add(row.key);
        const problem = problemOf(row);
        if (problem) problems.push(problem);
      }
      return problems;
    },
  };
}
