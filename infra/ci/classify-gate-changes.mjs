#!/usr/bin/env node
// 门禁改动分类：把一个 PR 对门禁文件的改动分成“只增”与“放松”（计划 第 5.3 节“门禁改动”行）。
//
// 用法：node infra/ci/classify-gate-changes.mjs --base <git 引用> [--head <git 引用>]
//         [--gate-files <清单>] [--labels <逗号分隔>] [--pr <编号> --repo <所有者/仓库>] [--out <结果.json>]
//   --base        基线，一般是 origin/main。只看 base 与 head 的共同祖先之后的改动
//   --head        缺省 HEAD
//   --gate-files  门禁文件清单；缺省取脚本旁边的 gate-files.json
//   --labels      本地试跑时给出 PR 的标签；带 --pr 时不用，标签从 PR 上读
//   --pr、--repo  CI 用：经 gh 读 PR 的标签，把清单写进 PR 描述顶部两个标记之间，有只增项就打 gate-touch
//   --out         把结果另存成 JSON
// 口径（清单里每个 kind 的判法；判不出的一律按放松算）：
//   append         新增文件、加行算只增；删改已有行算放松；加的行像忽略、豁免、白名单，或像关掉、降级检查，也算放松
//   new-file       只许新增文件；改已有的文件一律算放松（检查脚本、门禁自测：加一行就能让它空转，逐行判不出）
//   workflow       同 append，且加的每一段从头到尾必须是整个步骤（“- ” 开头）或整个任务，否则算放松
//   frozen         一动就算放松，新建也算（它的条目是本次差异里新登记的，新建才算只增：分支头的清单里有，
//                  共同祖先与 --base 那一头的清单里都没有）
//   tsconfig       按解析后的键值判（允许注释与行尾逗号），换行、重排不算改动。新增键算只增；删、改已有的键值算放松；
//                  把严格性开关关掉（新增 "noImplicitAny": false、skipLibCheck 由 false 改 true 之类）算放松；
//                  新增 exclude、include、files、extends，或往 exclude 里加项，算放松（会改变查哪些文件、继承哪份预设）
//   manifest       依赖只许新增，且要写精确版本（工作区内部包写 workspace: 除外）；写成范围、标签、别名的判不出，
//                  算放松。版本有变、删除算放松（升级要单独成 PR）。已有的 typecheck、test、lint 脚本
//                  被删、被改算放松，两种改法除外：占位（echo）换成真实命令、去掉 --passWithNoTests。build 不管。
//                  prettier、lint-staged、commitlint、eslintConfig 这几个键一动就算放松（工具先读它，会遮蔽已登记的配置）
//   root-manifest  依赖同 manifest；脚本只许新增；engines、packageManager、pnpm、resolutions、overrides 一动就算放松；
//                  已知集合以外的顶层键有变（新增也算）一律算放松
//   lockfile       packages 段只许新增条目，已有条目的内容（来源、校验值）有变算放松；头部设置有变算放松；
//                  importers 段里已有依赖的 specifier、解析版本有变或被删算放松；snapshots 段里已有条目的依赖
//                  版本有变或被删算放松。版本后面括号里的 peer 解析不比：加一个依赖就会让它变。
//                  snapshots 的条目按完整的键（带 peer 解析）逐个比；键本身变了的，退回与同名的几份并在一起比；
//                  新出现的同名条目（多一份 peer 解析）里，依赖版本与基线上同名条目不一致也算放松，
//                  这个包自己声明的 peer 依赖除外
//   layers         只许新增模块登记；改已登记模块的层、改同层策略或白名单算放松
//   registry       门禁文件清单只许新增条目
//   删除任何门禁文件都算放松。
// 结论：没有放松项即通过。有放松项时 PR 必须带 gate-change 标签；带 gate-change 的 PR 不得改门禁文件以外的路径。
// 退出码：0 通过；1 不通过；2 用法或环境错误。
// 本脚本不引依赖，在仓库根目录跑。CI 里跑的是 main 上的这份脚本与清单（main 上还没有时用 PR 里的）。

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const START = "<!-- gate-diff:start -->";
const END = "<!-- gate-diff:end -->";
const TOUCH_LABEL = "gate-touch";
const CHANGE_LABEL = "gate-change";
const MAX_ITEMS = 40;
/** 清单在仓库里的位置：只用来看本次差异新登记了哪些条目 */
const REGISTRY_PATH = "infra/ci/gate-files.json";
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const ROOT_FROZEN_FIELDS = ["engines", "packageManager", "pnpm", "resolutions", "overrides"];
/** 根 package.json 里不影响任何检查的顶层键。依赖、脚本与上面五个字段另有判法；其余的键一律判不出 */
const ROOT_PLAIN_FIELDS = [
  "name",
  "version",
  "private",
  "description",
  "type",
  "license",
  "author",
  "contributors",
  "repository",
  "homepage",
  "bugs",
  "keywords",
];
/** 工具会先读 package.json 里的这几个键，读到了就不再看已登记的配置文件 */
const TOOL_CONFIG_FIELDS = ["commitlint", "eslintConfig", "lint-staged", "prettier"];
/** 依赖的写法：精确版本（可带预发布与构建号）；工作区内部包用 workspace: 协议，只会解析到本仓库的包 */
const PINNED_VERSION = /^(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|workspace:.+)$/;
/** tsconfig 的严格性开关（TypeScript 5.9）：第一组取 true 为严，第二组取 false 为严 */
const TS_STRICT_WHEN_TRUE = new Set([
  "strict",
  "noImplicitAny",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictBindCallApply",
  "strictPropertyInitialization",
  "strictBuiltinIteratorReturn",
  "noImplicitThis",
  "useUnknownInCatchVariables",
  "alwaysStrict",
  "noUnusedLocals",
  "noUnusedParameters",
  "exactOptionalPropertyTypes",
  "noImplicitReturns",
  "noFallthroughCasesInSwitch",
  "noUncheckedIndexedAccess",
  "noImplicitOverride",
  "noPropertyAccessFromIndexSignature",
  "noUncheckedSideEffectImports",
  "checkJs",
  "isolatedModules",
  "isolatedDeclarations",
  "verbatimModuleSyntax",
  "erasableSyntaxOnly",
  "forceConsistentCasingInFileNames",
]);
const TS_STRICT_WHEN_FALSE = new Set([
  "skipLibCheck",
  "skipDefaultLibCheck",
  "noCheck",
  "allowUnreachableCode",
  "allowUnusedLabels",
  "suppressExcessPropertyErrors",
  "suppressImplicitAnyIndexErrors",
  "noStrictGenericChecks",
]);
/** tsconfig 顶层这几个键新增即判不出：改变查哪些文件、继承哪份预设 */
const TS_SCOPE_FIELDS = ["exclude", "include", "files", "extends"];
/** 工作区包里被根脚本或验收命令用到的脚本：已有的被删、被改要判（build 是占位，由后面的包换成真实构建，不管） */
const GUARDED_SCRIPTS = ["typecheck", "test", "lint"];
/** 空转的脚本：空串、占位的 echo、true、冒号、exit 0，或命令后面接“|| true”之类 */
const NOOP_SCRIPT =
  /^\s*(?:$|echo\b|true\s*$|:\s*$|exit\s+0\s*$)|\|\|\s*(?:true\b|:\s*$|exit\s+0\b|echo\b)/;
