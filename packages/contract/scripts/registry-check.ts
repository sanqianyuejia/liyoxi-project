/**
 * 登记表对账（任务书 W0-09a 第 7 节第 1–5 条；计划 第 5.5 节“登记表对账”、第 5.7 节）：
 * 拿契约里的 x01 名称登记（packages/contract/src/registry）与 x01 对账，一处不符即非 0 退出。
 *
 * 用法（在仓库根目录）：
 *   pnpm registry:check   先重新生成归属表并 git diff --exit-code，再跑本脚本
 * 直接跑：tsx scripts/registry-check.ts，不带参数。只读文件，不连库。
 *
 * 核对五样：
 *   1. 名称集合 0 差异。事件、订阅者、定时器、周期任务、进程内循环五类：契约 ↔ docs/api/working/frag/
 *      x01-events-jobs.json ↔ x01 正文的表格，三方两两相同；连带核对事件的状态、聚合、发出模块，订阅者的模块
 *      与关键类，定时器的关键类，周期任务的归属。队列、回调、命令行三类 frag 里没有：契约 ↔ x01 第 4.4–4.6 节
 *      表格的首列。前缀登记（x01 第 2.2 节）由事件登记推出来再比：前缀、聚合、发出模块、事件数。
 *   2. 数量（EXPECTED_COUNTS）。
 *   3. 归属里程碑：七类条目各有里程碑，各里程碑各类的条目数等于 EXPECTED_MILESTONE_MATRIX。
 *   4. 名字的写法：事件名、kind、订阅者名、聚合、定时器主体满足 01 分组对应 CHECK 的正则
 *     （src/registry/formats.ts，它与库的一致由 pnpm enums:check 核对）；事件名另查 2–3 段、不超过 64 个字符。
 *   5. 归属表 docs/plan/x01-map.md 与登记数据现生成的逐字节相同，且已交给 git。
 *
 * 数量与里程碑矩阵写死在本文件里（EXPECTED_COUNTS、EXPECTED_MILESTONE_MATRIX），取自 x01 的“数量”一行与
 * 计划 第 8.4 节。加名字、改归属的 PR 要同时改 x01（或记计划变更）、登记数据与这两张表：三处对不上就红。
 * 不核对的：订阅关系、载荷、节奏、处理器（任务书 第 11 节第 7 项，不在登记数据里）。
 * 退出码：0 通过；1 有差异；2 环境错误（文件读不了）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVENT_NAME_MAX_LENGTH,
  EVENT_NAME_MAX_SEGMENTS,
  EVENT_NAME_MIN_SEGMENTS,
  MILESTONES,
  NAME_FORMATS,
  REGISTRY,
  eventPrefixesOf,
  matchesFormat,
  type EventStatus,
  type Milestone,
  type NameFormat,
  type RegistrySnapshot,
} from "../src/registry/index.js";

import { MAP_CATEGORIES, X01_MAP_PATH, milestoneMatrix, renderX01Map } from "./registry-map.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const X01_DOC_PATH = join(repoRoot, "docs/api/x01-events-jobs.md");
export const X01_FRAG_PATH = join(repoRoot, "docs/api/working/frag/x01-events-jobs.json");

/** 数量：x01 开头“数量”一行与第 2.2、3.16、4.4–4.6 节；聚合与定时器主体见 01 分组 第 3.3、3.4 节 */
export const EXPECTED_COUNTS = {
  eventsEmitted: 220,
  eventsNotEmitted: 7,
  eventsReserved: 1,
  prefixes: 52,
  aggregateTypes: 53,
  subscribers: 34,
  timerKinds: 18,
  timers: 24,
  timerSubjectTypes: 17,
  jobs: 25,
  loops: 11,
  queues: 8,
  callbacks: 7,
  commands: 4,
} as const;

