/**
 * 接口侧注册表对账（任务书 W0-09b 第 7 节第 1–9 条；计划 第 5.5 节“登记表对账”、第 5.7 节“登记表”一行）：
 * 拿契约里的领域错误码、权限点、能力点、模块键、资源登记、通知场景、订阅点位、埋点事件，以及 07 第 7 节补登的
 * 参数键与开关键，与登记文档逐字段对账，一处不符即非 0 退出。
 *
 * 用法（在仓库根目录）：
 *   pnpm api-registries:check
 * 直接跑：tsx scripts/api-registries-check.ts [--permissions-json <路径>]。只读文件，不连库。
 *   --permissions-json  另拿 tools/api-check/gen_permissions.py 的产物（tools/api-check/out/permissions.json，不入库）
 *                       与契约的权限点、能力点比一遍。接管时用；平时对的是它生成的登记文档。
 *
 * 各表对谁（“三方”指两两都与契约比）：
 *   错误码      通用码 ↔ docs/api/registry-errors.md 第 1 节；领域码 ↔ 各 frag 的 errorCodes ↔ 登记文档 第 2 节：
 *               符号集合、数值、HTTP、可重试、是否带 details、定义方。符号、数值在通用码加领域码之内不重复；
 *               数值在定义方的取号区间内，区间 ↔ docs/api/working/api-rulings.md 第九节（A70）的表。
 *   权限点      ↔ docs/api/registry-permissions.md 第 1 节各小节：键集合、名称、所在小节、默认授予、再验证、待分配池、
 *               起始版本。默认授予与再验证只比去掉括号说明之后的部分。
 *   能力点      ↔ 登记文档 第 2 节：键集合、含义、老板、店员、已停用门店的老板。
 *   模块键      ↔ a01 第 4 节 ModuleKey（键与顺序）；名称 ↔ 03 分组 第 4 节列的 13 个模块。
 *   资源登记    ↔ docs/api/working/resources.json：表、资源名、参数名、端、别名。
 *   通知场景    ↔ a09 第 2.9 节两张表（受众、显示名）↔ frag a09 的 notifyScenes（受众）↔ 13 分组 第 2.1 节的播种清单
 *              （受众；补登的 31 个另比显示名）。
 *   订阅点位    ↔ m08 第 4 节 SubscribePoint ↔ D6 第 2.9.3 节的表。
 *   埋点事件    PRD 的事件 ↔ D6 第 5.1.1 节的表（事件名、来源）；端上事件 ↔ m08 第 4 节 ClientEventName；
 *               扩展事件 ↔ 14 分组 第 3 节 analytics_event.name 一行。
 *   待回写项    07 第 7 节“参数”“开关”两类写出的键都已登记；开关的值类型、下发范围、默认值与那张表一致。
 *
 * 数量不写在本文件里：登记文档各节标题里写了数的（“领域错误码（N 个…）”“1.3 交付管理（N 个）”之类），
 * 拿标题里的数、表格的行数、契约的条数三方比；没写数的只比集合。
 * 不核对的：领域码的默认文案（文档没有逐个给）；权限点“用到的接口”“二次确认回显”“来源”（路由一侧，W0-10）；
 * 场景的触发、接收人、通道、深链（在 services 的通知注册表）；端上事件的属性结构。
 * 退出码：0 通过；1 有差异；2 环境错误（文件读不了、文档的表格认不出来）。
 */
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ANALYTICS_EVENTS, type AnalyticsEventDef } from "../src/analytics/events.js";
import {
  ADMIN_MODULES,
  CAPABILITIES,
  PERMISSIONS,
  PERMISSION_SECTIONS,
  type CapabilityAccess,
  type CapabilityDef,
  type PermissionDef,
  type PermissionGrant,
} from "../src/authz/index.js";
import { FLAGS, type FlagDef } from "../src/config/flags.js";
import { PARAM_KEYS } from "../src/config/params.js";
import {
  COMMON_ERRORS,
  DOMAIN_ERROR_GROUPS,
  type CodeRange,
  type ErrorCodeDef,
} from "../src/errors/index.js";
import { NOTIFY_SCENES, SUBSCRIBE_POINT_KEYS, type NotifySceneDef } from "../src/notify/index.js";
import { RESOURCES, type ResourceDef } from "../src/resources/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// ---------- 契约这一头 ----------

export interface ErrorFact {
  symbol: string;
  code: number;
  http: number;
  retryable: boolean;
  hasDetails: boolean;
}

/** 契约里各张登记表的一份快照：检查函数只看它，便于拿一份改过的数据来试 */
export interface ApiRegistrySnapshot {
  commonErrors: readonly ErrorFact[];
  /** source：定义方文档 */
  domainErrors: readonly (ErrorFact & { source: string })[];
  /** 定义方文档 → 取号区间 */
  errorRanges: Readonly<Record<string, readonly CodeRange[]>>;
  modules: readonly { key: string; name: string }[];
  permissions: readonly PermissionDef[];
  capabilities: readonly CapabilityDef[];
  resources: readonly ResourceDef[];
  scenes: readonly NotifySceneDef[];
  subscribePoints: readonly string[];
  events: readonly AnalyticsEventDef[];
  flags: readonly FlagDef[];
  paramKeys: readonly string[];
}

const errorFacts = (errors: Readonly<Record<string, ErrorCodeDef>>): ErrorFact[] =>
  Object.entries(errors).map(([symbol, def]) => ({
    symbol,
    code: def.code,
    http: def.http,
    retryable: def.retryable,
    hasDetails: def.hasDetails,
  }));