// 关键字只是粗筛，宁可把无害的行错判成放松。allow、skip、exclude 要在词首，免得 disallow、shallow 之类被带上。
// 第二行是关掉、降级检查的写法：规则级别 off、warn 与数字 0、1；检查脚本提前退出；依赖方向不跟进；没有用例也算过
const EXEMPTION = new RegExp(
  [
    /eslint-disable|ts-ignore|ts-expect-error|ts-nocheck|ignores?\b|\bexclude|pathNot|\ballow|\bskip|\.only\b|continue-on-error|豁免|白名单|放行/,
    /["'](?:off|warn)["']|["']\s*:\s*\[?\s*[01]\s*(?:[,\]}]|$)|process\.exit|\bexit\s+0\b|doNotFollow|passWithNoTests/,
  ]
    .map((part) => part.source)
    .join("|"),
  "i",
);
const WORKFLOW_EXEMPTION =
  /continue-on-error|(?:paths|branches|tags)-ignore|\bif:\s*(?:false|\$\{\{\s*false)/;

function fail(message) {
  console.error(`门禁改动分类：${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    base: null,
    head: "HEAD",
    gateFiles: null,
    labels: [],
    pr: null,
    repo: null,
    out: null,
  };
  const names = {
    "--base": "base",
    "--head": "head",
    "--gate-files": "gateFiles",
    "--labels": "labels",
    "--pr": "pr",
    "--repo": "repo",
    "--out": "out",
  };
  for (let index = 0; index < argv.length; index += 2) {
    const name = names[argv[index]];
    const value = argv[index + 1];
    if (!name) fail(`不认识的参数 ${argv[index]}。用法见脚本开头的注释`);
    if (value === undefined) fail(`${argv[index]} 后面要跟一个值`);
    options[name] =
      name === "labels"
        ? value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : value;
  }
  if (!options.base) fail("缺 --base");
  if ((options.pr === null) !== (options.repo === null)) fail("--pr 与 --repo 要一起给");
  return options;
}

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (allowFail) return null;
    return fail(
      `git ${args.slice(0, 2).join(" ")} 失败。${String(error.stderr || error.message).trim()}`,
    );
  }
}

/** 清单里的匹配式转成正则：** 跨目录，* 不跨目录，其余按字面 */
function globToRegExp(glob) {
  const source = glob
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => {
      if (part === "**/") return "(?:.*/)?";
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${source}$`);
}

const excerpt = (line) => {
  const text = line.trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
};
const isBlank = (line) => line.trim() === "";
const stable = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

/** 一个文件的改动，按 -U0 拆成段：每段是连续删掉的行与连续加上的行 */
function hunksOf(base, head, path) {
  const text = git(["diff", "--no-renames", "--no-color", "-U0", base, head, "--", path]);
  const hunks = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) {
      current = { removed: [], added: [] };
      hunks.push(current);
    } else if (current && line.startsWith("-")) current.removed.push(line.slice(1));
    else if (current && line.startsWith("+")) current.added.push(line.slice(1));
  }
  return hunks;
}

