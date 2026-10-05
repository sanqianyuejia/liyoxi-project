#!/usr/bin/env node
// 文案约束扫描（规范 第 11 节；开发计划 第 5.5、10.1 节；CLAUDE.md 硬性规则 24；W1-05 任务书）。
//
// 用法：node infra/ci/check-copy.mjs [--root <目录>] [--rules <文件>]   根脚本是 pnpm lint:copy
//   --root   到哪个目录下找源码与契约；不给时是当前目录（仓库根）
//   --rules  规则表；不给时是本脚本旁边的 copy-rules.json
// 规则表怎么写、页面包怎么加规则，见 copy-rules.json 开头的“说明”。
// 口径：
//   1. 一条规则 = 一个不许出现的词 + 它管的范围。范围两种：paths（源码的目录或文件）、errors（契约里的错误码）。
//   2. 源码：paths 下的 .ts、.tsx、.js、.jsx，用例文件（*.test.*、*.spec.*）除外。用 TypeScript 的解析器取出
//      字符串字面量、模板字符串、JSX 文本，在里面找词；注释与标识符不扫。
//      paths 里的目录盖住小程序页面清单（apps/weapp/src/pages.ts）的哪几条路由，就另扫那几条的页面标题。
//      还没建的路径可以先登记，但它得对得上页面清单里的一条路由，对不上按写错了算（免得登记了一个永远扫不到的路径）。
//   3. 契约：errors 里每个错误码的定义（packages/contract/src/errors 下同名的属性）里的字符串，即默认文案。
//      登记的码找不到按失败算，不当成通过。
//   4. 例外：命中的词整个落在这条规则登记的某个说法里（“添加企业微信”里的“微信”）不算。
// 退出码：0 通过；1 有命中，或登记的错误码找不到；2 用法、规则表或环境错误。
// 本脚本只用根上装的 typescript（同 check-type-hoist.mjs），不引别的依赖。已知查不到的：
//   拼出来的词（"微" + "信"）；JSX 文本里写成实体的字；服务端下发的文案（引导数据的 copy）；样式文件里的 content；
//   不在 paths 里的文件（登录页从别的目录引来的组件：把它的路径登记进规则）；用例文件里写的文案。

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_FILE = /\.[jt]sx?$/;
const TEST_FILE = /\.(?:test|spec)\.[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"]);
const ERRORS_DIR = "packages/contract/src/errors";
const WEAPP_SRC = "apps/weapp/src/";
const WEAPP_PAGES_FILE = `${WEAPP_SRC}pages.ts`;
const TOP_KEYS = ["说明", "rules", "phrases"];
const RULE_KEYS = ["id", "word", "paths", "errors", "source"];
const PHRASE_KEYS = ["rule", "allow"];

function fail(message) {
  console.error(`文案约束检查：${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    rules: join(dirname(fileURLToPath(import.meta.url)), "copy-rules.json"),
  };
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    if (argv[i] === "--root" && value) options.root = resolve(value);
    else if (argv[i] === "--rules" && value) options.rules = resolve(value);
    else fail(`不认识的参数 ${argv[i]}。用法见本脚本开头的注释`);
  }
  return options;
}

const isText = (value) => typeof value === "string" && value.trim() !== "";
const isTextList = (value) => Array.isArray(value) && value.every(isText);
const extraKeys = (object, known) => Object.keys(object).filter((key) => !known.includes(key));

/** 读规则表并从严核对：多一个不认识的键、少一项、写法不对都报错退出，不带病跑 */
function readRules(file) {
  if (!existsSync(file)) fail(`找不到规则表 ${file}`);
  let table;
  try {
    table = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`规则表 ${file} 解析不了：${error.message}`);
  }
  const bad = (message) => fail(`规则表 ${file} 写错：${message}`);
  if (table === null || typeof table !== "object" || Array.isArray(table)) bad("最外层要是对象");
  if (extraKeys(table, TOP_KEYS).length > 0) bad(`不认识的键 ${extraKeys(table, TOP_KEYS)}`);
  if (!Array.isArray(table.rules) || table.rules.length === 0) bad("rules 要是非空数组");
  if (!Array.isArray(table.phrases)) bad("phrases 要是数组（没有就写空数组）");

  const rules = new Map();
  for (const rule of table.rules) {
    if (rule === null || typeof rule !== "object") bad("rules 的每一项要是对象");
    const label = `规则 ${JSON.stringify(rule.id)}`;
    if (extraKeys(rule, RULE_KEYS).length > 0)
      bad(`${label} 有不认识的键 ${extraKeys(rule, RULE_KEYS)}`);
    if (!isText(rule.id) || !isText(rule.word) || !isText(rule.source)) {
      bad(`${label} 的 id、word、source 都要写`);
    }
    if (rules.has(rule.id)) bad(`${label} 重复`);
    const paths = rule.paths ?? [];
    const errors = rule.errors ?? [];
    if (!isTextList(paths) || !isTextList(errors)) bad(`${label} 的 paths、errors 要是字符串数组`);
    if (paths.length + errors.length === 0) bad(`${label} 没有范围：paths、errors 至少写一样`);
    for (const path of paths) {
      if (path.startsWith("/") || path.split("/").includes("..") || path.includes("*")) {
        bad(`${label} 的路径 ${path} 要写成相对仓库根的目录（以 / 结尾）或文件，不带通配符`);
      }
    }
    rules.set(rule.id, { ...rule, paths, errors, phrases: [] });
  }
  for (const phrase of table.phrases) {
    if (phrase === null || typeof phrase !== "object") bad("phrases 的每一项要是对象");
    const label = `说法 ${JSON.stringify(phrase.allow)}`;
    if (
      extraKeys(phrase, PHRASE_KEYS).length > 0 ||
      !isText(phrase.rule) ||
      !isText(phrase.allow)
    ) {
      bad(`${label} 要写且只写 rule、allow 两个键`);
    }
    const rule = rules.get(phrase.rule);
    if (!rule) bad(`${label} 指的规则 ${phrase.rule} 不存在`);
    if (phrase.allow === rule.word || !phrase.allow.includes(rule.word)) {
      bad(`${label} 要含“${rule.word}”，又不能就是它本身（那等于关掉规则 ${rule.id}）`);
    }
    rule.phrases.push(phrase.allow);
  }
  return [...rules.values()];
}

function listFiles(root, dir) {
  return readdirSync(join(root, dir), { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((item) => {
      const path = `${dir}${item.name}`;
      if (item.isDirectory()) return SKIP_DIRS.has(item.name) ? [] : listFiles(root, `${path}/`);
      return SOURCE_FILE.test(item.name) && !TEST_FILE.test(item.name) ? [path] : [];
    });
}

/** 文本里不在登记的说法之内的词：各处在文本里是第几次出现（从 0 数，登记的说法里的那几次也数） */
function hitsIn(text, word, phrases) {
  const covered = [];
  for (const phrase of phrases) {
    for (let at = text.indexOf(phrase); at >= 0; at = text.indexOf(phrase, at + 1)) {
      covered.push([at, at + phrase.length]);
    }
  }
  const hits = [];
  let ordinal = 0;
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) {
    if (!covered.some(([from, to]) => at >= from && at + word.length <= to)) hits.push(ordinal);
    ordinal += 1;
  }
  return hits;
}

/** 一个文件里的文案片段：[{ text, start, end }]，text 是去掉转义后的内容，start、end 是它在原文里的位置 */
function textsOf(ts, file, raw, { only } = {}) {
  const kind = file.endsWith(".ts")
    ? ts.ScriptKind.TS
    : file.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.JSX;
  const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, false, kind);
  const texts = [];
  const visit = (node, owner) => {
    let inside = owner;
    if (only && ts.isPropertyAssignment(node)) {
      const name =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
      if (only.has(name)) inside = name;
    }
    const isCopy =
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddleOrTemplateTail(node) ||
      ts.isJsxText(node);
    if (isCopy && (!only || inside)) {
      // JSX 文本前面的空白就是文本本身，不能当成可以跳过的空白
      const start = ts.isJsxText(node) ? node.pos : node.getStart(source);
      texts.push({ text: node.text, start, end: node.end, owner: inside });
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(source, null);
  return texts;
}

/** 第 ordinal 次出现在原文的哪里；原文里是转义写法、数不到时退回片段开头 */
function locate(raw, { start, end }, word, ordinal) {
  const slice = raw.slice(start, end);
  let at = -word.length;
  for (let n = 0; n <= ordinal; n += 1) {
    at = slice.indexOf(word, at + word.length);
    if (at < 0) return start;
  }
  return start + at;
}

function position(raw, index) {
  const before = raw.slice(0, index).split("\n");
  const line = before.length;
  const excerpt = (raw.split("\n")[line - 1] ?? "").trim().slice(0, 120);
  return { at: `${line}:${(before.at(-1) ?? "").length + 1}`, excerpt };
}

const options = parseArgs(process.argv.slice(2));
if (!existsSync(options.root)) fail(`找不到目录 ${options.root}`);
const { root } = options;
const rules = readRules(options.rules);

let ts;
try {
  ts = (await import("typescript")).default;
} catch (error) {
  fail(`加载不了 typescript：先 pnpm install --frozen-lockfile。${error.message}`);
}

/** 小程序页面清单：规则里有小程序的路径时才读 */
let weappPages = [];
if (rules.some((rule) => rule.paths.some((path) => path.startsWith(WEAPP_SRC)))) {
  const file = join(root, WEAPP_PAGES_FILE);
  if (!existsSync(file)) fail(`找不到小程序页面清单 ${WEAPP_PAGES_FILE}`);
  const { WEAPP_PAGES } = await import(pathToFileURL(file).href);
  if (!Array.isArray(WEAPP_PAGES)) fail(`${WEAPP_PAGES_FILE} 要导出 WEAPP_PAGES`);
  // 路由 pages/login/index 的页面目录是 apps/weapp/src/pages/login/
  weappPages = WEAPP_PAGES.map((page) => ({
    route: page.route,
    title: String(page.title ?? ""),
    dir: `${WEAPP_SRC}${page.route.replace(/[^/]+$/, "")}`,
  }));
}

const violations = [];
const pending = new Set();
const counted = { files: new Set(), titles: new Set(), errors: new Set() };
const sourceCache = new Map();
const readSource = (file) => {
  if (!sourceCache.has(file)) {
    const raw = readFileSync(join(root, file), "utf8");
    sourceCache.set(file, { raw, texts: textsOf(ts, file, raw) });
  }
  return sourceCache.get(file);
};

function report(rule, file, raw, index, where) {
  const { at, excerpt } = position(raw, index);
  violations.push(
    `${file}:${at}: 规则 ${rule.id}：${where}出现“${rule.word}” → ${excerpt}（${rule.source}）`,
  );
}

function scanTexts(rule, file, raw, texts, where) {
  for (const piece of texts) {
    for (const ordinal of hitsIn(piece.text, rule.word, rule.phrases)) {
      report(rule, file, raw, locate(raw, piece, rule.word, ordinal), where(piece));
    }
  }
}

// ---------- 源码与页面标题 ----------
for (const rule of rules) {
  for (const path of rule.paths) {
    const isDir = path.endsWith("/");
    const pages = weappPages.filter((page) => isDir && page.dir.startsWith(path));
    if (!existsSync(join(root, path))) {
      const known = pages.length > 0 || weappPages.some((page) => path.startsWith(page.dir));
      if (!known) {
        fail(
          `规则 ${rule.id} 的路径 ${path} 不存在，也对不上小程序页面清单（${WEAPP_PAGES_FILE}）里的任何一条路由：写错了，或页面改了位置`,
        );
      }
      pending.add(path);
    } else if (statSync(join(root, path)).isDirectory() !== isDir) {
      fail(`规则 ${rule.id} 的路径 ${path}：目录要以 / 结尾，文件不带`);
    } else {
      for (const file of isDir ? listFiles(root, path) : [path]) {
        const { raw, texts } = readSource(file);
        counted.files.add(file);
        scanTexts(rule, file, raw, texts, () => "");
      }
    }
    if (pages.length > 0) {
      const raw = readFileSync(join(root, WEAPP_PAGES_FILE), "utf8");
      for (const page of pages) {
        counted.titles.add(page.route);
        if (hitsIn(page.title, rule.word, rule.phrases).length === 0) continue;
        const index = Math.max(0, raw.indexOf(`"${page.route}"`));
        report(rule, WEAPP_PAGES_FILE, raw, index, `路由 ${page.route} 的页面标题里`);
      }
    }
  }
}

// ---------- 契约里错误码的默认文案 ----------
const wanted = new Set(rules.flatMap((rule) => rule.errors));
const definitions = new Map();
if (wanted.size > 0 && existsSync(join(root, ERRORS_DIR))) {
  for (const file of listFiles(root, `${ERRORS_DIR}/`)) {
    const raw = readFileSync(join(root, file), "utf8");
    for (const piece of textsOf(ts, file, raw, { only: wanted })) {
      if (!definitions.has(piece.owner)) definitions.set(piece.owner, []);
      definitions.get(piece.owner).push({ file, raw, piece });
    }
  }
}
for (const rule of rules) {
  for (const symbol of rule.errors) {
    const found = definitions.get(symbol) ?? [];
    if (found.length === 0) {
      violations.push(
        `${ERRORS_DIR}: 规则 ${rule.id}：登记的错误码 ${symbol} 找不到它的默认文案（改了名、挪了地方，要同步改规则表）`,
      );
    }
    counted.errors.add(symbol);
    for (const { file, raw, piece } of found) {
      scanTexts(rule, file, raw, [piece], () => `错误码 ${symbol} 的默认文案里`);
    }
  }
}

if (violations.length > 0) {
  console.error(
    `文案约束检查未通过，共 ${violations.length} 处。规则、出处与登记的说法见 infra/ci/copy-rules.json：`,
  );
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log(
  `文案约束检查通过：规则 ${rules.length} 条；扫了源码 ${counted.files.size} 个文件、页面标题 ${counted.titles.size} 个、错误码的默认文案 ${counted.errors.size} 个，没有命中。`,
);
if (pending.size > 0) {
  console.log(
    `登记了、还没建的路径 ${pending.size} 个（建了以后自动扫）：${[...pending].join("、")}`,
  );
}