export const CONTRACT_SNAPSHOT: ApiRegistrySnapshot = {
  commonErrors: errorFacts(COMMON_ERRORS),
  domainErrors: DOMAIN_ERROR_GROUPS.flatMap((group) =>
    errorFacts(group.errors).map((fact) => ({ ...fact, source: group.source })),
  ),
  errorRanges: Object.fromEntries(DOMAIN_ERROR_GROUPS.map((group) => [group.source, group.ranges])),
  modules: ADMIN_MODULES,
  permissions: PERMISSIONS,
  capabilities: CAPABILITIES,
  resources: RESOURCES,
  scenes: NOTIFY_SCENES,
  subscribePoints: SUBSCRIBE_POINT_KEYS,
  events: ANALYTICS_EVENTS,
  flags: FLAGS,
  paramKeys: PARAM_KEYS.map((item) => item.key),
};

// ---------- 文档这一头 ----------

/** 对账要读的文件，路径相对仓库根 */
export const SOURCE_PATHS = {
  errorsDoc: "docs/api/registry-errors.md",
  permissionsDoc: "docs/api/registry-permissions.md",
  rulings: "docs/api/working/api-rulings.md",
  resources: "docs/api/working/resources.json",
  a01: "docs/api/a01-system.md",
  a09: "docs/api/a09-ops.md",
  m08: "docs/api/m08-support-misc.md",
  a09Frag: "docs/api/working/frag/a09-ops.json",
  staffGroup: "docs/data-model/03-staff-authz-audit.md",
  notifyGroup: "docs/data-model/13-notify-docs.md",
  configGroup: "docs/data-model/14-config-data.md",
  d6: "docs/appendix/design/d6-notify-docs-data.md",
  contractDoc: "docs/07-api-contract.md",
} as const;
export const FRAG_DIR = "docs/api/working/frag";

export interface ApiRegistrySources {
  /** SOURCE_PATHS 的键 → 文件全文 */
  texts: Record<keyof typeof SOURCE_PATHS, string>;
  /** frag 文件名（不带 .json）→ 内容 */
  frags: Record<string, { errorCodes?: FragError[] }>;
  /** gen_permissions.py 的产物；没给就不比 */
  permissionsJson?: PermissionsJson;
}

interface FragError {
  symbol: string;
  code: number | string;
  http: number | string;
  retryable?: boolean;
  details?: string | null;
}

export interface PermissionsJson {
  permissions: {
    module: string;
    key: string;
    name: string;
    grant: string;
    stepUp: string;
    pool: string;
    version: string;
  }[];
  capabilities: {
    key: string;
    meaning: string;
    owner: string;
    clerk: string;
    archivedOwner: string;
  }[];
}

export function loadSources(
  options: { root?: string; permissionsJsonPath?: string } = {},
): ApiRegistrySources {
  const root = options.root ?? repoRoot;
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const texts = Object.fromEntries(
    Object.entries(SOURCE_PATHS).map(([key, path]) => [key, read(path)]),
  ) as ApiRegistrySources["texts"];
  const frags = Object.fromEntries(
    readdirSync(join(root, FRAG_DIR))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => [
        name.slice(0, -5),
        JSON.parse(read(join(FRAG_DIR, name))) as { errorCodes?: FragError[] },
      ]),
  );
  const sources: ApiRegistrySources = { texts, frags };
  if (options.permissionsJsonPath !== undefined) {
    sources.permissionsJson = JSON.parse(
      readFileSync(resolve(options.permissionsJsonPath), "utf8"),
    ) as PermissionsJson;
  }
  return sources;
}

/** 一行表格拆成单元格：按没有转义的“|”拆，再把“\|”还原 */
const cellsOf = (line: string) =>
  line
    .trim()
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim().replaceAll("\\|", "|"));
const unquote = (cell: string) => cell.replace(/^`(.*)`$/, "$1");
const quoted = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
/** 去掉全角括号里的说明（可以有几处） */
const stripNotes = (cell: string) => cell.replace(/（[^（）]*）/g, "").trim();
const cell = (cells: readonly string[], index: number) => cells[index] ?? "";

/** 全文里从匹配 start 的那一行起，到下一个匹配 end 的行之前的各行 */
function linesBetween(text: string, start: RegExp, end: RegExp, what: string): string[] {
  const lines = text.split("\n");
  const from = lines.findIndex((line) => start.test(line));
  if (from < 0) throw new Error(`${what}：文档里找不到 ${String(start)} 这一行`);
  const to = lines.findIndex((line, index) => index > from && end.test(line));
  return lines.slice(from, to < 0 ? undefined : to);
}