const JOB_KEY = /^ {2}[\w-]+:\s*(?:#.*)?$/;
const LIST_ITEM = /^\s*- /;
const indentOf = (line) => line.length - line.trimStart().length;

/**
 * 工作流里加的一段是不是从头到尾都在新增的步骤或任务之内：是则返回 null，否则返回第一处判不出的行。
 * 一段以步骤（列表项）或任务的键开头；后面的行要么缩进更深，要么是同一层的下一个步骤、下一个任务。
 * 缩进退到步骤之外的行（比如跟在新步骤后面的任务级 if:）会落到已有的任务头上，判不出。
 */
function strayWorkflowLine(lines) {
  let floor = null;
  let inJob = false;
  for (const line of lines) {
    if (line.trim().startsWith("#")) continue;
    const indent = indentOf(line);
    if (floor !== null && indent > floor) continue;
    if (JOB_KEY.test(line)) [floor, inJob] = [2, true];
    else if (LIST_ITEM.test(line) && (floor === null || (!inJob && indent === floor)))
      [floor, inJob] = [indent, false];
    else return line;
  }
  return null;
}

// ---------- 各 kind 的判法：返回 { touch: [说明], loosen: [说明] } ----------

function byLines({ hunks }, { blocks }) {
  const touch = [];
  const loosen = [];
  let addedLines = 0;
  for (const hunk of hunks) {
    for (const line of hunk.removed.filter((l) => !isBlank(l))) {
      loosen.push(`删改了已有行：${excerpt(line)}`);
    }
    const added = hunk.added.filter((l) => !isBlank(l));
    if (added.length === 0) continue;
    for (const line of added) {
      if ((blocks ? WORKFLOW_EXEMPTION : EXEMPTION).test(line)) {
        loosen.push(`加的行像是忽略、豁免或白名单（含关掉、降级检查的写法）：${excerpt(line)}`);
      }
    }
    if (blocks && hunk.removed.every(isBlank)) {
      const first = added.find((l) => !l.trim().startsWith("#"));
      const stray = strayWorkflowLine(added);
      if (first === undefined) addedLines += added.length;
      else if (stray === null) touch.push(`新增步骤或任务：${excerpt(first)}`);
      else if (stray === first)
        loosen.push(`往已有的步骤或任务里加了行，判不出是不是只增：${excerpt(first)}`);
      else loosen.push(`新增的步骤或任务后面夹带了它之外的行，判不出是不是只增：${excerpt(stray)}`);
    } else addedLines += added.length;
  }
  if (addedLines > 0 && loosen.length === 0) touch.push(`新增 ${addedLines} 行`);
  return { touch, loosen };
}

function parseJson(text, label, loosen) {
  if (text === null) return {};
  try {
    return record(JSON.parse(text));
  } catch {
    loosen.push(`${label}解析不了，判不出`);
    return null;
  }
}

function byManifest({ baseText, headText }, { root }) {
  const touch = [];
  const loosen = [];
  const base = parseJson(baseText, "基线上的文件", loosen);
  const head = parseJson(headText, "改后的文件", loosen);
  if (!base || !head) return { touch, loosen };
  for (const field of DEP_FIELDS) {
    const [before, after] = [record(base[field]), record(head[field])];
    for (const [name, value] of Object.entries(after)) {
      const shown = typeof value === "string" ? value : JSON.stringify(value);
      if (name in before) {
        if (before[name] !== value)
          loosen.push(`依赖版本有变 ${name}：${before[name]} → ${shown}（升级要单独成 PR）`);
      } else if (typeof value === "string" && PINNED_VERSION.test(value)) {
        touch.push(`新增依赖 ${name}@${shown}（${field}）`);
      } else {
        loosen.push(
          `新增依赖 ${name}@${shown}（${field}）不是精确版本，判不出装的是哪一版（CLAUDE.md 第 4 节：全部写精确版本）`,
        );
      }
    }
    for (const name of Object.keys(before)) {
      if (!(name in after)) loosen.push(`${field} 里删掉了 ${name}`);
    }
  }
  if (root) {
    const [before, after] = [record(base.scripts), record(head.scripts)];
    for (const [name, value] of Object.entries(after)) {
      if (!(name in before)) touch.push(`新增根脚本 ${name}`);
      else if (before[name] !== value) loosen.push(`改了已有的根脚本 ${name}`);
    }
    for (const name of Object.keys(before)) {
      if (!(name in after)) loosen.push(`scripts 里删掉了 ${name}`);
    }
    for (const field of ROOT_FROZEN_FIELDS) {
      if (stable(base[field]) !== stable(head[field])) loosen.push(`改了 ${field}`);
    }
    const judged = new Set([...DEP_FIELDS, "scripts", ...ROOT_FROZEN_FIELDS, ...ROOT_PLAIN_FIELDS]);
    for (const field of new Set([...Object.keys(base), ...Object.keys(head)])) {
      if (judged.has(field) || stable(base[field]) === stable(head[field])) continue;
      const how = !(field in base) ? "新增了" : !(field in head) ? "删掉了" : "改了";
      loosen.push(
        `${how}顶层键 ${field}：不在已知的键里，判不出（commitlint、prettier、lint-staged 这类工具先读 package.json 里的同名键，读到了就不看已登记的配置文件）`,
      );
    }
  } else {
    for (const field of TOOL_CONFIG_FIELDS) {
      if (stable(base[field]) === stable(head[field])) continue;
      loosen.push(`动了 ${field} 键：工具先读 package.json 里的它，会遮蔽已登记的配置文件`);
    }
    const [before, after] = [record(base.scripts), record(head.scripts)];
    for (const name of GUARDED_SCRIPTS) {
      if (!(name in before) || before[name] === after[name]) continue;
      const [from, to] = [String(before[name]), String(after[name] ?? "")];
      const squeeze = (text) => text.replace(/\s+/g, " ").trim();
      if (!(name in after)) loosen.push(`删掉了检查脚本 ${name}`);
      else if (NOOP_SCRIPT.test(to)) loosen.push(`检查脚本 ${name} 改成了空转：${excerpt(to)}`);
      else if (NOOP_SCRIPT.test(from)) touch.push(`检查脚本 ${name} 由占位换成真实命令`);
      else if (
        from.includes("--passWithNoTests") &&
        squeeze(from.replace(/--passWithNoTests\b/g, "")) === squeeze(to)
      )
        touch.push(`检查脚本 ${name} 去掉了 --passWithNoTests`);
      else loosen.push(`改了已有的检查脚本 ${name}，判不出是不是放松：${excerpt(to)}`);
    }
  }
  return { touch, loosen };
}

const LOCK_KEY = /^ {2}(?:'([^']+)'|"([^"]+)"|([^\s'":][^:]*)):/;
const unquote = (text) => text.trim().replace(/^(['"])(.*)\1$/, "$2");
/** 去掉版本后面括号里的 peer 解析：4.1.11(@types/node@24.19.0) → 4.1.11。加一个依赖就会让它变，不比 */
const withoutPeers = (text) => text.replace(/\(.*$/, "");

/** 锁文件里一段的条目：两格缩进的键 → 它下面的行（保留缩进，去掉空行） */
function lockSection(text, section) {
  const entries = new Map();
  let inside = false;
  let current = null;
  for (const line of (text ?? "").split("\n")) {
    if (/^\S/.test(line)) {
      inside = line.trimEnd() === `${section}:`;
      current = null;
    } else if (inside && !isBlank(line)) {
      const match = line.match(LOCK_KEY);
      if (match) {
        current = match[1] ?? match[2] ?? match[3];
        if (!entries.has(current)) entries.set(current, []);
      } else if (current !== null) entries.get(current).push(line);
    }
  }
  return entries;
}

/** importers 段的一个条目：“字段 依赖名” → “specifier 与解析版本”（解析版本不带 peer 解析） */
function importerDeps(lines) {
  const deps = new Map();
  let field = null;
  let name = null;
  for (const line of lines) {
    const indent = indentOf(line);
    const text = line.trim();
    if (indent === 4) [field, name] = [text.replace(/:.*$/, ""), null];
    else if (indent === 6) {
      name = `${field} ${unquote(text.replace(/:\s*$/, ""))}`;
      deps.set(name, { specifier: "", version: "" });
    } else if (indent === 8 && name !== null) {
      const match = text.match(/^(specifier|version):\s*(.*)$/);
      if (match) deps.get(name)[match[1]] = withoutPeers(unquote(match[2]));
    }
  }
  return new Map(
    [...deps].map(([key, dep]) => [key, `specifier ${dep.specifier}、解析到 ${dep.version}`]),
  );
}

/** snapshots 段的一个条目：“字段 依赖名” → 版本（不带 peer 解析）。transitivePeerDependencies、optional 不比 */
function snapshotDeps(lines) {
  const deps = new Map();
  let field = null;
  for (const line of lines) {
    const indent = indentOf(line);
    const text = line.trim();
    if (indent === 4) field = /:\s*$/.test(text) ? text.replace(/:\s*$/, "") : null;
    else if (indent === 6 && field !== null && !text.startsWith("- ")) {
      const match = text.match(/^(?:'([^']+)'|"([^"]+)"|([^\s:]+)):\s*(.+)$/);
      if (match) {
        deps.set(`${field} ${match[1] ?? match[2] ?? match[3]}`, withoutPeers(unquote(match[4])));
      }
    }
  }
  return deps;
}

/** packages 段的一个条目声明的 peer 依赖名（peerDependencies 下面的键） */
function declaredPeers(lines) {
  const peers = new Set();
  let inside = false;
  for (const line of lines) {
    const indent = indentOf(line);
    if (indent === 4) inside = line.trim() === "peerDependencies:";
    else if (indent === 6 && inside) {
      const match = line.trim().match(/^(?:'([^']+)'|"([^"]+)"|([^\s:]+)):/);
      if (match) peers.add(match[1] ?? match[2] ?? match[3]);
    }
  }
  return peers;
}

/** snapshots 的条目按“名字@版本”并在一起（同一个名字可以有几份，peer 解析不同）：“字段 依赖名” → 出现过的版本 */
function snapshotsByName(snapshots) {
  const merged = new Map();
  for (const [key, deps] of snapshots) {
    const name = withoutPeers(key);
    if (!merged.has(name)) merged.set(name, new Map());
    const union = merged.get(name);
    for (const [dep, version] of deps) {
      if (!union.has(dep)) union.set(dep, new Set());
      union.get(dep).add(version);
    }
  }
  return merged;
}

function lockParts(text) {
  const header = (text ?? "").split(/^importers:\s*$/m)[0];
  const packageLines = [...lockSection(text, "packages")];
  /** packages 段的条目：名字@版本 → 条目的内容（来源、校验值等，去掉空行与缩进） */
  const entries = new Map(
    packageLines.map(([key, lines]) => [key, lines.map((line) => `${line.trim()}\n`).join("")]),
  );
  /** packages 段的条目：名字@版本 → 它声明的 peer 依赖名 */
  const peers = new Map(packageLines.map(([key, lines]) => [key, declaredPeers(lines)]));
  const importers = new Map(
    [...lockSection(text, "importers")].map(([key, lines]) => [key, importerDeps(lines)]),
  );
  /** snapshots 段的条目：完整的键（带 peer 解析）→ “字段 依赖名” → 版本 */
  const snapshots = new Map(
    [...lockSection(text, "snapshots")].map(([key, lines]) => [key, snapshotDeps(lines)]),
  );
  return { header, entries, peers, importers, snapshots };
}

const some = (items) => `${items.slice(0, 5).join("、")}${items.length > 5 ? " 等" : ""}`;

function byLockfile({ baseText, headText }) {
  const touch = [];
  const loosen = [];
  const [base, head] = [lockParts(baseText), lockParts(headText)];
  if (baseText !== null && base.header !== head.header)
    loosen.push("锁文件头部（版本、设置、覆盖项）有变");
  const removed = [...base.entries.keys()].filter((entry) => !head.entries.has(entry));
  const added = [...head.entries.keys()].filter((entry) => !base.entries.has(entry));
  const changed = [...head.entries.keys()].filter(
    (entry) => base.entries.has(entry) && base.entries.get(entry) !== head.entries.get(entry),
  );
  if (changed.length > 0) {
    loosen.push(
      `锁文件里有 ${changed.length} 个已有条目的内容有变（来源、校验值等）：${some(changed)}`,
    );
  }
  if (removed.length > 0) {
    loosen.push(`锁文件里有 ${removed.length} 个版本被移除或替换：${some(removed)}`);
  }
  if (added.length > 0) touch.push(`锁文件新增 ${added.length} 个版本：${some(added)}`);

  // importers 段：各工作区包的直接依赖实际装哪个版本。已有的依赖 specifier、解析版本有变，或被删，算放松
  const direct = [];
  for (const [importer, before] of base.importers) {
    const after = head.importers.get(importer);
    if (after === undefined) {
      direct.push(`${importer} 整个条目被删`);
      continue;
    }
    for (const [dep, was] of before) {
      const name = dep.replace(/^\S+ /, "");
      if (!after.has(dep)) direct.push(`${importer} 的 ${name} 被删`);
      else if (after.get(dep) !== was)
        direct.push(`${importer} 的 ${name} 由“${was}”改成“${after.get(dep)}”`);
    }
  }
  if (direct.length > 0) {
    loosen.push(`锁文件 importers 段里有 ${direct.length} 处已有的依赖有变：${some(direct)}`);
  }

  // snapshots 段：传递依赖实际装哪个版本。已有条目的依赖版本有变或被删，算放松；条目被删由 packages 段判
  const transitive = [];
  const depName = (dep) => dep.replace(/^\S+ /, "");
  const [baseByName, headByName] = [
    snapshotsByName(base.snapshots),
    snapshotsByName(head.snapshots),
  ];
  for (const [key, before] of base.snapshots) {
    const after = head.snapshots.get(key);
    if (after !== undefined) {
      // 键还在：按完整的键逐个比。不与同名的别的条目并在一起，否则另加一份留着旧版本的同名条目就能盖住这里的改动
      for (const [dep, was] of before) {
        if (!after.has(dep)) transitive.push(`${key} 的 ${depName(dep)} 被删`);
        else if (after.get(dep) !== was)
          transitive.push(`${key} 的 ${depName(dep)} 由 ${was} 改成 ${after.get(dep)}`);
      }
      continue;
    }
    // 键本身变了（加一个依赖会让括号里的 peer 解析变）：退回与同名的几份并在一起比
    const name = withoutPeers(key);
    const union = headByName.get(name);
    if (union === undefined) continue;
    for (const [dep, was] of before) {
      const now = union.get(dep);
      if (now === undefined) transitive.push(`${name} 的 ${depName(dep)} 被删`);
      else if (!now.has(was))
        transitive.push(`${name} 的 ${depName(dep)} 由 ${was} 改成 ${[...now].join("、")}`);
    }
  }
  // 新出现的键、名字在基线上已有（多出一份 peer 解析不同的条目）：importers 与别的条目可以改指到它，
  // 所以它的依赖版本要与基线上同名条目的一致。这个包自己声明的 peer 依赖除外：peer 解析不同，版本本来就可以不同
  for (const [key, after] of head.snapshots) {
    const name = withoutPeers(key);
    const union = baseByName.get(name);
    if (base.snapshots.has(key) || union === undefined) continue;
    const peers = base.peers.get(name) ?? new Set();
    for (const [dep, version] of after) {
      const known = union.get(dep);
      if (known === undefined || known.has(version) || peers.has(depName(dep))) continue;
      transitive.push(
        `新出现的同名条目 ${key} 的 ${depName(dep)} 是 ${version}，基线上是 ${[...known].join("、")}`,
      );
    }
  }
  if (transitive.length > 0) {
    loosen.push(
      `锁文件 snapshots 段里有 ${transitive.length} 处已有条目的依赖有变：${some(transitive)}`,
    );
  }
  return { touch, loosen };
}

/**
 * tsconfig 允许注释与行尾逗号：去掉之后按 JSON 解析。解析不了即抛错。
 * 分两遍扫，字符串里的内容原样保留：第一遍去注释，第二遍去掉后面紧跟 } 或 ] 的逗号。
 */
function parseJsonc(text) {
  const scan = (source, skip) => {
    let out = "";
    for (let index = 0; index < source.length;) {
      if (source[index] === '"') {
        let end = index + 1;
        while (end < source.length && source[end] !== '"') end += source[end] === "\\" ? 2 : 1;
        out += source.slice(index, end + 1);
        index = end + 1;
      } else {
        const skipped = skip(source, index);
        if (skipped === 0) out += source[index];
        index += skipped || 1;
      }
    }
    return out;
  };
  const comment = (source, index) => {
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      return (end === -1 ? source.length : end) - index;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      return (end === -1 ? source.length : end + 2) - index;
    }
    return 0;
  };
  const trailingComma = (source, index) =>
    source[index] === "," && /^\s*[}\]]/.test(source.slice(index + 1)) ? 1 : 0;
  return JSON.parse(scan(scan(text, comment), trailingComma));
}

/** 一个取值算不算“严”：true 严，false 松，null 不是已知的严格性开关 */
function strictness(key, value) {
  if (typeof value !== "boolean") return null;
  if (TS_STRICT_WHEN_TRUE.has(key)) return value;
  if (TS_STRICT_WHEN_FALSE.has(key)) return !value;
  return null;
}

/**
 * tsconfig：按解析后的键值判，换行、重排、注释不算改动。
 * 新增键算只增，四种除外：把已知的严格性开关设成松的一边；顶层新增 exclude、include、files、extends；
 * 往 exclude 里加项；键或值命中豁免关键字。删、改已有的键值算放松，唯一的例外是把严格性开关由松改严。
 */
function byTsconfig({ baseText, headText }) {
  const touch = [];
  const loosen = [];
  const parse = (text, label) => {
    try {
      const value = parseJsonc(text);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // 落到下面
    }
    loosen.push(`${label}解析不了，判不出`);
    return null;
  };
  const base = parse(baseText, "基线上的文件");
  const head = parse(headText, "改后的文件");
  if (!base || !head) return { touch, loosen };
  const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const show = (value) => excerpt(JSON.stringify(value));

  const added = (where, key, value, parent) => {
    if (isRecord(value)) walk({}, value, where);
    else if (parent === "compilerOptions" && strictness(key, value) === false)
      loosen.push(`关掉了严格性开关：新增 ${where}: ${show(value)}`);
    else if (parent === "" && TS_SCOPE_FIELDS.includes(key))
      loosen.push(
        `新增了 ${key}：${show(value)}（会改变查哪些文件、继承哪份预设，判不出是不是只增）`,
      );
    else if (EXEMPTION.test(`"${key}": ${JSON.stringify(value)}`))
      loosen.push(`新增的键像是忽略、豁免或白名单：${where}: ${show(value)}`);
    else touch.push(`新增 ${where}: ${show(value)}`);
  };
  const lists = (was, now, where) => {
    if (where === "extends") {
      if (stable(was) !== stable(now)) loosen.push(`改了 extends：${show(was)} → ${show(now)}`);
      return;
    }
    const [before, after] = [new Set(was.map(stable)), new Set(now.map(stable))];
    for (const item of before)
      if (!after.has(item)) loosen.push(`${where} 里删掉了 ${excerpt(item)}`);
    for (const item of after) {
      if (before.has(item)) continue;
      if (where === "exclude") loosen.push(`exclude 里加了 ${excerpt(item)}：被检查的文件变少`);
      else if (EXEMPTION.test(item))
        loosen.push(`加的项像是忽略、豁免或白名单：${where} 里的 ${excerpt(item)}`);
      else touch.push(`${where} 里新增 ${excerpt(item)}`);
    }
  };
  function walk(before, after, path) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const where = path === "" ? key : `${path}.${key}`;
      const [was, now] = [before[key], after[key]];
      if (!(key in after)) loosen.push(`删掉了 ${where}（原来是 ${show(was)}）`);
      else if (!(key in before)) added(where, key, now, path);
      else if (isRecord(was) && isRecord(now)) walk(was, now, where);
      else if (Array.isArray(was) && Array.isArray(now)) lists(was, now, where);
      else if (stable(was) === stable(now)) continue;
      else if (
        path === "compilerOptions" &&
        strictness(key, was) === false &&
        strictness(key, now) === true
      )
        touch.push(`收紧了严格性开关 ${where}：${show(was)} → ${show(now)}`);
      else if (path === "compilerOptions" && strictness(key, now) === false)
        loosen.push(`关掉了严格性开关 ${where}：${show(was)} → ${show(now)}`);
      else loosen.push(`改了 ${where}：${show(was)} → ${show(now)}`);
    }
  }
  walk(base, head, "");
  return { touch, loosen };
}