/** 各里程碑各类的条目数，列的顺序同 MAP_CATEGORIES：订阅者、定时器、周期任务、循环、队列、回调、命令行（计划 第 8.4 节） */
export const EXPECTED_MILESTONE_MATRIX: Record<Milestone, readonly number[]> = {
  M0: [0, 0, 3, 4, 2, 0, 0],
  M1: [2, 2, 1, 2, 1, 0, 1],
  M2: [9, 3, 10, 3, 1, 1, 2],
  M3: [6, 3, 3, 1, 1, 2, 0],
  M4: [6, 4, 5, 0, 0, 2, 1],
  M5: [5, 4, 0, 1, 1, 0, 0],
  M6: [2, 5, 1, 0, 1, 0, 0],
  M7: [4, 3, 2, 0, 1, 2, 0],
};

// ---------- 读 x01 ----------

/** frag 里用到的部分 */
export interface X01Frag {
  events: { name: string; aggregate: string; module: string; status: string }[];
  timers: { kind: string; subject: string; critical: boolean }[];
  jobs: { kind: string; owner: string }[];
  loops: string[];
  subscribers: { name: string; module: string; critical: boolean }[];
}

export interface X01Sources {
  frag: X01Frag;
  /** x01 正文的全文 */
  markdown: string;
}

export function loadX01Sources(): X01Sources {
  return {
    frag: JSON.parse(readFileSync(X01_FRAG_PATH, "utf8")) as X01Frag,
    markdown: readFileSync(X01_DOC_PATH, "utf8"),
  };
}

/** x01 正文里各张表读出来的内容 */
export interface X01Body {
  prefixes: { prefix: string; aggregates: string[]; modules: string[]; count: number }[];
  subscribers: { name: string; module: string; critical: boolean }[];
  events: { name: string; aggregates: string[] | null; status: EventStatus }[];
  timers: { kind: string; subject: string; critical: boolean }[];
  jobs: { kind: string; module: string }[];
  loops: string[];
  queues: string[];
  callbacks: string[];
  commands: string[];
}

const unquote = (cell: string) => cell.replace(/^`(.*)`$/, "$1");
const sorted = (values: Iterable<string>) => [...values].sort();

/** 聚合一栏：“（无，aggregate_type 为空）”是不带聚合；“—”是没写（不发的事件）；其余取出里面的表名 */
function aggregatesOf(cell: string): string[] | null {
  if (cell === "—") return null;
  if (cell.startsWith("（无")) return [];
  return sorted(cell.match(/[a-z][a-z0-9_]*/g) ?? []);
}

/** 归属一栏：“billing（07）”取 billing */
const ownerOf = (cell: string) => cell.match(/^[a-z_]+/)?.[0] ?? cell;

/**
 * 一节里的表格行：从匹配 start 的标题行到下一个匹配 end 的标题行之间，取以“|”开头的行，
 * 去掉分隔行与表头（首格等于 header 的行），拆成单元格。只用靠前的几格，后面的格里有“|”也不影响
 */
function tableRows(markdown: string, start: RegExp, end: RegExp, header: string): string[][] {
  const lines = markdown.split("\n");
  const from = lines.findIndex((line) => start.test(line));
  const to = lines.findIndex((line, index) => index > from && end.test(line));
  if (from < 0 || to < 0) {
    throw new Error(`x01 正文里找不到 ${String(start)} 到 ${String(end)} 这一节`);
  }
  const rows = lines
    .slice(from, to)
    .filter((line) => line.startsWith("|") && !/^\|\s*-{3}/.test(line))
    .map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells[0] !== header);
  if (rows.length === 0)
    throw new Error(`x01 正文 ${String(start)} 一节里没有读到表格行（表头应是“${header}”）`);
  return rows;
}

const cell = (cells: string[], index: number) => cells[index] ?? "";

