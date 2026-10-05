#!/usr/bin/env node
// 迁移规范检查（W0-06b；D7 第 8.3 节第 5 条；W0-06b 任务书 第 11 节第 5、7 项）。
//
// 用法：node infra/ci/migration-lint.mjs [--base <git 引用>] [--root <目录>]
//   根脚本是 pnpm db:migration-lint。不连库，只读迁移文件与 git
//   --base  拿哪个提交当“已经合并的”，默认 origin/main。CI 里 PR 给目标分支，推到 main 给推之前的提交
//   --root  仓库根目录，默认本仓库（用例用）
// 查两件事，任何一件不过即退出码 1：
//   一、四类语句要带理由。迁移里出现 DROP、RENAME、ALTER … TYPE、不带默认值的 SET NOT NULL，这条语句前面
//       （上一条语句的分号之后、这条语句结束之前）必须有一行注释 “-- lyx:allow <理由>”。理由是写给评审看的：
//       带标记的语句由业主评审（任务书 第 11 节第 6 项），新迁移里的在输出末尾列出，抄进 PR 描述“门禁改动”一节。
//       两种情形不用标记：
//         ① 同一个迁移里成对的 CHECK 替换（D7 第 8.3 节第 2 条“加枚举值”那三句）：
//            ADD CONSTRAINT <新> CHECK (…) NOT VALID → VALIDATE CONSTRAINT <新> → DROP CONSTRAINT <旧>，
//            三句同一张表，<旧> 是此前某个迁移里加的 CHECK。一对“加 + 校验”只抵一句 DROP；
//         ② DROP COLUMN 删的列，在上一个发布标签（v 开头、HEAD 能到的最近一个）的 schema.prisma 里已标 @ignore
//            （D7 的删列两步）。仓库还没有 v 开头的标签时这一条不生效，删列一律要标记。带 CASCADE 的不算。
//       “带不带默认值”按迁移自己的文本推：建表、加列时写了 DEFAULT（或自增、生成列），或此前 SET DEFAULT 过。
//   二、已经合并的迁移不能改。相对 --base：已有迁移目录下的文件被改、被删、多了文件，都不通过
//       （Prisma 按文件的校验值认迁移，改了的迁移在已部署的库上跑不过去）；新迁移的目录名要排在已有的全部之后，
//       写成 <14 位时间戳>_<小写名字>，里面只有一个 migration.sql。
// 怎么切语句：按顶层的分号切；注释、字符串、带引号的名字、$…$ 引起来的函数体里的分号不算。字符串与函数体里的字
// 不当关键字看（触发器函数里写 DROP 不算迁移在 DROP）；DO 块例外，它的块体当场就执行，照样查。
// 查不出的：动态拼出来再 EXECUTE 的语句；先建函数、同一个迁移里再调它来删东西。迁移是甲类，靠评审。
// 退出码：0 通过；1 不合规范；2 用法或环境错误（--base 认不出、不在 git 仓库里）。本脚本不引依赖。

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = "packages/db/prisma/migrations";
const SCHEMA = "packages/db/prisma/schema.prisma";
const DIR_NAME = /^\d{14}_[a-z0-9_]+$/;
const MARK = /^--\s*lyx:allow\s+\S/;