function byLayers({ baseText, headText }) {
  const touch = [];
  const loosen = [];
  const base = parseJson(baseText, "基线上的文件", loosen);
  const head = parseJson(headText, "改后的文件", loosen);
  if (!base || !head) return { touch, loosen };
  const [before, after] = [record(base.modules), record(head.modules)];
  for (const [name, layer] of Object.entries(after)) {
    if (!(name in before)) touch.push(`新增模块登记 ${name} → ${layer}`);
    else if (before[name] !== layer)
      loosen.push(`改了已登记模块 ${name} 的层：${before[name]} → ${layer}`);
  }
  for (const name of Object.keys(before)) {
    if (!(name in after)) loosen.push(`删掉了模块登记 ${name}`);
  }
  const labels = {
    sameLayer: "同层策略或白名单",
    layers: "层的清单",
    nonModuleDirs: "非模块目录的放行名单",
    servicesDir: "模块目录",
  };
  for (const [field, label] of Object.entries(labels)) {
    if (stable(base[field]) !== stable(head[field])) loosen.push(`改了${label}（${field}）`);
  }
  return { touch, loosen };
}

function byRegistry({ baseText, headText }) {
  const touch = [];
  const loosen = [];
  const base = parseJson(baseText, "基线上的文件", loosen);
  const head = parseJson(headText, "改后的文件", loosen);
  if (!base || !head) return { touch, loosen };
  const index = (doc) =>
    new Map((Array.isArray(doc.files) ? doc.files : []).map((e) => [e.pattern, e]));
  const [before, after] = [index(base), index(head)];
  if (baseText === null) return { touch: [`新增门禁文件清单，共 ${after.size} 条`], loosen };
  for (const [pattern, entry] of after) {
    if (!before.has(pattern)) touch.push(`新增门禁文件条目 \`${pattern}\`（${entry.kind}）`);
    else if (stable(before.get(pattern)) !== stable(entry))
      loosen.push(`改了已有的门禁文件条目 \`${pattern}\``);
  }
  for (const pattern of before.keys()) {
    if (!after.has(pattern)) loosen.push(`删掉了门禁文件条目 \`${pattern}\``);
  }
  return { touch, loosen };
}