export function parseX01Markdown(markdown: string): X01Body {
  const rows = (start: RegExp, end: RegExp, header: string) =>
    tableRows(markdown, start, end, header);
  const emitted = rows(/^## 3\. /, /^### 3\.16 /, "事件名").map((cells) => ({
    name: unquote(cell(cells, 0)),
    aggregates: aggregatesOf(cell(cells, 2)),
    status: "v1" as EventStatus,
  }));
  const STATUS: Record<string, EventStatus> = { 不发: "not_emitted", 预留: "reserved" };
  const others = rows(/^### 3\.16 /, /^### 3\.17 /, "事件名").map((cells) => {
    const status = STATUS[cell(cells, 2)];
    if (!status)
      throw new Error(`x01 第 3.16 节：${cell(cells, 0)} 的状态不认识：${cell(cells, 2)}`);
    // 预留的事件把聚合写在“说明”里：“聚合 `表名`；…”
    const noted = cell(cells, 3).match(/聚合 `([a-z][a-z0-9_]*)`/)?.[1];
    return { name: unquote(cell(cells, 0)), aggregates: noted ? [noted] : null, status };
  });
  return {
    prefixes: rows(/^### 2\.2 /, /^### 2\.3 /, "前缀").map((cells) => ({
      prefix: unquote(cell(cells, 0)),
      aggregates: aggregatesOf(cell(cells, 1)) ?? [],
      modules: sorted(cell(cells, 2).split("、")),
      count: Number(cell(cells, 3)),
    })),
    subscribers: rows(/^### 2\.5 /, /^## 3\. /, "订阅者（`outbox_delivery.subscriber`）").map(
      (cells) => ({
        name: unquote(cell(cells, 0)),
        module: cell(cells, 1),
        critical: cell(cells, 2) === "是",
      }),
    ),
    events: [...emitted, ...others],
    timers: rows(/^### 4\.1 /, /^### 4\.2 /, "kind").map((cells) => ({
      kind: unquote(cell(cells, 0)),
      subject: unquote(cell(cells, 1)),
      critical: cell(cells, 2) === "是",
    })),
    jobs: rows(/^### 4\.2 /, /^### 4\.3 /, "kind").map((cells) => ({
      kind: unquote(cell(cells, 0)),
      module: ownerOf(cell(cells, 4)),
    })),
    loops: rows(/^### 4\.3 /, /^### 4\.4 /, "循环").map((cells) => cell(cells, 0)),
    queues: rows(/^### 4\.4 /, /^### 4\.5 /, "通道").map((cells) => cell(cells, 0)),
    callbacks: rows(/^### 4\.5 /, /^### 4\.6 /, "operationId").map((cells) =>
      unquote(cell(cells, 0)),
    ),
    commands: rows(/^### 4\.6 /, /^### 4\.7 /, "命令").map((cells) => unquote(cell(cells, 0))),
  };
}

// ---------- 对账 ----------

/** 两个集合的差：各列出对方没有的 */
function diffNames(
  what: string,
  [leftName, left]: readonly [string, Iterable<string>],
  [rightName, right]: readonly [string, Iterable<string>],
): string[] {
  const [a, b] = [new Set(left), new Set(right)];
  const problems: string[] = [];
  const onlyLeft = sorted(a).filter((name) => !b.has(name));
  const onlyRight = sorted(b).filter((name) => !a.has(name));
  if (onlyLeft.length > 0)
    problems.push(`${what}：${leftName}有而${rightName}没有：${onlyLeft.join("、")}`);
  if (onlyRight.length > 0)
    problems.push(`${what}：${rightName}有而${leftName}没有：${onlyRight.join("、")}`);
  return problems;
}

const duplicates = (values: readonly string[]) =>
  sorted(new Set(values.filter((value, index) => values.indexOf(value) !== index)));

const CONTRACT = "契约";
const FRAG = "frag";
const BODY = "x01 正文";
const timerKey = (item: { kind: string; subject: string }) => `${item.kind} × ${item.subject}`;
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const flag = (value: boolean) => (value ? "是" : "否");
const joined = (values: readonly string[] | null) =>
  values === null ? null : sorted(values).join("、") || "（无）";

/** 一类条目在某一头的样子：名字 → 属性。属性值为 null 表示这一头没写，不比 */
type Facts = Map<string, Record<string, string | null>>;

function facts<T>(
  list: readonly T[],
  keyOf: (item: T) => string,
  attributesOf: (item: T) => Record<string, string | null> = () => ({}),
): Facts {
  return new Map(list.map((item) => [keyOf(item), attributesOf(item)]));
}

/** 契约的一类条目与另一头比：先比名称集合，再对同名的项逐个比属性 */
function compareFacts(what: string, contract: Facts, source: string, theirs: Facts): string[] {
  const problems = diffNames(what, [CONTRACT, contract.keys()], [source, theirs.keys()]);
  for (const [name, mine] of contract) {
    for (const [label, expected] of Object.entries(theirs.get(name) ?? {})) {
      if (expected !== null && mine[label] !== expected)
        problems.push(
          `${what} ${name} 的${label}：${CONTRACT}是 ${mine[label]}，${source}是 ${expected}`,
        );
    }
  }
  return problems;
}

const self = (name: string) => name;

/** 1. 名称集合，连带各项的属性 */
function nameProblems(registry: RegistrySnapshot, frag: X01Frag, body: X01Body): string[] {
  const prefixFacts = (list: readonly ReturnType<typeof eventPrefixesOf>[number][]) =>
    facts(
      list,
      (item) => item.prefix,
      (item) => ({
        聚合: joined(item.aggregates),
        发出模块: joined(item.modules),
        事件数: String(item.count),
      }),
    );
  const subscriberFacts = (list: readonly { name: string; module: string; critical: boolean }[]) =>
    facts(
      list,
      (item) => item.name,
      (item) => ({ 模块: item.module, 关键类: flag(item.critical) }),
    );
  const timerFacts = (list: readonly { kind: string; subject: string; critical: boolean }[]) =>
    facts(list, timerKey, (item) => ({ 关键类: flag(item.critical) }));
  const jobFacts = (list: readonly { kind: string; module: string }[]) =>
    facts(
      list,
      (item) => item.kind,
      (item) => ({ 归属: item.module }),
    );
  const labels = (list: readonly { label: string }[]) => facts(list, (item) => item.label);

  // 每一类：契约的样子，以及要比的另一头。不发的事件 frag 里聚合与模块都是“—”，正文的事件表没有模块一栏：不比。
  // 前缀登记由事件登记推出来再比。队列、回调、命令行 frag 里没有，只比正文表格的首列
  const categories: [what: string, contract: Facts, others: [source: string, theirs: Facts][]][] = [
    [
      "事件",
      facts(
        registry.events,
        (item) => item.name,
        (item) => ({ 状态: item.status, 聚合: joined(item.aggregates), 发出模块: item.module }),
      ),
      [
        [
          FRAG,
          facts(
            frag.events,
            (item) => item.name,
            (item) => ({
              状态: item.status,
              聚合: joined(aggregatesOf(item.aggregate)),
              发出模块: item.module === "—" ? null : item.module,
            }),
          ),
        ],
        [
          BODY,
          facts(
            body.events,
            (item) => item.name,
            (item) => ({ 状态: item.status, 聚合: joined(item.aggregates) }),
          ),
        ],
      ],
    ],
    [
      "事件前缀",
      prefixFacts(eventPrefixesOf(registry.events)),
      [[BODY, prefixFacts(body.prefixes)]],
    ],
    [
      "订阅者",
      subscriberFacts(registry.subscribers),
      [
        [FRAG, subscriberFacts(frag.subscribers)],
        [BODY, subscriberFacts(body.subscribers)],
      ],
    ],
    [
      "定时器",
      timerFacts(registry.timers),
      [
        [FRAG, timerFacts(frag.timers)],
        [BODY, timerFacts(body.timers)],
      ],
    ],
    [
      "周期任务",
      jobFacts(registry.jobs),
      [
        [
          FRAG,
          jobFacts(frag.jobs.map((item) => ({ kind: item.kind, module: ownerOf(item.owner) }))),
        ],
        [BODY, jobFacts(body.jobs)],
      ],
    ],
    [
      "进程内循环",
      labels(registry.loops),
      [
        [FRAG, facts(frag.loops, self)],
        [BODY, facts(body.loops, self)],
      ],
    ],
    ["队列通道", labels(registry.queues), [[BODY, facts(body.queues, self)]]],
    [
      "回调处理",
      facts(registry.callbacks, (item) => item.operationId),
      [[BODY, facts(body.callbacks, self)]],
    ],
    ["命令行", labels(registry.commands), [[BODY, facts(body.commands, self)]]],
  ];
  const problems = categories.flatMap(([what, contract, others]) =>
    others.flatMap(([source, theirs]) => compareFacts(what, contract, source, theirs)),
  );

  // 重名：同一类里不许重；定时器与周期任务的 kind 写进同一列（timer.kind），两类之间也不许重
  const unique: [what: string, values: string[]][] = [
    ["事件名", registry.events.map((item) => item.name)],
    ["订阅者名", registry.subscribers.map((item) => item.name)],
    ["定时器（kind × 主体）", registry.timers.map(timerKey)],
    [
      "周期任务的 kind（与定时器的 kind 合在一起看）",
      [
        ...new Set(registry.timers.map((item) => item.kind)),
        ...registry.jobs.map((item) => item.kind),
      ],
    ],
    ["回调的 operationId", registry.callbacks.map((item) => item.operationId)],
    ...LABELED.flatMap(([what, pick]): [string, string[]][] => [
      [`${what}的标识符`, pick(registry).map((item) => item.id)],
      [`${what}的叫法`, pick(registry).map((item) => item.label)],
    ]),
  ];
  for (const [what, values] of unique) {
    const repeated = duplicates(values);
    if (repeated.length > 0) problems.push(`${what}重复登记：${repeated.join("、")}`);
  }
  return problems;
}

/** 带标识符与叫法两样的三类 */
const LABELED: [what: string, pick: (registry: RegistrySnapshot) => RegistrySnapshot["loops"]][] = [
  ["进程内循环", (registry) => registry.loops],
  ["队列通道", (registry) => registry.queues],
  ["命令行", (registry) => registry.commands],
];

/** 2. 数量 */
export function countsOf(registry: RegistrySnapshot): Record<keyof typeof EXPECTED_COUNTS, number> {
  const status = (value: EventStatus) =>
    registry.events.filter((item) => item.status === value).length;
  const distinct = (values: readonly string[]) => new Set(values).size;
  return {
    eventsEmitted: status("v1"),
    eventsNotEmitted: status("not_emitted"),
    eventsReserved: status("reserved"),
    prefixes: eventPrefixesOf(registry.events).length,
    aggregateTypes: distinct(registry.events.flatMap((item) => [...item.aggregates])),
    subscribers: registry.subscribers.length,
    timerKinds: distinct(registry.timers.map((item) => item.kind)),
    timers: registry.timers.length,
    timerSubjectTypes: distinct(registry.timers.map((item) => item.subject)),
    jobs: registry.jobs.length,
    loops: registry.loops.length,
    queues: registry.queues.length,
    callbacks: registry.callbacks.length,
    commands: registry.commands.length,
  };
}

const COUNT_LABELS: Record<keyof typeof EXPECTED_COUNTS, string> = {
  eventsEmitted: "V1.0 发出的事件",
  eventsNotEmitted: "不发的事件",
  eventsReserved: "预留的事件",
  prefixes: "事件前缀",
  aggregateTypes: "聚合（aggregate_type）",
  subscribers: "订阅者",
  timerKinds: "定时器的 kind",
  timers: "定时器（kind × 主体）",
  timerSubjectTypes: "定时器主体（subject_type）",
  jobs: "周期任务",
  loops: "进程内循环",
  queues: "队列通道",
  callbacks: "回调处理",
  commands: "命令行",
};

function countProblems(registry: RegistrySnapshot): string[] {
  const actual = countsOf(registry);
  return (Object.keys(EXPECTED_COUNTS) as (keyof typeof EXPECTED_COUNTS)[])
    .filter((key) => actual[key] !== EXPECTED_COUNTS[key])
    .map(
      (key) =>
        `数量：${COUNT_LABELS[key]}应为 ${EXPECTED_COUNTS[key]} 个，契约登记了 ${actual[key]} 个`,
    );
}

/** 3. 归属里程碑 */
function milestoneProblems(registry: RegistrySnapshot): string[] {
  const problems: string[] = [];
  const known = new Set<string>(MILESTONES);
  const dated: [what: string, items: readonly { name: string; milestone: string }[]][] = [
    ["订阅者", registry.subscribers],
    ["定时器", registry.timers.map((item) => ({ ...item, name: timerKey(item) }))],
    ["周期任务", registry.jobs.map((item) => ({ ...item, name: item.kind }))],
    ...LABELED.map(([what, pick]): [string, { name: string; milestone: string }[]] => [
      what,
      pick(registry).map((item) => ({ ...item, name: item.label })),
    ]),
    ["回调处理", registry.callbacks.map((item) => ({ ...item, name: item.operationId }))],
  ];
  for (const [what, items] of dated) {
    for (const item of items) {
      if (!known.has(item.milestone))
        problems.push(
          `里程碑：${what} ${item.name} 的里程碑是“${item.milestone}”，不在 ${MILESTONES.join("、")} 之内`,
        );
    }
  }
  const actual = milestoneMatrix(registry);
  for (const milestone of MILESTONES) {
    MAP_CATEGORIES.forEach((category, column) => {
      const expected = EXPECTED_MILESTONE_MATRIX[milestone][column];
      const got = actual[milestone][column];
      if (expected !== got)
        problems.push(
          `里程碑：${milestone} 的${category}应为 ${expected} 个（计划 第 8.4 节），契约登记了 ${got} 个`,
        );
    });
  }
  return problems;
}

/** 4. 名字的写法 */
function formatProblems(registry: RegistrySnapshot): string[] {
  const problems: string[] = [];
  const check = (what: string, format: NameFormat, values: Iterable<string>) => {
    for (const value of new Set(values)) {
      if (!matchesFormat(format, value))
        problems.push(
          `写法：${what} ${value} 不合 ${format.column} 的 CHECK 正则 ${format.pattern}`,
        );
    }
  };
  const eventNames = registry.events.map((item) => item.name);
  check("事件名", NAME_FORMATS.eventType, eventNames);
  for (const name of eventNames) {
    const segments = name.split(".").length;
    if (segments < EVENT_NAME_MIN_SEGMENTS || segments > EVENT_NAME_MAX_SEGMENTS)
      problems.push(
        `写法：事件名 ${name} 是 ${segments} 段，应为 ${EVENT_NAME_MIN_SEGMENTS}–${EVENT_NAME_MAX_SEGMENTS} 段（x01 第 2.1 节 N1）`,
      );
    if (name.length > EVENT_NAME_MAX_LENGTH)
      problems.push(
        `写法：事件名 ${name} 超过 ${EVENT_NAME_MAX_LENGTH} 个字符（x01 第 2.1 节 N1）`,
      );
  }
  check(
    "聚合",
    NAME_FORMATS.aggregateType,
    registry.events.flatMap((item) => [...item.aggregates]),
  );
  check(
    "订阅者名",
    NAME_FORMATS.subscriber,
    registry.subscribers.map((item) => item.name),
  );
  check(
    "定时器的 kind",
    NAME_FORMATS.timerKind,
    registry.timers.map((item) => item.kind),
  );
  check(
    "周期任务的 kind",
    NAME_FORMATS.timerKind,
    registry.jobs.map((item) => item.kind),
  );
  check(
    "定时器主体",
    NAME_FORMATS.timerSubjectType,
    registry.timers.map((item) => item.subject),
  );
  for (const [what, pick] of LABELED) {
    for (const item of pick(registry)) {
      if (!IDENTIFIER.test(item.id))
        problems.push(`写法：${what}“${item.label}”的标识符 ${item.id} 不是小写蛇形`);
    }
  }
  for (const item of registry.callbacks) {
    if (!item.operationId.startsWith("hooks."))
      problems.push(`写法：回调的 operationId ${item.operationId} 不以 hooks. 开头`);
  }
  return problems;
}

/** 契约的登记与 x01 对账，返回全部差异；没有差异时返回空数组 */
export function registryProblems(
  registry: RegistrySnapshot = REGISTRY,
  sources: X01Sources = loadX01Sources(),
): string[] {
  const body = parseX01Markdown(sources.markdown);
  return [
    ...nameProblems(registry, sources.frag, body),
    ...countProblems(registry),
    ...milestoneProblems(registry),
    ...formatProblems(registry),
  ];
}

/** 5. 归属表与登记数据一致，且已交给 git */
export function mapFileProblems(registry: RegistrySnapshot = REGISTRY): string[] {
  const path = relative(repoRoot, X01_MAP_PATH);
  let committed: string;
  try {
    committed = readFileSync(X01_MAP_PATH, "utf8");
  } catch {
    return [`归属表：${path} 不存在，先跑 pnpm registry:generate`];
  }
  const problems: string[] = [];
  if (committed !== renderX01Map(registry))
    problems.push(
      `归属表：${path} 与登记数据现生成的不一致（它是生成物：跑 pnpm registry:generate，不手改）`,
    );
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", path], {
      cwd: repoRoot,
      stdio: "ignore",
    });
  } catch {
    problems.push(`归属表：${path} 还没有交给 git（git add 后一起提交）`);
  }
  return problems;
}