/** 以反引号写的键开头的表格行，拆成单元格 */
const keyedRows = (lines: readonly string[]) =>
  lines.filter((line) => /^\| `[^`]+` \|/.test(line)).map(cellsOf);

/** “标题（N 个…）”里的 N */
function declaredCount(line: string, what: string): number {
  const found = /（(?:V1\.0，)?(\d+) 个/.exec(line)?.[1];
  if (found === undefined) throw new Error(`${what}：标题里没有写个数：${line}`);
  return Number(found);
}

/** `details` 一栏算不算“带”：—、无、空，或“无（说明）”都算不带 */
const hasDetailsCell = (value: string | null | undefined) =>
  !(
    value === null ||
    value === undefined ||
    ["", "—", "无", "-"].includes(value) ||
    value.startsWith("无（")
  );

interface DocErrors {
  common: ErrorFact[];
  domain: (ErrorFact & { source: string })[];
  declared: { common: number; domain: number };
}

export function parseErrorsDoc(text: string): DocErrors {
  const first = linesBetween(text, /^## 1\. 通用错误码/, /^## 2\. /, "错误码登记表 第 1 节");
  const second = linesBetween(text, /^## 2\. 领域错误码/, /^## 3\. /, "错误码登记表 第 2 节");
  const common = keyedRows(first).map((cells) => ({
    symbol: unquote(cell(cells, 0)),
    code: Number(cell(cells, 1)),
    http: Number(cell(cells, 2)),
    // “—”取 false（任务书 W0-08 第 11 节第 3 项）
    retryable: cell(cells, 3) === "是",
    hasDetails: false,
  }));
  const domain = keyedRows(second).map((cells) => ({
    symbol: unquote(cell(cells, 0)),
    code: Number(cell(cells, 1)),
    http: Number(cell(cells, 2)),
    retryable: cell(cells, 3) === "是",
    hasDetails: hasDetailsCell(cell(cells, 5)),
    // 定义方一栏是“[m01-account](m01-account.md)”
    source: /^\[([^\]]+)\]/.exec(cell(cells, 6))?.[1] ?? cell(cells, 6),
  }));
  return {
    common,
    domain,
    declared: {
      common: declaredCount(first[0]!, "错误码登记表 第 1 节"),
      domain: declaredCount(second[0]!, "错误码登记表 第 2 节"),
    },
  };
}

/** 裁决 A70 的表：文档 → 取号区间 */
export function parseCodeRanges(rulings: string): Record<string, CodeRange[]> {
  const lines = linesBetween(rulings, /^## 九、.*A70/, /^## 十、/, "裁决 A70");
  const ranges: Record<string, CodeRange[]> = {};
  for (const line of lines) {
    const cells = cellsOf(line);
    if (!/^[ahmp]\d\d-[a-z-]+$/.test(cell(cells, 0))) continue;
    ranges[cell(cells, 0)] = [...cell(cells, 1).matchAll(/(\d{5})–(\d{5})/g)].map(
      (match) => [Number(match[1]), Number(match[2])] as const,
    );
  }
  if (Object.keys(ranges).length === 0) throw new Error("裁决 A70：没有读到取号区间的表格行");
  return ranges;
}

/** 权限点在登记文档里的样子：小节标题、名称、默认授予、再验证、待分配池、起始版本（都已去掉括号说明） */
interface DocPermission {
  key: string;
  section: string;
  name: string;
  grant: string;
  stepUp: string;
  pool: string;
  since: string;
}
interface DocCapability {
  key: string;
  name: string;
  owner: string;
  clerk: string;
  archivedOwner: string;
}
interface DocPermissions {
  permissions: DocPermission[];
  /** 小节标题 → 标题里写的个数 */
  sectionCounts: Map<string, number>;
  /** 第 1 节标题里写的 V1.0 个数 */
  declaredV10: number;
  capabilities: DocCapability[];
  declaredCapabilities: number;
}

export function parsePermissionsDoc(text: string): DocPermissions {
  const first = linesBetween(text, /^## 1\. 后台权限点/, /^## 2\. /, "权限点注册表 第 1 节");
  const second = linesBetween(text, /^## 2\. 商家端能力点/, /^## 3\. /, "权限点注册表 第 2 节");
  const permissions: DocPermission[] = [];
  const sectionCounts = new Map<string, number>();
  let section: string | undefined;
  for (const line of first) {
    const heading = /^### 1\.\d+ (.+?)（/.exec(line)?.[1];
    if (heading !== undefined) {
      section = heading;
      sectionCounts.set(section, declaredCount(line, `权限点注册表 ${section}`));
      continue;
    }
    if (!/^\| `[^`]+` \|/.test(line)) continue;
    if (section === undefined) throw new Error("权限点注册表 第 1 节：表格行出现在小节标题之前");
    const cells = cellsOf(line);
    permissions.push({
      key: unquote(cell(cells, 0)),
      section,
      name: cell(cells, 1),
      grant: stripNotes(cell(cells, 2)),
      stepUp: stripNotes(cell(cells, 3)),
      pool: unquote(cell(cells, 4)),
      since: cell(cells, 6),
    });
  }
  if (permissions.length === 0) throw new Error("权限点注册表 第 1 节：没有读到表格行");
  const capabilities = keyedRows(second).map((cells) => ({
    key: unquote(cell(cells, 0)),
    name: cell(cells, 1),
    owner: cell(cells, 2),
    clerk: cell(cells, 3),
    archivedOwner: cell(cells, 4),
  }));
  if (capabilities.length === 0) throw new Error("权限点注册表 第 2 节：没有读到表格行");
  return {
    permissions,
    sectionCounts,
    declaredV10: declaredCount(first[0]!, "权限点注册表 第 1 节"),
    capabilities,
    declaredCapabilities: declaredCount(second[0]!, "权限点注册表 第 2 节"),
  };
}

/** 第 4 节“枚举”表里某个枚举的取值：`名字` 那一行第二栏里反引号写的各项 */
function enumValues(text: string, name: string, what: string): string[] {
  const row = text
    .split("\n")
    .map(cellsOf)
    .find((cells) => cell(cells, 0) === `\`${name}\``);
  if (!row) throw new Error(`${what}：枚举表里找不到 ${name} 一行`);
  return quoted(cell(row, 1));
}

interface DocScene {
  key: string;
  audience: string;
  name: string | null;
}