/**
 * frozen：一动就算放松，新建也算。唯一的例外：这个路径的条目是本次差异里新登记的
 *（门禁与它的放行文件在同一个 PR 里一起建立），这时新建算只增，由业主在清单里看到。
 * 只看差异：分支的共同祖先上没有清单、分支自己也没加这一条的，不算同建；
 * 要合并进去的分支上已经登记了这一条的（落后的分支把那份清单拷进来），也不算。
 */
function byFrozen(change, entry) {
  const note = entry.note ?? "放行或设置文件";
  if (change.status !== "A") return { touch: [], loosen: [`改了${note}`] };
  if (!change.registeredInThisDiff(entry.pattern)) return { touch: [], loosen: [`新建了${note}`] };
  return { touch: [`新建了${note}（它的门禁条目也是这次新增的）`], loosen: [] };
}

/** new-file：只许新增文件。改已有的文件判不出是不是放松（加一行就能让检查空转），一律按放松算 */
function byNewFile(change, entry) {
  if (change.status === "A") return { touch: ["新增文件"], loosen: [] };
  const note = entry.note ?? "门禁文件";
  return { touch: [], loosen: [`改了已有的${note}：这类文件只许新增，改已有的判不出是不是放松`] };
}

const KINDS = {
  append: (change) =>
    change.status === "A"
      ? { touch: ["新增文件"], loosen: [] }
      : byLines(change, { blocks: false }),
  "new-file": byNewFile,
  workflow: (change) =>
    change.status === "A"
      ? { touch: ["新增工作流文件"], loosen: [] }
      : byLines(change, { blocks: true }),
  frozen: byFrozen,
  tsconfig: (change) =>
    change.status === "A" ? { touch: ["新增文件"], loosen: [] } : byTsconfig(change),
  manifest: (change) => byManifest(change, { root: false }),
  "root-manifest": (change) => byManifest(change, { root: true }),
  lockfile: byLockfile,
  layers: byLayers,
  registry: byRegistry,
};