function main(): void {
  let problems: string[];
  try {
    problems = [...registryProblems(), ...mapFileProblems()];
  } catch (error) {
    console.error(`登记表对账：没跑成。${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const counts = countsOf(REGISTRY);
  console.log(
    [
      "登记表对账（契约的 x01 名称登记 ↔ docs/api/x01-events-jobs.md 与 working/frag/x01-events-jobs.json）",
      `  事件 ${counts.eventsEmitted} + ${counts.eventsNotEmitted} + ${counts.eventsReserved}（发出、不发、预留），前缀 ${counts.prefixes}，聚合 ${counts.aggregateTypes}`,
      `  订阅者 ${counts.subscribers}；定时器 ${counts.timerKinds} 个 kind、${counts.timers} 行，主体 ${counts.timerSubjectTypes}；周期任务 ${counts.jobs}`,
      `  进程内循环 ${counts.loops}；队列通道 ${counts.queues}；回调处理 ${counts.callbacks}；命令行 ${counts.commands}`,
      "  各里程碑的条目数（订阅者、定时器、周期任务、循环、队列、回调、命令行）：",
      ...MILESTONES.map(
        (milestone) => `    ${milestone}：${milestoneMatrix()[milestone].join("、")}`,
      ),
    ].join("\n"),
  );
  if (problems.length > 0) {
    console.error(`\n登记表对账未通过：${problems.length} 处差异`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("\n登记表对账通过：名称集合、数量、归属里程碑、写法、归属表，0 差异");
}

// 只在被直接执行时跑；被用例 import 时不跑
const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