/** a09 第 2.9 节的两张表：受众按“**商家场景**”“**员工场景**”两个小标题分 */
export function parseA09Scenes(text: string): DocScene[] {
  const lines = linesBetween(text, /^### 2\.9 /, /^## 3\. /, "a09 第 2.9 节");
  const scenes: DocScene[] = [];
  let audience: string | undefined;
  for (const line of lines) {
    if (line.startsWith("**商家场景**")) audience = "merchant";
    else if (line.startsWith("**员工场景**")) audience = "staff";
    else if (/^\| `[ms]\.[a-z0-9_]+` \|/.test(line)) {
      if (audience === undefined) throw new Error("a09 第 2.9 节：场景行出现在小标题之前");
      const cells = cellsOf(line);
      scenes.push({ key: unquote(cell(cells, 0)), audience, name: cell(cells, 1) });
    }
  }
  if (scenes.length === 0) throw new Error("a09 第 2.9 节：没有读到场景的表格行");
  return scenes;
}

/** 13 分组 第 2.1 节：“播种”一段里逐个写出的键（没有显示名），加“补登播种”那张表（键、受众、显示名） */
export function parseSeededScenes(text: string): DocScene[] {
  const seedLine = text.split("\n").find((line) => line.startsWith("**播种**（V1.0"));
  if (!seedLine) throw new Error("13 分组 第 2.1 节：找不到“**播种**（V1.0”一段");
  // 这一段后半句说“其余场景……见下文补登播种表”，那里不再逐个写键
  const listed = quoted(seedLine.split("只发站内的其余场景")[0]!).filter((key) =>
    /^[ms]\.[a-z0-9_]+$/.test(key),
  );
  // 表头那一行的首格也是反引号写的（`scene_key`），按场景键的写法筛掉
  const supplement = keyedRows(
    linesBetween(text, /^\*\*补登播种\*\*/, /^\*\*不变量\*\*/, "13 分组 第 2.1 节“补登播种”"),
  )
    .map((cells) => ({
      key: unquote(cell(cells, 0)),
      audience: cell(cells, 1),
      name: cell(cells, 2),
    }))
    .filter((item) => /^[ms]\.[a-z0-9_]+$/.test(item.key));
  if (listed.length === 0 || supplement.length === 0)
    throw new Error("13 分组 第 2.1 节：播种清单或补登播种表没有读到场景键");
  return [
    ...listed.map((key) => ({
      key,
      audience: key.startsWith("m.") ? "merchant" : "staff",
      name: null,
    })),
    ...supplement,
  ];
}

const SOURCE_WORDS: Record<string, string> = { 端上: "client", 出站派生: "outbox", 直记: "direct" };

/** D6 第 5.1.1 节的表：事件名、来源 */
export function parseD6Events(text: string): { name: string; source: string }[] {
  const rows = keyedRows(linesBetween(text, /^#### 5\.1\.1 /, /^#### 5\.1\.2 /, "D6 第 5.1.1 节"));
  if (rows.length === 0) throw new Error("D6 第 5.1.1 节：没有读到事件的表格行");
  return rows.map((cells) => {
    const source = SOURCE_WORDS[cell(cells, 1)];
    if (!source)
      throw new Error(`D6 第 5.1.1 节：${cell(cells, 0)} 的来源不认识：${cell(cells, 1)}`);
    return { name: unquote(cell(cells, 0)), source };
  });
}

/** 07 第 7 节的表里某一类的行：登记项一栏反引号里的键，连同“默认值或说明”一栏 */
function pendingRows(text: string, category: string): { key: string; note: string }[] {
  return linesBetween(text, /^## 7\. 待回写清单/, /^## 8\. /, "07 第 7 节")
    .map(cellsOf)
    .filter((cells) => cell(cells, 0) === category)
    .flatMap((cells) => quoted(cell(cells, 1)).map((key) => ({ key, note: cell(cells, 2) })));
}

// ---------- 对账 ----------

const sorted = (values: Iterable<string>) => [...values].sort();

/** 一类条目在某一头的样子：键 → 属性。属性值为 null 表示这一头没写，不比 */
type Facts = Map<string, Record<string, string | null>>;

function facts<T>(
  list: readonly T[],
  keyOf: (item: T) => string,
  attributesOf: (item: T) => Record<string, string | null> = () => ({}),
): Facts {
  return new Map(list.map((item) => [keyOf(item), attributesOf(item)]));
}

const CONTRACT = "契约";

/** 契约的一类条目与另一头比：先比键的集合，再对同键的项逐个比属性 */
function compareFacts(what: string, contract: Facts, source: string, theirs: Facts): string[] {
  const problems: string[] = [];
  const onlyContract = sorted(contract.keys()).filter((key) => !theirs.has(key));
  const onlyTheirs = sorted(theirs.keys()).filter((key) => !contract.has(key));
  if (onlyContract.length > 0)
    problems.push(`${what}：${CONTRACT}有而${source}没有：${onlyContract.join("、")}`);
  if (onlyTheirs.length > 0)
    problems.push(`${what}：${source}有而${CONTRACT}没有：${onlyTheirs.join("、")}`);
  for (const [key, mine] of contract) {
    for (const [label, expected] of Object.entries(theirs.get(key) ?? {})) {
      if (expected !== null && mine[label] !== expected)
        problems.push(
          `${what} ${key} 的${label}：${CONTRACT}是 ${mine[label]}，${source}是 ${expected}`,
        );
    }
  }
  return problems;
}

const duplicates = <T extends string | number>(values: readonly T[]) => [
  ...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
];

function countProblem(what: string, counted: Record<string, number>): string[] {
  const distinct = new Set(Object.values(counted));
  if (distinct.size <= 1) return [];
  return [
    `数量：${what}对不上：${Object.entries(counted)
      .map(([where, count]) => `${where} ${count}`)
      .join("，")}`,
  ];
}

const flag = (value: boolean) => (value ? "是" : "否");

/** 1. 错误码 */
function errorProblems(snapshot: ApiRegistrySnapshot, sources: ApiRegistrySources): string[] {
  const doc = parseErrorsDoc(sources.texts.errorsDoc);
  const fragErrors = Object.entries(sources.frags).flatMap(([source, frag]) =>
    (frag.errorCodes ?? []).map((item) => ({
      symbol: item.symbol,
      code: Number(item.code),
      http: Number(item.http),
      retryable: item.retryable === true,
      hasDetails: hasDetailsCell(item.details),
      source,
    })),
  );
  const commonFacts = (list: readonly ErrorFact[]) =>
    facts(
      list,
      (item) => item.symbol,
      (item) => ({
        数值: String(item.code),
        HTTP: String(item.http),
        可重试: flag(item.retryable),
      }),
    );
  const domainFacts = (list: readonly (ErrorFact & { source: string })[]) =>
    facts(
      list,
      (item) => item.symbol,
      (item) => ({
        数值: String(item.code),
        HTTP: String(item.http),
        可重试: flag(item.retryable),
        "是否带 details": flag(item.hasDetails),
        定义方: item.source,
      }),
    );
  const problems = [
    ...compareFacts(
      "通用错误码",
      commonFacts(snapshot.commonErrors),
      "登记文档",
      commonFacts(doc.common),
    ),
    ...compareFacts(
      "领域错误码",
      domainFacts(snapshot.domainErrors),
      "frag",
      domainFacts(fragErrors),
    ),
    ...compareFacts(
      "领域错误码",
      domainFacts(snapshot.domainErrors),
      "登记文档",
      domainFacts(doc.domain),
    ),
    ...countProblem("通用错误码", {
      登记文档标题: doc.declared.common,
      登记文档表格: doc.common.length,
      契约: snapshot.commonErrors.length,
    }),
    ...countProblem("领域错误码", {
      登记文档标题: doc.declared.domain,
      登记文档表格: doc.domain.length,
      frag: fragErrors.length,
      契约: snapshot.domainErrors.length,
    }),
  ];

  const all = [...snapshot.commonErrors, ...snapshot.domainErrors];
  const repeatedSymbols = duplicates(all.map((item) => item.symbol));
  if (repeatedSymbols.length > 0)
    problems.push(`错误码的符号重复登记：${repeatedSymbols.join("、")}`);
  const repeatedCodes = duplicates(all.map((item) => item.code));
  if (repeatedCodes.length > 0) problems.push(`错误码的数值重复：${repeatedCodes.join("、")}`);

  // 取号区间：契约各文件带的区间 ↔ 裁决 A70 的表；每个码在定义方的区间内
  const render = (ranges: readonly CodeRange[]) =>
    ranges.map(([from, to]) => `${from}–${to}`).join("、");
  const ruled = parseCodeRanges(sources.texts.rulings);
  problems.push(
    ...compareFacts(
      "错误码的取号区间",
      facts(
        Object.entries(snapshot.errorRanges),
        ([source]) => source,
        ([, ranges]) => ({ 区间: render(ranges) }),
      ),
      "裁决 A70",
      // A70 的表列了全部文档；没有定义领域码的文档（如 x01）不在契约里，只比契约有的
      facts(
        Object.entries(ruled).filter(([source]) => source in snapshot.errorRanges),
        ([source]) => source,
        ([, ranges]) => ({ 区间: render(ranges) }),
      ),
    ),
  );
  for (const item of snapshot.domainErrors) {
    const ranges = snapshot.errorRanges[item.source] ?? [];
    if (!ranges.some(([from, to]) => item.code >= from && item.code <= to))
      problems.push(
        `领域错误码 ${item.symbol} 的数值 ${item.code} 不在定义方 ${item.source} 的取号区间内（${render(ranges)}）`,
      );
  }
  return problems;
}

/** 角色键 → 登记文档里的叫法（03 分组 第 2.1 节 staff_role.key 的说明） */
const ROLE_NAMES: Record<string, string> = {
  cs: "客服",
  delivery_manager: "交付经理",
  editor: "剪辑师",
  publisher: "发布专员",
  content_ops: "内容运营",
  channel_ops: "渠道运营",
  finance: "财务",
};

/** 默认授予在登记文档里的写法（去掉括号说明之后） */
function grantText(grant: PermissionGrant): string {
  switch (grant.kind) {
    case "super_admin_only":
      return "仅超级管理员";
    case "module_viewers":
      return "有该模块查看权的角色";
    case "all_staff":
      return "全体员工";
    case "undecided":
      return "见原型";
    case "roles":
      return grant.roles
        .map((item) => `${ROLE_NAMES[item.role] ?? item.role}${item.leadOnly ? "*" : ""}`)
        .join("、");
  }
}
const stepUpText = (value: boolean | null) => (value === null ? "待定" : value ? "要" : "否");
const accessText = (access: CapabilityAccess) =>
  access.allowed ? `✔${access.limit === null ? "" : `（${access.limit}）`}` : "✘";

/** 2、3. 权限点与能力点 */
function authzProblems(snapshot: ApiRegistrySnapshot, sources: ApiRegistrySources): string[] {
  const doc = parsePermissionsDoc(sources.texts.permissionsDoc);
  const titleOf = new Map<string, string>(
    PERMISSION_SECTIONS.map((item) => [item.key, item.title]),
  );
  const contractPermissions = facts(
    snapshot.permissions,
    (item) => item.key,
    (item) => ({
      名称: item.name,
      小节: titleOf.get(item.section) ?? item.section,
      默认授予: grantText(item.grant),
      再验证: stepUpText(item.stepUp),
      待分配池: item.pool ?? "—",
      起始版本: item.since.toUpperCase(),
    }),
  );
  const docPermissionFacts = (list: readonly DocPermission[]) =>
    facts(
      list,
      (item) => item.key,
      (item) => ({
        名称: item.name,
        小节: item.section,
        默认授予: item.grant,
        再验证: item.stepUp,
        待分配池: item.pool,
        起始版本: item.since,
      }),
    );
  const contractCapabilities = facts(
    snapshot.capabilities,
    (item) => item.key,
    (item) => ({
      含义: item.name,
      老板: accessText(item.owner),
      店员: accessText(item.clerk),
      已停用门店的老板: accessText(item.archivedOwner),
    }),
  );
  const docCapabilityFacts = (list: readonly DocCapability[]) =>
    facts(
      list,
      (item) => item.key,
      (item) => ({
        含义: item.name,
        老板: item.owner,
        店员: item.clerk,
        已停用门店的老板: item.archivedOwner,
      }),
    );
  const problems = [
    ...compareFacts("权限点", contractPermissions, "登记文档", docPermissionFacts(doc.permissions)),
    ...compareFacts(
      "能力点",
      contractCapabilities,
      "登记文档",
      docCapabilityFacts(doc.capabilities),
    ),
  ];

  // 数量：各小节标题里的数 = 该小节的表格行数 = 契约该小节的条数；第 1 节标题里的数 = V1.0 的条数
  for (const [title, declared] of doc.sectionCounts) {
    problems.push(
      ...countProblem(`权限点“${title}”一节`, {
        登记文档标题: declared,
        登记文档表格: doc.permissions.filter((item) => item.section === title).length,
        契约: snapshot.permissions.filter((item) => titleOf.get(item.section) === title).length,
      }),
    );
  }
  for (const title of titleOf.values()) {
    if (!doc.sectionCounts.has(title))
      problems.push(`权限点：契约的小节“${title}”在登记文档 第 1 节里没有对应的小节标题`);
  }
  problems.push(
    ...countProblem("V1.0 的权限点", {
      登记文档标题: doc.declaredV10,
      登记文档表格: doc.permissions.filter((item) => item.since === "V1.0").length,
      契约: snapshot.permissions.filter((item) => item.since === "v1.0").length,
    }),
    ...countProblem("能力点", {
      登记文档标题: doc.declaredCapabilities,
      登记文档表格: doc.capabilities.length,
      契约: snapshot.capabilities.length,
    }),
  );
  for (const [what, keys] of [
    ["权限点", snapshot.permissions.map((item) => item.key)],
    ["能力点", snapshot.capabilities.map((item) => item.key)],
  ] as const) {
    const repeated = duplicates(keys);
    if (repeated.length > 0) problems.push(`${what}的键重复登记：${repeated.join("、")}`);
  }

  // 接管时另比 gen_permissions.py 的产物：它的 module 就是小节标题（V1.1 一节叫“V1.1”）
  const generated = sources.permissionsJson;
  if (generated) {
    problems.push(
      ...compareFacts(
        "权限点",
        contractPermissions,
        "permissions.json",
        docPermissionFacts(
          generated.permissions.map((item) => ({
            key: item.key,
            section: item.module === "V1.1" ? "V1.1 的键" : item.module,
            name: item.name,
            grant: stripNotes(item.grant),
            stepUp: stripNotes(item.stepUp),
            pool: unquote(item.pool),
            since: item.version,
          })),
        ),
      ),
      ...compareFacts(
        "能力点",
        contractCapabilities,
        "permissions.json",
        docCapabilityFacts(generated.capabilities.map((item) => ({ ...item, name: item.meaning }))),
      ),
    );
  }

  // 模块键：a01 第 4 节 ModuleKey（键与顺序）；名称：03 分组 第 4 节列的 13 个模块
  const keys = enumValues(sources.texts.a01, "ModuleKey", "a01 第 4 节");
  if (keys.join("、") !== snapshot.modules.map((item) => item.key).join("、"))
    problems.push(
      `模块键：${CONTRACT}是 ${snapshot.modules.map((item) => item.key).join("、")}，a01 第 4 节 ModuleKey 是 ${keys.join("、")}`,
    );
  const names = /13 个模块：([^（]+)（/.exec(sources.texts.staffGroup)?.[1];
  if (names === undefined) throw new Error("03 分组 第 4 节：找不到“13 个模块：……”那一句");
  if (names !== snapshot.modules.map((item) => item.name).join("、"))
    problems.push(
      `模块名称：${CONTRACT}是 ${snapshot.modules.map((item) => item.name).join("、")}，03 分组 第 4 节是 ${names}`,
    );
  return problems;
}

/** 4. 资源登记 */
function resourceProblems(snapshot: ApiRegistrySnapshot, sources: ApiRegistrySources): string[] {
  const listed = JSON.parse(sources.texts.resources) as ResourceDef[];
  const resourceFacts = (list: readonly ResourceDef[]) =>
    facts(
      list,
      (item) => item.resource,
      (item) => ({
        表: item.table ?? "（无）",
        参数名: item.param ?? "（无）",
        端: item.surfaces.join("、") || "（无）",
        别名: item.aliases.join("、") || "（无）",
      }),
    );
  const problems = [
    ...compareFacts(
      "资源",
      resourceFacts(snapshot.resources),
      "resources.json",
      resourceFacts(listed),
    ),
    ...countProblem("资源", {
      "resources.json": listed.length,
      契约: snapshot.resources.length,
    }),
  ];
  const present = (value: string | null): value is string => value !== null;
  for (const [what, values] of [
    ["资源名", snapshot.resources.map((item) => item.resource)],
    ["资源对应的表", snapshot.resources.map((item) => item.table).filter(present)],
    ["资源的路径参数名", snapshot.resources.map((item) => item.param).filter(present)],
  ] as const) {
    const repeated = duplicates(values);
    if (repeated.length > 0) problems.push(`${what}重复登记：${repeated.join("、")}`);
  }
  return problems;
}

/** 5、6、7. 通知场景、订阅点位、埋点事件 */
function notifyAndAnalyticsProblems(
  snapshot: ApiRegistrySnapshot,
  sources: ApiRegistrySources,
): string[] {
  const sceneFacts = (list: readonly DocScene[]) =>
    facts(
      list,
      (item) => item.key,
      (item) => ({ 受众: item.audience, 显示名: item.name }),
    );
  const contractScenes = sceneFacts(snapshot.scenes);
  const fragScenes = (
    JSON.parse(sources.texts.a09Frag) as { notifyScenes?: { sceneKey: string; audience: string }[] }
  ).notifyScenes;
  if (!fragScenes || fragScenes.length === 0)
    throw new Error("frag a09-ops.json：没有 notifyScenes");
  const problems = [
    ...compareFacts(
      "通知场景",
      contractScenes,
      "a09 第 2.9 节",
      sceneFacts(parseA09Scenes(sources.texts.a09)),
    ),
    ...compareFacts(
      "通知场景",
      contractScenes,
      "frag",
      sceneFacts(
        fragScenes.map((item) => ({ key: item.sceneKey, audience: item.audience, name: null })),
      ),
    ),
    ...compareFacts(
      "通知场景",
      contractScenes,
      "13 分组 第 2.1 节",
      sceneFacts(parseSeededScenes(sources.texts.notifyGroup)),
    ),
  ];
  const repeatedScenes = duplicates(snapshot.scenes.map((item) => item.key));
  if (repeatedScenes.length > 0)
    problems.push(`通知场景的键重复登记：${repeatedScenes.join("、")}`);

  const self = (value: string) => value;
  const points = facts(snapshot.subscribePoints, self);
  // 这张表有三行在首格并列写了两个键（`ad_submit` / `ad_confirm`）：首格里反引号写的都算
  const d6Points = linesBetween(sources.texts.d6, /^#### 2\.9\.3 /, /^### 2\.10 /, "D6 第 2.9.3 节")
    .filter((line) => line.startsWith("| `"))
    .flatMap((line) => quoted(cell(cellsOf(line), 0)));
  if (d6Points.length === 0) throw new Error("D6 第 2.9.3 节：没有读到点位的表格行");
  problems.push(
    ...compareFacts(
      "订阅点位",
      points,
      "m08 第 4 节 SubscribePoint",
      facts(enumValues(sources.texts.m08, "SubscribePoint", "m08 第 4 节"), self),
    ),
    ...compareFacts("订阅点位", points, "D6 第 2.9.3 节", facts(d6Points, self)),
  );

  const eventFacts = (list: readonly { name: string; source: string }[]) =>
    facts(
      list,
      (item) => item.name,
      (item) => ({ 来源: item.source }),
    );
  const extensionLine = sources.texts.configGroup
    .split("\n")
    .find((line) => line.startsWith("| `analytics_event.name` |"));
  const extensionNames = quoted(extensionLine?.split("扩展事件")[1] ?? "");
  const prdCount = /PRD 的 (\d+) 个事件/.exec(extensionLine ?? "")?.[1];
  if (extensionNames.length === 0 || prdCount === undefined)
    throw new Error(
      "14 分组 第 3 节：analytics_event.name 一行里没有读到“PRD 的 N 个事件”与扩展事件的名字",
    );
  const d6Events = parseD6Events(sources.texts.d6);
  const prdEvents = snapshot.events.filter((item) => !item.extension);
  problems.push(
    ...compareFacts(
      "埋点事件（PRD 的）",
      eventFacts(prdEvents),
      "D6 第 5.1.1 节",
      eventFacts(d6Events),
    ),
    ...compareFacts(
      "埋点事件（扩展的）",
      facts(
        snapshot.events.filter((item) => item.extension),
        (item) => item.name,
      ),
      "14 分组 第 3 节",
      facts(extensionNames, self),
    ),
    ...compareFacts(
      "端上上报的埋点事件",
      facts(
        snapshot.events.filter((item) => item.source === "client"),
        (item) => item.name,
      ),
      "m08 第 4 节 ClientEventName",
      facts(enumValues(sources.texts.m08, "ClientEventName", "m08 第 4 节"), self),
    ),
    ...countProblem("PRD 的埋点事件", {
      "14 分组 第 3 节写的": Number(prdCount),
      "D6 第 5.1.1 节的表": d6Events.length,
      契约: prdEvents.length,
    }),
  );
  const repeatedEvents = duplicates(snapshot.events.map((item) => item.name));
  if (repeatedEvents.length > 0) problems.push(`埋点事件名重复登记：${repeatedEvents.join("、")}`);
  return problems;
}

/** 8. 07 第 7 节的待回写项 */
function pendingProblems(snapshot: ApiRegistrySnapshot, sources: ApiRegistrySources): string[] {
  const problems: string[] = [];
  const params = pendingRows(sources.texts.contractDoc, "参数");
  const flags = pendingRows(sources.texts.contractDoc, "开关");
  if (params.length === 0 || flags.length === 0)
    throw new Error("07 第 7 节：没有读到“参数”或“开关”两类的行");
  const registered = new Set(snapshot.paramKeys);
  for (const { key } of params) {
    if (!registered.has(key))
      problems.push(`待回写项：07 第 7 节的参数键 ${key} 还没有登记进契约的参数键清单`);
  }
  for (const { key, note } of flags) {
    const found = snapshot.flags.find((item) => item.key === key);
    if (!found) {
      problems.push(`待回写项：07 第 7 节的开关键 ${key} 还没有登记进契约的开关登记`);
      continue;
    }
    // 说明一栏：“json，`exposed_to = client`，默认 null（…）”“bool，默认关，`exposed_to = client`（…）”
    const valueType = /^[a-z]+/.exec(note)?.[0];
    const exposedTo = /exposed_to = ([a-z]+)/.exec(note)?.[1];
    const fallback = /默认 ?(null|关|开)/.exec(note)?.[1];
    const expected = fallback === "null" ? null : fallback === "开";
    if (valueType !== found.valueType)
      problems.push(
        `待回写项：开关 ${key} 的值类型：${CONTRACT}是 ${found.valueType}，07 第 7 节是 ${valueType}`,
      );
    if (exposedTo !== found.exposedTo)
      problems.push(
        `待回写项：开关 ${key} 的下发范围：${CONTRACT}是 ${found.exposedTo}，07 第 7 节是 ${exposedTo}`,
      );
    if (fallback === undefined || found.defaultValue !== expected)
      problems.push(
        `待回写项：开关 ${key} 的默认值：${CONTRACT}是 ${JSON.stringify(found.defaultValue)}，07 第 7 节是“默认${fallback ?? "（没写）"}”`,
      );
  }
  return problems;
}

/** 契约的各张登记表与文档对账，返回全部差异；没有差异时返回空数组 */
export function apiRegistryProblems(
  snapshot: ApiRegistrySnapshot = CONTRACT_SNAPSHOT,
  sources: ApiRegistrySources = loadSources(),
): string[] {
  return [
    ...errorProblems(snapshot, sources),
    ...authzProblems(snapshot, sources),
    ...resourceProblems(snapshot, sources),
    ...notifyAndAnalyticsProblems(snapshot, sources),
    ...pendingProblems(snapshot, sources),
  ];
}

/** 各表的条数，给输出与证据用 */
export function countsOf(snapshot: ApiRegistrySnapshot = CONTRACT_SNAPSHOT) {
  const since = (version: string) =>
    snapshot.permissions.filter((item) => item.since === version).length;
  const bySource = (source: string) =>
    snapshot.events.filter((item) => !item.extension && item.source === source).length;
  return {
    commonErrors: snapshot.commonErrors.length,
    domainErrors: snapshot.domainErrors.length,
    errorSources: Object.keys(snapshot.errorRanges).length,
    modules: snapshot.modules.length,
    permissions: snapshot.permissions.length,
    permissionsV10: since("v1.0"),
    permissionsV11: since("v1.1"),
    capabilities: snapshot.capabilities.length,
    resources: snapshot.resources.length,
    resourcesWithTable: snapshot.resources.filter((item) => item.table !== null).length,
    scenes: snapshot.scenes.length,
    merchantScenes: snapshot.scenes.filter((item) => item.audience === "merchant").length,
    staffScenes: snapshot.scenes.filter((item) => item.audience === "staff").length,
    subscribePoints: snapshot.subscribePoints.length,
    events: snapshot.events.length,
    prdEvents: snapshot.events.filter((item) => !item.extension).length,
    clientPrdEvents: bySource("client"),
    outboxEvents: bySource("outbox"),
    directEvents: bySource("direct"),
    extensionEvents: snapshot.events.filter((item) => item.extension).length,
    flags: snapshot.flags.length,
    paramKeys: snapshot.paramKeys.length,
  };
}

function parseArgs(argv: readonly string[]): { permissionsJsonPath?: string } {
  const args = argv.filter((arg) => arg !== "--");
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === "--permissions-json")
    return { permissionsJsonPath: args[1]! };
  throw new Error(`用法：tsx scripts/api-registries-check.ts [--permissions-json <路径>]`);
}

function main(): void {
  let problems: string[];
  let withJson = false;
  try {
    const options = parseArgs(process.argv.slice(2));
    withJson = options.permissionsJsonPath !== undefined;
    problems = apiRegistryProblems(CONTRACT_SNAPSHOT, loadSources(options));
  } catch (error) {
    console.error(
      `接口侧注册表对账：没跑成。${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
  const counts = countsOf();
  console.log(
    [
      "接口侧注册表对账（契约 ↔ docs/api 的登记文档、working 底稿与各依据文档）",
      `  错误码：通用 ${counts.commonErrors}；领域 ${counts.domainErrors}（${counts.errorSources} 份文档定义）`,
      `  权限点 ${counts.permissions}（V1.0 ${counts.permissionsV10}、V1.1 ${counts.permissionsV11}）；能力点 ${counts.capabilities}；后台模块 ${counts.modules}`,
      `  资源 ${counts.resources}（有表的 ${counts.resourcesWithTable}）`,
      `  通知场景 ${counts.scenes}（商家 ${counts.merchantScenes}、员工 ${counts.staffScenes}）；订阅点位 ${counts.subscribePoints}`,
      `  埋点事件 ${counts.events}：PRD 的 ${counts.prdEvents}（端上 ${counts.clientPrdEvents}、出站派生 ${counts.outboxEvents}、直记 ${counts.directEvents}），扩展 ${counts.extensionEvents}`,
      `  开关 ${counts.flags}；参数键 ${counts.paramKeys}（含 07 第 7 节补登的）`,
      withJson
        ? "  另比了 gen_permissions.py 的产物 permissions.json"
        : "  没有给 permissions.json：权限点、能力点只与登记文档比",
    ].join("\n"),
  );
  if (problems.length > 0) {
    console.error(`\n接口侧注册表对账未通过：${problems.length} 处差异`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("\n接口侧注册表对账通过：各表与文档 0 差异");
}

// 只在被直接执行时跑；被用例 import 时不跑
const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