// ---------- 主流程 ----------

const options = parseArgs(process.argv.slice(2));
const gateFilesPath =
  options.gateFiles ?? join(dirname(fileURLToPath(import.meta.url)), "gate-files.json");

let entries;
try {
  entries = JSON.parse(readFileSync(gateFilesPath, "utf8")).files;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("没有 files 条目");
} catch (error) {
  fail(`读不了门禁文件清单 ${gateFilesPath}。${error.message}`);
}
for (const entry of entries) {
  if (typeof entry.pattern !== "string" || !(entry.kind in KINDS)) {
    fail(`门禁文件清单里有不认识的条目：${JSON.stringify(entry)}`);
  }
  entry.match = globToRegExp(entry.pattern);
  entry.exceptMatch = (entry.except ?? []).map(globToRegExp);
}

const mergeBase = (
  git(["merge-base", options.base, options.head], { allowFail: true }) ?? ""
).trim();
if (!mergeBase) fail(`找不到 ${options.base} 与 ${options.head} 的共同祖先（检出时要带完整历史）`);
const headSha = git(["rev-parse", options.head]).trim();

const nameStatus = git(["diff", "--no-renames", "--name-status", "-z", mergeBase, headSha])
  .split("\0")
  .filter(Boolean);
const touch = [];
const loosen = [];
const outside = [];
let changedFiles = 0;

