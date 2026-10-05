// 结构防漂移几个脚本共用的部分（W0-06b）：db-snapshot.mjs、db-constraints.mjs、db-partition-assert.mjs
// 与它们的用例、反例都引它。连库、读系统目录、计数沿用 db-lib.mjs（W0-05），本文件不改它，只在上面加：
//   - 建一个临时库并跑完全部迁移；
//   - 把系统目录读成“规范化的结构”：六类（表、列、约束、索引、触发器、函数），去掉分区子表及其名下的东西；
//   - 结构快照（packages/db/snapshot/structure.txt）的写法与读法；
//   - 两份结构逐条比；数量的三处来源（库、快照、06 第 1 节）。
// 本文件不引依赖，自己不是命令。
//
// 规范化只做一件事（计划 第 5.7 节“表结构与约束”行）：分区子表连同它名下的列、约束、索引、触发器不进快照。
// 子表的名字随建库的月份变（14 分组 第 2.9 节），进了快照就每个月红一次；子表由 db-partition-assert.mjs 另行断言。
// 认子表靠系统目录的 relispartition，不靠名字：以后再有别的分区表，这里不用改。
// 比什么、不比什么沿用 db-lib.mjs 里那条查询的口径（触发器连启停一起比，外键连它名下内部触发器的启停一起比，
// 表连行级安全的两个开关一起比），所以“触发器被停用、函数体被换掉”都查得出。授权、序列、扩展等不在六类里，不进快照。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { countsOf, dropDb, readCatalog, recreateDb, sqlOrThrow } from "./db-lib.mjs";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
export const MIGRATIONS_DIR = "packages/db/prisma/migrations";
export const SNAPSHOT_PATH = "packages/db/snapshot/structure.txt";
export const DATA_MODEL_DOC = "docs/06-data-model.md";

/** 快照的六节：[db-lib.mjs 里的类别, 节名] */
export const SECTIONS = [
  ["tables", "表"],
  ["columns", "列"],
  ["constraints", "约束"],
  ["indexes", "索引"],
  ["triggers", "触发器"],
  ["functions", "函数"],
];

