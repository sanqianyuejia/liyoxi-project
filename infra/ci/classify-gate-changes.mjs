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
//   append         新增文件、加行算只增；删改已有行算放松；加的行像忽略、豁免、白名单也算放松
//   workflow       同上，且加的每一段必须是整个步骤（“- ” 开头）或整个任务，否则算放松
//   frozen         一动就算放松，新建也算（它的条目在基线的清单里还没登记时，新建算只增）
//   manifest       依赖只许新增；版本有变、删除算放松（升级要单独成 PR）
//   root-manifest  同 manifest；脚本只许新增；engines、packageManager、pnpm 一动就算放松
//   lockfile       packages 段只许新增条目；头部设置有变算放松
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
/** 清单在仓库里的位置：只用来看基线上登记过哪些条目 */
const REGISTRY_PATH = "infra/ci/gate-files.json";
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const ROOT_FROZEN_FIELDS = ["engines", "packageManager", "pnpm"];
const EXEMPTION =
  /eslint-disable|ts-ignore|ts-expect-error|ts-nocheck|ignore|exclude|pathNot|allow|skip|\.only\b|continue-on-error|豁免|白名单|放行/i;
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
        loosen.push(`加的行像是忽略、豁免或白名单：${excerpt(line)}`);
      }
    }
    if (blocks && hunk.removed.every(isBlank)) {
      const first = added.find((l) => !l.trim().startsWith("#"));
      if (first === undefined) addedLines += added.length;
      else if (/^\s*- /.test(first) || /^ {2}[\w-]+:\s*(?:#.*)?$/.test(first)) {
        touch.push(`新增步骤或任务：${excerpt(first)}`);
      } else loosen.push(`往已有的步骤或任务里加了行，判不出是不是只增：${excerpt(first)}`);
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
  const compare = (field, added, changed) => {
    const [before, after] = [record(base[field]), record(head[field])];
    for (const [name, value] of Object.entries(after)) {
      if (!(name in before)) touch.push(added(name, value));
      else if (before[name] !== value) loosen.push(changed(name, before[name], value));
    }
    for (const name of Object.keys(before)) {
      if (!(name in after)) loosen.push(`${field} 里删掉了 ${name}`);
    }
  };
  for (const field of DEP_FIELDS) {
    compare(
      field,
      (name, value) => `新增依赖 ${name}@${value}（${field}）`,
      (name, from, to) => `依赖版本有变 ${name}：${from} → ${to}（升级要单独成 PR）`,
    );
  }
  if (root) {
    compare(
      "scripts",
      (name) => `新增根脚本 ${name}`,
      (name) => `改了已有的根脚本 ${name}`,
    );
    for (const field of ROOT_FROZEN_FIELDS) {
      if (stable(base[field]) !== stable(head[field])) loosen.push(`改了 ${field}`);
    }
  }
  return { touch, loosen };
}

function lockParts(text) {
  const header = (text ?? "").split(/^importers:\s*$/m)[0];
  const entries = new Set();
  let inPackages = false;
  for (const line of (text ?? "").split("\n")) {
    if (/^\S/.test(line)) inPackages = line.trimEnd() === "packages:";
    else if (inPackages) {
      const match = line.match(/^ {2}(?:'([^']+)'|"([^"]+)"|([^\s'":][^:]*)):\s*$/);
      if (match) entries.add(match[1] ?? match[2] ?? match[3]);
    }
  }
  return { header, entries };
}

function byLockfile({ baseText, headText }) {
  const touch = [];
  const loosen = [];
  const [base, head] = [lockParts(baseText), lockParts(headText)];
  if (baseText !== null && base.header !== head.header)
    loosen.push("锁文件头部（版本、设置、覆盖项）有变");
  const removed = [...base.entries].filter((entry) => !head.entries.has(entry));
  const added = [...head.entries].filter((entry) => !base.entries.has(entry));
  if (removed.length > 0) {
    loosen.push(
      `锁文件里有 ${removed.length} 个版本被移除或替换：${removed.slice(0, 5).join("、")}${removed.length > 5 ? " 等" : ""}`,
    );
  }
  if (added.length > 0) {
    touch.push(
      `锁文件新增 ${added.length} 个版本：${added.slice(0, 5).join("、")}${added.length > 5 ? " 等" : ""}`,
    );
  }
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
 * frozen：一动就算放松，新建也算。唯一的例外：这个路径在基线的清单里还没有登记
 *（门禁与它的放行文件在同一个 PR 里一起建立），这时新建算只增，由业主在清单里看到。
 */
function byFrozen(change, entry) {
  const note = entry.note ?? "放行或设置文件";
  if (change.status !== "A") return { touch: [], loosen: [`改了${note}`] };
  if (change.registeredAtBase(entry.pattern)) return { touch: [], loosen: [`新建了${note}`] };
  return { touch: [`新建了${note}（它的门禁条目也是这次新增的）`], loosen: [] };
}

const KINDS = {
  append: (change) =>
    change.status === "A"
      ? { touch: ["新增文件"], loosen: [] }
      : byLines(change, { blocks: false }),
  workflow: (change) =>
    change.status === "A"
      ? { touch: ["新增工作流文件"], loosen: [] }
      : byLines(change, { blocks: true }),
  frozen: byFrozen,
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

// 基线上已经登记的条目：判 frozen 文件的“新建”时要用（见 byFrozen）
const basePatterns = new Set();
try {
  const text = git(["show", `${mergeBase}:${REGISTRY_PATH}`], { allowFail: true });
  for (const entry of JSON.parse(text ?? "{}").files ?? []) basePatterns.add(entry.pattern);
} catch {
  // 基线上的清单解析不了：当作一条都没登记
}

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
    registeredAtBase: (pattern) => basePatterns.has(pattern),
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