// 本次差异里新登记的条目：头上的清单里有，共同祖先上的清单里没有，--base 那一头（要合并进去的分支）的清单里
// 也没有。判 frozen 文件的“新建”时要用（见 byFrozen）。最后一条防的是落后的分支：目标分支上已经登记了，
// 分支把那份清单原样拷进来（合并时不冲突），再新建放行文件，不算同建。
// 哪一头的清单解析不了，就当作这次没有新登记任何条目（判不出按放松算）
function registeredAt(revision) {
  const text = git(["show", `${revision}:${REGISTRY_PATH}`], { allowFail: true });
  if (text === null) return new Set();
  try {
    const files = JSON.parse(text).files;
    return new Set((Array.isArray(files) ? files : []).map((entry) => entry?.pattern));
  } catch {
    return null;
  }
}
const [patternsAtBase, patternsAtTarget, patternsAtHead] = [
  registeredAt(mergeBase),
  registeredAt(options.base),
  registeredAt(headSha),
];
const registeredInThisDiff = (pattern) =>
  patternsAtBase !== null &&
  patternsAtTarget !== null &&
  patternsAtHead !== null &&
  patternsAtHead.has(pattern) &&
  !patternsAtBase.has(pattern) &&
  !patternsAtTarget.has(pattern);

for (let index = 0; index + 1 < nameStatus.length; index += 2) {
  const status = nameStatus[index];
  const path = nameStatus[index + 1];
  changedFiles += 1;
  const matched = entries.filter((entry) => entry.match.test(path));
  if (matched.length === 0) {
    outside.push(path);
    continue;
  }
  const applicable = matched.filter(
    (entry) => !entry.exceptMatch.some((regex) => regex.test(path)),
  );
  if (applicable.length === 0) continue;
  if (status === "D") {
    loosen.push({ file: path, what: "删除了门禁文件" });
    continue;
  }
  const change = {
    status,
    baseText: status === "A" ? null : git(["show", `${mergeBase}:${path}`]),
    headText: git(["show", `${headSha}:${path}`]),
    hunks: status === "A" ? [] : hunksOf(mergeBase, headSha, path),
    registeredInThisDiff,
  };
  for (const entry of applicable) {
    const verdict = KINDS[entry.kind](change, entry);
    for (const what of verdict.touch) touch.push({ file: path, what });
    for (const what of verdict.loosen) loosen.push({ file: path, what });
  }
}