/** 迁移目录名，按字典序（Prisma 也按这个顺序执行） */
export function migrationNames(root = repoRoot) {
  return readdirSync(join(root, MIGRATIONS_DIR), { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
    .filter((name) => existsSync(join(root, MIGRATIONS_DIR, name, "migration.sql")))
    .sort();
}

/**
 * 在一个库上按顺序跑完全部迁移。一个迁移放进一个事务（与 migrate deploy 一次发出去的效果相同，也比逐句提交快）；
 * 带 CONCURRENTLY 的迁移不能放进事务（D7 第 8.3 节第 2 条：单独一个文件、只含那一条语句），原样发。
 */
export function applyMigrations(db, { root = repoRoot, env } = {}) {
  const names = migrationNames(root);
  if (names.length === 0) throw new Error(`${MIGRATIONS_DIR} 下没有迁移`);
  for (const name of names) {
    const sql = readFileSync(join(root, MIGRATIONS_DIR, name, "migration.sql"), "utf8");
    sqlOrThrow(db, /\bconcurrently\b/i.test(sql) ? sql : `begin;\n${sql}\ncommit;`, env);
  }
  return names;
}

/** 建临时库、跑完全部迁移、交给 fn 用、删库。库名只认 lyx_ 开头（db-lib.mjs 的守卫） */
export function withMigratedDb(name, fn, options = {}) {
  recreateDb(name, { env: options.env });
  try {
    applyMigrations(name, options);
    return fn(name);
  } finally {
    dropDb(name, options.env);
  }
}

/**
 * 把 db-lib.mjs 读出来的系统目录收成规范化结构：{ version, sections: { tables: [{ key, def }], … }, counts, partitions }。
 * counts 是 { 项: [只数逻辑表, 含分区子表] }；partitions 是被去掉的分区子表的名字。
 */
export function structureOf(catalog) {
  const sections = {};
  for (const [id] of SECTIONS) {
    sections[id] = catalog[id].filter((row) => !row.part).map(({ key, def }) => ({ key, def }));
  }
  return {
    version: catalog.version,
    sections,
    counts: countsOf(catalog),
    partitions: catalog.tables.filter((row) => row.part).map((row) => row.key),
  };
}

/** 读一个库的规范化结构。只读 */
export const readStructure = (db, env) => structureOf(readCatalog(db, env));

const HEADER = [
  "# 结构快照（W0-06b）。生成物，不手改：pnpm db:snapshot 在空库上跑完全部迁移后读系统目录写出。",
  "# 一项一行：名字、制表符、定义（JSON）；各节按名字排序。定义取 pg_get_constraintdef、pg_get_indexdef、",
  "# pg_get_triggerdef、pg_get_functiondef 的输出（PostgreSQL 17），外加启停、是否已校验等几个开关。",
  "# 不含：分区子表及其名下的列、约束、索引、触发器（名字随建库的月份变，由 pnpm db:partitions:assert 断言）；",
  "# 授权（pnpm db:verify-grants）；序列、扩展等六类之外的对象。",
  "# 加表、加索引、改约束：写新迁移，重跑 pnpm db:snapshot，把本文件的变化与迁移、分组文档一起提交。",
  "# “计数”一节两列：只数逻辑表 / 含刚跑完迁移时的分区子表（兜底、当月、未来 3 个月）。与 06 第 1 节对得上。",
];

/** 把规范化结构写成快照的文本 */
export function renderSnapshot({ sections, counts }) {
  const lines = [...HEADER, "", "## 计数"];
  for (const [item, [logical, all]] of Object.entries(counts)) {
    lines.push(`${item}\t${logical}\t${all}`);
  }
  for (const [id, label] of SECTIONS) {
    lines.push("", `## ${label}`);
    for (const { key, def } of sections[id]) lines.push(`${key}\t${JSON.stringify(def)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** 读快照的文本：{ sections, counts }。认不出的行即报错，不猜 */
export function parseSnapshot(text) {
  const byLabel = new Map(SECTIONS.map(([id, label]) => [label, id]));
  const sections = Object.fromEntries(SECTIONS.map(([id]) => [id, []]));
  const counts = {};
  let current = null;
  text.split("\n").forEach((line, index) => {
    if (line === "" || line.startsWith("# ")) return;
    const where = `快照第 ${index + 1} 行`;
    if (line.startsWith("## ")) {
      const label = line.slice(3);
      current = label === "计数" ? "counts" : byLabel.get(label);
      if (current === undefined) throw new Error(`${where}：不认识的节“${label}”`);
      return;
    }
    const cells = line.split("\t");
    if (
      current === "counts" &&
      cells.length === 3 &&
      cells.slice(1).every((c) => /^\d+$/.test(c))
    ) {
      counts[cells[0]] = [Number(cells[1]), Number(cells[2])];
    } else if (current !== null && current !== "counts" && cells.length === 2) {
      sections[current].push({ key: cells[0], def: JSON.parse(cells[1]) });
    } else throw new Error(`${where}：写法认不出`);
  });
  return { sections, counts };
}

/** 读入库的快照；path 可以换成别处的一份（用例用） */
export function readSnapshot(path = join(repoRoot, SNAPSHOT_PATH)) {
  if (!existsSync(path)) throw new Error(`找不到结构快照 ${path}：先跑 pnpm db:snapshot`);
  return parseSnapshot(readFileSync(path, "utf8"));
}

/**
 * 两份结构逐条比，每条差异一句话，带节名。names 是两边各叫什么，如 ["快照", "库里"]。
 * 只在一边有的对象各报一条；两边都有而定义不同的，逐个字段报。
 */
export function diffStructure(expected, actual, names) {
  const [left, right] = names;
  const problems = [];
  for (const [id, label] of SECTIONS) {
    const other = new Map(actual[id].map((row) => [row.key, row.def]));
    const seen = new Set();
    for (const { key, def } of expected[id]) {
      seen.add(key);
      const found = other.get(key);
      if (found === undefined) {
        problems.push(`【${label}】${key}：${left}有，${right}没有`);
        continue;
      }
      for (const field of Object.keys({ ...def, ...found })) {
        const [a, b] = [JSON.stringify(def[field]), JSON.stringify(found[field])];
        if (a !== b)
          problems.push(`【${label}】${key} 的 ${field} 不同：${left} ${a}；${right} ${b}`);
      }
    }
    for (const { key } of actual[id]) {
      if (!seen.has(key)) problems.push(`【${label}】${key}：${right}有，${left}没有`);
    }
  }
  return problems;
}

/**
 * 06 第 1 节“规模”一条里写的数量，读成与 counts 同形的 { 项: [只数逻辑表, 含分区子表] }。
 * 数量只写在文档与快照里，不写在检查脚本里：加表、加索引的包改迁移、重出快照、行内改 06 的这几个数，检查跟着走。
 * 那一条的写法认不出即报错（改写了句式，就把这里的读法一起改）。
 */
export function readDocCounts(root = repoRoot) {
  const text = readFileSync(join(root, DATA_MODEL_DOC), "utf8");
  const line = text.split("\n").find((item) => item.startsWith("- **规模**"));
  const number = (pattern, what) => {
    const found = line?.match(pattern);
    if (!found) throw new Error(`${DATA_MODEL_DOC} 第 1 节“规模”一条里读不出${what}`);
    return found.slice(1).map((digits) => Number(digits.replaceAll(",", "")));
  };
  const [tables] = number(/^- \*\*规模\*\*：([\d,]+) 张表/, "表数");
  const [children] = number(/含埋点事件表的 ([\d,]+) 个按月分区子表/, "分区子表数");
  const [foreignKeys] = number(/外键 ([\d,]+) 个/, "外键数");
  const [checksAll] = number(/CHECK 约束 ([\d,]+) 条/, "CHECK 数（含分区子表）");
  const [indexesAll, partialAll] = number(
    /索引 ([\d,]+) 个（含 ([\d,]+) 个部分索引）/,
    "索引数（含分区子表）",
  );
  const [triggersAll] = number(/触发器 ([\d,]+) 个，排他约束/, "触发器数（含分区子表）");
  const [exclusions] = number(/排他约束 ([\d,]+) 个/, "排他约束数");
  const [logicalTables, checks, indexes, partial, triggers] = number(
    /只数 ([\d,]+) 张逻辑表是 CHECK ([\d,]+) 条、索引 ([\d,]+) 个（部分索引 ([\d,]+) 个）、触发器 ([\d,]+) 个/,
    "逻辑表口径的几个数",
  );
  if (logicalTables !== tables) {
    throw new Error(
      `${DATA_MODEL_DOC} 第 1 节“规模”一条里两处表数不一致：${tables} 与 ${logicalTables}`,
    );
  }
  return {
    表: [tables, tables + children],
    "CHECK 约束": [checks, checksAll],
    触发器: [triggers, triggersAll],
    外键: [foreignKeys, foreignKeys],
    排他约束: [exclusions, exclusions],
    索引: [indexes, indexesAll],
    部分索引: [partial, partialAll],
  };
}

/** 两组数量对不上的地方。columns 给 [0]（只比逻辑表口径）或 [0, 1]（两组都比） */
export function countProblems(expected, actual, names, columns = [0, 1]) {
  const [left, right] = names;
  const pick = (pair) => columns.map((index) => pair?.[index]).join(" / ");
  const problems = [];
  for (const item of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const [a, b] = [pick(expected[item]), pick(actual[item])];
    if (a !== b) problems.push(`【计数】${item}：${left} ${a}；${right} ${b}`);
  }
  return problems;
}

// ---------- 分区断言 ----------
// 分区子表不进快照，这里单独断言（计划 第 5.7 节；14 分组 第 2.9 节）。对库里每一张按范围分区的表：
//   1. 兜底分区 <表>_default 在，而且是空的（有行说明有事件落到了没建分区的月份）；
//   2. 当月与未来 3 个月的分区 <表>_y<年>m<月> 都在，上下界是那个月的北京时间月界；
//   3. 每个子表上：父表的行级触发器都带过来了且启用；父表拦 TRUNCATE 的语句级触发器，子表上各有一个调同一个函数的、
//      启用的（语句级触发器不会从父表带到分区，建分区的函数逐个补，少了它整张子表能被一句 TRUNCATE 清空）。
// “当月”按库的时钟、北京时间算。已经部署的库上分区会越建越多：多出来的月份不算问题。
// 一张分区表都没有即不通过：不是连错了库，就是迁移没跑。

/** 读分区情况的查询：先把会话时区设成北京时间，分区上下界读出来就是固定的写法 */
export const PARTITION_SQL = `
set search_path to public;
set timezone to 'Asia/Shanghai';
select json_build_object(
  'today', to_char(now(), 'YYYY-MM-DD'),
  'parents', (select coalesce(json_agg(json_build_object(
      'name', p.oid::regclass::text,
      'strategy', pt.partstrat,
      'triggers', (select coalesce(json_agg(json_build_object('name', t.tgname, 'enabled', t.tgenabled,
                      'row', (t.tgtype & 1) = 1, 'truncate', (t.tgtype & 32) = 32,
                      'function', t.tgfoid::regproc::text) order by t.tgname), '[]'::json)
                     from pg_trigger t where t.tgrelid = p.oid and not t.tgisinternal),
      'children', (select coalesce(json_agg(json_build_object(
          'name', c.oid::regclass::text,
          'bound', pg_get_expr(c.relpartbound, c.oid),
          'rows', (xpath('/row/n/text()', query_to_xml(format(
                     'select count(*) as n from (select 1 from only %s limit 1) x', c.oid::regclass), false, true, '')))[1]::text::int,
          'triggers', (select coalesce(json_agg(json_build_object('name', t.tgname, 'enabled', t.tgenabled,
                          'row', (t.tgtype & 1) = 1, 'truncate', (t.tgtype & 32) = 32,
                          'function', t.tgfoid::regproc::text) order by t.tgname), '[]'::json)
                         from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal)
        ) order by c.relname), '[]'::json)
        from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = p.oid)
    ) order by p.relname), '[]'::json)
    from pg_class p join pg_partitioned_table pt on pt.partrelid = p.oid
   where p.relnamespace = 'public'::regnamespace)
);`;

/** “当月与未来 3 个月”：[{ suffix: "y2026m10", bound: "FOR VALUES FROM (…) TO (…)" }, …]。today 是 YYYY-MM-DD */
export function expectedMonths(today, ahead = 3) {
  const [year, month] = today.split("-").map(Number);
  const first = (offset) => {
    const index = year * 12 + (month - 1) + offset;
    return [Math.floor(index / 12), (index % 12) + 1];
  };
  const stamp = ([y, m]) => `${y}-${String(m).padStart(2, "0")}-01 00:00:00+08`;
  return Array.from({ length: ahead + 1 }, (_, offset) => {
    const [y, m] = first(offset);
    return {
      suffix: `y${y}m${String(m).padStart(2, "0")}`,
      bound: `FOR VALUES FROM ('${stamp([y, m])}') TO ('${stamp(first(offset + 1))}')`,
    };
  });
}

/** 分区断言不成立的地方，每条一句话。info 是 PARTITION_SQL 读出来的；today 缺省取库的时钟（北京时间） */
export function partitionProblems(info, today = info.today) {
  const problems = [];
  if (info.parents.length === 0) {
    return ["这个库里一张分区表都没有：连错了库，或迁移没跑"];
  }
  for (const parent of info.parents) {
    if (parent.strategy !== "r") {
      problems.push(`${parent.name}：不是按范围分区的表（策略 ${parent.strategy}），本断言不认识`);
      continue;
    }
    const children = new Map(parent.children.map((child) => [child.name, child]));
    const fallback = children.get(`${parent.name}_default`);
    if (!fallback || fallback.bound !== "DEFAULT") {
      problems.push(`${parent.name}：兜底分区 ${parent.name}_default 不存在`);
    } else if (fallback.rows !== 0) {
      problems.push(`${parent.name}：兜底分区 ${parent.name}_default 里有数据，应为空`);
    }
    for (const { suffix, bound } of expectedMonths(today)) {
      const child = children.get(`${parent.name}_${suffix}`);
      if (!child)
        problems.push(
          `${parent.name}：分区 ${parent.name}_${suffix} 不存在（当月与未来 3 个月都要有）`,
        );
      else if (child.bound !== bound) {
        problems.push(
          `${parent.name}：分区 ${child.name} 的上下界不对：应为 ${bound}；库里 ${child.bound}`,
        );
      }
    }
    const inherited = parent.triggers.filter((trigger) => trigger.row);
    const guards = parent.triggers.filter((trigger) => !trigger.row && trigger.truncate);
    for (const child of parent.children) {
      for (const trigger of inherited) {
        const clone = child.triggers.find((item) => item.row && item.name === trigger.name);
        if (!clone) problems.push(`${child.name}：没有父表的行级触发器 ${trigger.name}`);
        else if (clone.enabled !== "O") {
          problems.push(
            `${child.name}：触发器 ${trigger.name} 被停用或改了启用方式（${clone.enabled}）`,
          );
        }
      }
      for (const guard of guards) {
        const own = child.triggers.filter(
          (item) => !item.row && item.truncate && item.function === guard.function,
        );
        if (own.length === 0) {
          problems.push(`${child.name}：没有拦 TRUNCATE 的语句级触发器（调 ${guard.function}）`);
        } else if (!own.some((item) => item.enabled === "O")) {
          problems.push(`${child.name}：拦 TRUNCATE 的触发器 ${own[0].name} 被停用或改了启用方式`);
        }
      }
    }
  }
  return problems;
}

/** 读一个库的分区情况。只读（数兜底分区有没有行，要这个账号读得了子表：属主或只读角色） */
export const readPartitions = (db, env) => JSON.parse(sqlOrThrow(db, PARTITION_SQL, env));