function usage(message) {
  console.error(`迁移规范检查：${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    base: "origin/main",
    root: fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, ""),
  };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index].startsWith("--") ? argv[index].slice(2) : "";
    if (!Object.hasOwn(options, name)) usage(`不认识的参数 ${argv[index]}。用法见脚本开头`);
    if (!argv[index + 1]) usage(`${argv[index]} 后面要跟一个值`);
    options[name] = argv[index + 1];
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: options.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if (allowFail) return null;
    return usage(`git ${args.join(" ")} 没跑成：${String(error.stderr ?? error.message).trim()}`);
  }
}

// ---------- 切语句 ----------

/**
 * 把一个迁移切成语句：[{ line, code, comments, text }]。
 *   line      语句第一个字所在的行号；
 *   code      拿来认关键字的文本：注释去掉，字符串的内容去掉，带引号的名字去掉引号，
 *             $…$ 里的内容去掉（DO 块的保留），空白压成一个空格，全小写；
 *   comments  上一条语句的分号之后、这条语句结束之前出现的行注释；
 *   text      原文的头一行，报错时给人看。
 */
function splitStatements(sql) {
  const statements = [];
  let code = "";
  let comments = [];
  let startLine = null;
  let firstText = "";
  let line = 1;
  const push = () => {
    const normalized = code.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized !== "") {
      statements.push({ line: startLine, code: normalized, comments, text: firstText.trim() });
    }
    [code, comments, startLine, firstText] = ["", [], null, ""];
  };
  const begin = (index) => {
    if (startLine !== null) return;
    startLine = line;
    const end = sql.indexOf("\n", index);
    firstText = sql.slice(index, end < 0 ? sql.length : end);
  };
  for (let index = 0; index < sql.length;) {
    const char = sql[index];
    const rest = sql.slice(index, index + 2);
    if (rest === "--") {
      const end = sql.indexOf("\n", index);
      comments.push(sql.slice(index, end < 0 ? sql.length : end).trim());
      index = end < 0 ? sql.length : end;
    } else if (rest === "/*") {
      let depth = 1;
      let cursor = index + 2;
      while (cursor < sql.length && depth > 0) {
        if (sql.startsWith("/*", cursor)) [depth, cursor] = [depth + 1, cursor + 2];
        else if (sql.startsWith("*/", cursor)) [depth, cursor] = [depth - 1, cursor + 2];
        else cursor += 1;
      }
      line += sql.slice(index, cursor).split("\n").length - 1;
      index = cursor;
    } else if (char === "'" || char === '"') {
      begin(index);
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === char && sql[cursor + 1] === char) cursor += 2;
        else if (sql[cursor] === char) break;
        else cursor += 1;
      }
      const body = sql.slice(index + 1, cursor);
      line += body.split("\n").length - 1;
      code += char === '"' ? body : "''";
      index = cursor + 1;
    } else if (char === "$" && /^\$[A-Za-z_]*\$/.test(sql.slice(index, index + 64))) {
      begin(index);
      const tag = sql.slice(index).match(/^\$[A-Za-z_]*\$/)[0];
      const close = sql.indexOf(tag, index + tag.length);
      const end = close < 0 ? sql.length : close;
      const body = sql.slice(index + tag.length, end);
      line += body.split("\n").length - 1;
      // DO 块的块体当场执行：留下来一起认关键字。函数体只是存起来，不算迁移在做的事
      code += /^\s*do\b/i.test(code) ? ` ${body} ` : " $$ ";
      index = end + tag.length;
    } else if (char === ";") {
      push();
      index += 1;
    } else {
      if (!/\s/.test(char)) begin(index);
      if (char === "\n") line += 1;
      code += char;
      index += 1;
    }
  }
  push();
  return statements;
}

// ---------- 四类语句 ----------

const NAME = String.raw`(?:\w+\.)?(\w+)`;
const ALTER_TABLE = new RegExp(String.raw`^alter table (?:if exists )?(?:only )?${NAME}\b`);
const COLUMN_TYPE = /\balter (?:column )?(?!table\b|index\b|column\b)\w+ (?:set data )?type\b/;
const SET_NOT_NULL = /\balter (?:column )?(\w+) set not null\b/g;

/** 圆括号配平，取出第一对括号里的内容；没有括号给 null */
function parenBody(code) {
  const open = code.indexOf("(");
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === "(") depth += 1;
    else if (code[index] === ")" && (depth -= 1) === 0) return code.slice(open + 1, index);
  }
  return code.slice(open + 1);
}

/** 按顶层的逗号切开（括号里的逗号不算） */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === "," && depth === 0) [parts[parts.length], current] = [current, ""];
    else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

const HAS_DEFAULT = /\b(?:default|generated|serial|bigserial|smallserial)\b/;

/**
 * 跟着迁移的文本记两本账，给“不带默认值的 SET NOT NULL”与“成对的 CHECK 替换”用：
 * defaults 是带默认值的列（"表.列"），checks 是每张表上加过的 CHECK 的名字。
 */
function track(code, state) {
  const { defaults, checks } = state;
  const move = (from, to) => {
    for (const key of [...defaults]) {
      if (key.startsWith(`${from}.`)) {
        defaults.delete(key);
        defaults.add(`${to}.${key.slice(from.length + 1)}`);
      }
    }
    if (checks.has(from)) {
      checks.set(to, checks.get(from));
      checks.delete(from);
    }
  };
  const created = code.match(
    new RegExp(String.raw`^create (?:unlogged )?table (?:if not exists )?${NAME}\b`),
  );
  if (created) {
    const table = created[1];
    for (const item of splitTopLevel(parenBody(code) ?? "")) {
      const like = item.match(new RegExp(String.raw`^like ${NAME}\b(.*)$`));
      if (like && /\bincluding (?:defaults|all)\b/.test(like[2])) {
        for (const key of [...defaults]) {
          if (key.startsWith(`${like[1]}.`))
            defaults.add(`${table}.${key.slice(like[1].length + 1)}`);
        }
      }
      const named = item.match(/^constraint (\w+) check\b/);
      if (named) checks.set(table, (checks.get(table) ?? new Set()).add(named[1]));
      const column = item.match(/^(\w+) /)?.[1];
      const keyword = /^(?:constraint|primary|unique|check|foreign|exclude|like)$/.test(
        column ?? "",
      );
      if (column && !keyword && HAS_DEFAULT.test(item)) defaults.add(`${table}.${column}`);
    }
    return;
  }
  const table = code.match(ALTER_TABLE)?.[1];
  if (!table) return;
  const body = code.replace(ALTER_TABLE, "");
  const renamedTable = body.match(/^ rename to (\w+)$/);
  if (renamedTable) return move(table, renamedTable[1]);
  for (const action of splitTopLevel(body)) {
    const added = action.match(/^add (?:column )?(?:if not exists )?(\w+) /);
    if (added && !/^constraint$/.test(added[1]) && HAS_DEFAULT.test(action)) {
      defaults.add(`${table}.${added[1]}`);
    }
    const check = action.match(/^add constraint (\w+) check\b/);
    if (check) checks.set(table, (checks.get(table) ?? new Set()).add(check[1]));
    const setDefault = action.match(/^alter (?:column )?(\w+) (set|drop) default\b/);
    if (setDefault?.[2] === "set") defaults.add(`${table}.${setDefault[1]}`);
    if (setDefault?.[2] === "drop") defaults.delete(`${table}.${setDefault[1]}`);
    const renamed = action.match(/^rename (?:column )?(\w+) to (\w+)$/);
    if (renamed && defaults.delete(`${table}.${renamed[1]}`))
      defaults.add(`${table}.${renamed[2]}`);
  }
}

/** 这条语句属于四类里的哪几类 */
function kindsOf(code, state) {
  const kinds = [];
  if (/\bdrop\b/.test(code)) kinds.push("DROP");
  if (/\brename\b/.test(code)) kinds.push("RENAME");
  if (COLUMN_TYPE.test(code)) kinds.push("ALTER … TYPE");
  const table = code.match(ALTER_TABLE)?.[1];
  const bare = [...code.matchAll(SET_NOT_NULL)]
    .map((found) => found[1])
    .filter((column) => !state.defaults.has(`${table}.${column}`));
  if (bare.length > 0) kinds.push(`不带默认值的 SET NOT NULL（${bare.join("、")}）`);
  return kinds;
}

/** 上一个发布标签的 schema.prisma 里标了 @ignore 的列："表.列" 的集合；没有标签给 null */
function ignoredAtLastRelease() {
  const tag = git(["describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD"], {
    allowFail: true,
  })?.trim();
  if (!tag) return null;
  const schema = git(["show", `${tag}:${SCHEMA}`], { allowFail: true });
  const ignored = new Set();
  for (const block of (schema ?? "").matchAll(/^model \w+ \{\n([\s\S]*?)^\}/gm)) {
    const table = block[1].match(/^\s*@@map\("(\w+)"\)/m)?.[1];
    if (!table) continue;
    for (const field of block[1].split("\n")) {
      const name = field.match(/^\s*(\w+)\s+\w/)?.[1];
      if (!name || field.trimStart().startsWith("//") || !/@ignore\b/.test(field)) continue;
      ignored.add(`${table}.${field.match(/@map\("(\w+)"\)/)?.[1] ?? name}`);
    }
  }
  return ignored;
}

// ---------- 主流程 ----------

const migrationsDir = join(options.root, MIGRATIONS);
if (!existsSync(migrationsDir)) usage(`找不到 ${MIGRATIONS}`);
const mergeBase = git(["merge-base", options.base, "HEAD"], { allowFail: true })?.trim();
if (!mergeBase)
  usage(`--base ${options.base} 认不出，或与 HEAD 没有共同的祖先（CI 里要带完整历史检出）`);

const problems = [];
const baseDirs = new Set(
  (git(["ls-tree", "-d", "--name-only", mergeBase, `${MIGRATIONS}/`], { allowFail: true }) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((path) => path.slice(MIGRATIONS.length + 1)),
);
const dirs = readdirSync(migrationsDir, { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
  .sort();

// 二、已经合并的迁移不能改
const changed = git(["diff", "--name-status", "--no-renames", mergeBase, "--", MIGRATIONS])
  .split("\n")
  .filter(Boolean)
  .map((row) => row.split("\t"));
const untracked = git(["ls-files", "--others", "--exclude-standard", "--", MIGRATIONS])
  .split("\n")
  .filter(Boolean)
  .map((path) => ["A", path]);
for (const [status, path] of [...changed, ...untracked]) {
  const dir = path.slice(MIGRATIONS.length + 1).split("/")[0];
  const what =
    { A: "多了文件", D: "被删了", M: "被改了" }[status] ?? `有改动（git 状态 ${status}）`;
  if (baseDirs.has(dir)) problems.push(`${path}：已经合并的迁移不能改，这个文件${what}`);
  else if (status !== "A") problems.push(`${path}：迁移目录下已有的文件${what}`);
}
const lastMerged = [...baseDirs].sort().at(-1) ?? "";
const added = dirs.filter((dir) => !baseDirs.has(dir));
for (const dir of added) {
  if (!DIR_NAME.test(dir)) {
    problems.push(`${MIGRATIONS}/${dir}：目录名要写成 <14 位时间戳>_<小写字母、数字、下划线>`);
  }
  if (dir < lastMerged) {
    problems.push(
      `${MIGRATIONS}/${dir}：新迁移要排在已有的全部之后（最后一个已合并的是 ${lastMerged}）`,
    );
  }
}
for (const dir of dirs) {
  const files = readdirSync(join(migrationsDir, dir)).sort();
  if (files.join() !== "migration.sql") {
    problems.push(
      `${MIGRATIONS}/${dir}：里面应当只有一个 migration.sql，现在是 ${files.join("、") || "空的"}`,
    );
  }
}

// 一、四类语句要带理由
const ignored = ignoredAtLastRelease();
const state = { defaults: new Set(), checks: new Map() };
const marked = [];
let statementCount = 0;
for (const dir of dirs) {
  const file = join(migrationsDir, dir, "migration.sql");
  if (!existsSync(file)) continue;
  /** 这个迁移里已经“加 + 校验”、还没抵过 DROP 的新 CHECK：表 → 名字 */
  const pending = new Map();
  const unvalidated = new Set();
  for (const statement of splitStatements(readFileSync(file, "utf8"))) {
    statementCount += 1;
    const { code } = statement;
    const where = `${MIGRATIONS}/${dir}/migration.sql 第 ${statement.line} 行`;
    const kinds = kindsOf(code, state);
    const table = code.match(ALTER_TABLE)?.[1];
    const action = table ? code.replace(ALTER_TABLE, "") : "";

    const notValid = action.match(/^ add constraint (\w+) check\b.* not valid$/);
    if (notValid) unvalidated.add(`${table}.${notValid[1]}`);
    const validated = action.match(/^ validate constraint (\w+)$/);
    if (validated && unvalidated.delete(`${table}.${validated[1]}`)) {
      pending.set(table, [...(pending.get(table) ?? []), validated[1]]);
    }

    let excused = null;
    const dropCheck = action.match(/^ drop constraint (?:if exists )?(\w+)$/);
    const dropColumn = action.match(/^ drop column (?:if exists )?(\w+)$/);
    if (dropCheck && state.checks.get(table)?.has(dropCheck[1])) {
      const fresh = (pending.get(table) ?? []).find((name) => name !== dropCheck[1]);
      if (fresh) {
        pending.set(
          table,
          pending.get(table).filter((name) => name !== fresh),
        );
        excused = `成对的 CHECK 替换（${dropCheck[1]} → ${fresh}）`;
      }
    } else if (dropColumn && ignored?.has(`${table}.${dropColumn[1]}`)) {
      excused = "这一列在上一个发布标签的 schema.prisma 里已标 @ignore";
    }

    const reasons = statement.comments.filter((comment) => MARK.test(comment));
    if (kinds.length > 0 && excused === null) {
      if (reasons.length === 0) {
        problems.push(
          `${where}：${kinds.join("、")} 没有带 “-- lyx:allow <理由>”：${statement.text}`,
        );
      } else if (!baseDirs.has(dir)) {
        marked.push(`${where}：${statement.text}（${reasons[0].replace(/^--\s*/, "")}）`);
      }
    }
    track(code, state);
  }
}

console.log(
  `迁移规范检查：${dirs.length} 个迁移（相对 ${options.base} 新增 ${added.length} 个），共 ${statementCount} 条语句。`,
);
if (ignored === null) {
  console.log("仓库还没有 v 开头的发布标签：“已标 @ignore 的列可以直接删”这一条不生效。");
}
if (marked.length > 0) {
  console.log(
    `新迁移里带 lyx:allow 的语句 ${marked.length} 处（抄进 PR 描述“门禁改动”一节，业主评审）：`,
  );
  for (const line of marked) console.log(`- ${line}`);
}
if (problems.length === 0) {
  console.log("结论：通过。四类语句都带了理由，已经合并的迁移没有被改。");
  process.exit(0);
}
for (const problem of problems) console.error(`- ${problem}`);
console.error(`迁移规范检查未通过：${problems.length} 处。`);
process.exit(1);