const verdict = loosen.length > 0 ? "loosen" : touch.length > 0 ? "touch" : "none";

function listOf(title, items, limit) {
  if (items.length === 0) return [];
  const lines = ["", `${title} ${items.length} 项：`, ""];
  for (const item of items.slice(0, limit)) lines.push(`- \`${item.file}\`：${item.what}`);
  if (items.length > limit) lines.push(`- …另有 ${items.length - limit} 项，见 CI 日志`);
  return lines;
}
const verdictText = {
  none: "没有门禁改动",
  touch: `只增（\`${TOUCH_LABEL}\`）`,
  loosen: `含放松类改动，只能在单独的 \`${CHANGE_LABEL}\` PR 里做`,
}[verdict];
/** 清单的 Markdown：PR 描述里每类最多列 limit 项，日志里全列 */
const render = (limit) =>
  [
    `**门禁改动清单**（CI 自动写入，不要手改。基线 \`${mergeBase.slice(0, 7)}\`，本次 \`${headSha.slice(0, 7)}\`）`,
    "",
    `判定：${verdictText}`,
    ...listOf("放松", loosen, limit),
    ...listOf("只增", touch, limit),
  ].join("\n");
const markdown = render(MAX_ITEMS);

console.log(render(Infinity));
if (options.out) {
  writeFileSync(
    options.out,
    `${JSON.stringify({ base: mergeBase, head: headSha, verdict, changedFiles, touch, loosen, outside }, null, 2)}\n`,
  );
}

// ---------- PR：读标签，写描述，打标签 ----------

const errors = [];
let labels = options.labels;

/** 调 GitHub 的 REST 接口（gh api）。失败时：allowFail 返回 { error }，否则按环境错误退出 */
function api(args, { allowFail = false } = {}) {
  try {
    const stdout = execFileSync("gh", ["api", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout };
  } catch (error) {
    const text = String(error.stderr || error.message).trim();
    if (allowFail) return { error: text };
    return fail(`gh api ${args.find((arg) => arg.startsWith("repos/"))} 失败。${text}`);
  }
}

if (options.pr !== null) {
  const prPath = `repos/${options.repo}/pulls/${options.pr}`;
  const labelsPath = `repos/${options.repo}/issues/${options.pr}/labels`;
  const pr = JSON.parse(api([prPath]).stdout);
  labels = (pr.labels ?? []).map((label) => label.name);

  const body = pr.body ?? "";
  const block = `${START}\n${markdown}\n${END}`;
  const [start, end] = [body.indexOf(START), body.indexOf(END)];
  const nextBody =
    start !== -1 && end > start
      ? `${body.slice(0, start)}${block}${body.slice(end + END.length)}`
      : `${block}\n\n${body}`;
  if (nextBody !== body) {
    const dir = mkdtempSync(join(tmpdir(), "lyx-gate-"));
    try {
      writeFileSync(join(dir, "body.md"), nextBody);
      api(["--method", "PATCH", prPath, "--field", `body=@${join(dir, "body.md")}`, "--silent"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  if (touch.length > 0 && !labels.includes(TOUCH_LABEL)) {
    // 往 PR 上加一个不存在的标签，接口会顺手把它建出来；所以先查，没有就报错，不自己建
    const known = api([`repos/${options.repo}/labels/${TOUCH_LABEL}`, "--silent"], {
      allowFail: true,
    });
    if (known.error === undefined) {
      api(["--method", "POST", labelsPath, "--raw-field", `labels[]=${TOUCH_LABEL}`, "--silent"]);
    } else if (/404/.test(known.error)) {
      errors.push(
        `仓库里没有 ${TOUCH_LABEL} 标签。请业主先建（docs/plan/owner-checklist.md 第 4 节第 1 项：gh label create ${TOUCH_LABEL}）；CI 不自己建`,
      );
    } else fail(`查不了 ${TOUCH_LABEL} 标签在不在。${known.error}`);
  } else if (touch.length === 0 && labels.includes(TOUCH_LABEL)) {
    api(["--method", "DELETE", `${labelsPath}/${TOUCH_LABEL}`, "--silent"]);
  }
}

// ---------- 结论 ----------

const hasChangeLabel = labels.includes(CHANGE_LABEL);
if (loosen.length > 0 && !hasChangeLabel) {
  errors.push(
    `有 ${loosen.length} 项放松类门禁改动，而 PR 没有 ${CHANGE_LABEL} 标签。放松类只能在单独的 PR 里改并标 ${CHANGE_LABEL}（计划 第 5.3 节）`,
  );
}
if (hasChangeLabel && outside.length > 0) {
  errors.push(
    `带 ${CHANGE_LABEL} 的 PR 只能改门禁文件，这里还改了 ${outside.length} 个别的路径：${outside.slice(0, 5).join("、")}${outside.length > 5 ? " 等" : ""}`,
  );
}

if (errors.length > 0) {
  console.error("\n门禁改动分类未通过：");
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(
  `\n门禁改动分类通过：共改 ${changedFiles} 个文件，只增 ${touch.length} 项，放松 ${loosen.length} 项。`,
);
