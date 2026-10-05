/**
 * 枚举与库 CHECK 一致（任务书 W0-09a 第 7 节第 6 条；计划 第 5.5 节、第 5.7 节“枚举”行）：
 * 库里每条“列取值集合”形态的 CHECK 都有契约枚举对应，取值集合相等；契约里绑定了“表.列”的枚举，
 * 库里都找得到这样一条 CHECK。差异数不是 0 即非 0 退出。
 *
 * 用法（在仓库根目录）：
 *   pnpm enums:check                    对迁移库 lyx_migrate_check
 *   pnpm enums:check -- --db <库名>     换一个库，库名只认 lyx_ 开头
 * 连库的办法与 tools/schema-check、infra/ci/db-lib.mjs 相同：psql 加标准的 PG* 环境变量；环境里没有 PGHOST 时
 * 从 DATABASE_URL 拆出主机、端口、用户、口令（库名不取它的）。本地的取值见 CLAUDE.md 第 9 节。
 * 库要先跑过迁移（pnpm db:deploy；怎么建 lyx_migrate_check 见 packages/db/README.md 第 3 节）。只读，不写库。
 * 连接串与口令只进子进程的环境变量：不进命令行参数，不打印。
 *
 * 口径：
 *   - 算“列取值集合”的 CHECK 只有四种写法（text 列）：列 IN (…)；列 IS NULL OR 列 IN (…)；以及只有一个取值时
 *     库里存成的 列 = '值'、列 IS NULL OR 列 = '值'。按 pg_get_constraintdef 的原文认，不看约束名。
 *   - 组合条件里出现的取值清单（CASE、AND、两列以上）不单独对账，由所属列自己的那条 CHECK 覆盖；条数只列出。
 *   - 只涉及一个 text 列、看着像取值集合却不是上面四种写法的，按差异报出来：宁可多报，不让它漏过去。
 *   - 不是 text 的取值集合（如整数角度）不算枚举，只列出。
 *   - 分区子表上继承来的约束不重复看；_prisma_migrations 不看。
 *   - 另核对名字写法的 CHECK 正则：契约里登记的写法（src/registry/formats.ts 的 NAME_FORMATS）与库里的逐字相同。
 *     它不是枚举，放在这里是因为同样要读库里的 CHECK；pnpm registry:check 靠这些正则校验登记的名字。
 * 退出码：0 通过；1 有差异；2 用法或环境错误（连不上库、库没跑过迁移、psql 不在）。
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ENUMS, type EnumDef } from "../src/enums/index.js";
import { NAME_FORMATS, type NameFormat } from "../src/registry/index.js";

const DEFAULT_DB = "lyx_migrate_check";
const DB_NAME = /^lyx_[a-z0-9_]{1,58}$/;

/** 要与库逐字比对的写法 */
export const CHECKED_FORMATS: readonly NameFormat[] = Object.values(NAME_FORMATS);

/** 库里的一条 CHECK */
export interface DbCheck {
  table: string;
  /** 约束名 */
  name: string;
  /** pg_get_constraintdef 的原文 */
  def: string;
  /** 这条约束涉及的列与类型 */
  columns: { name: string; type: string }[];
}

/** 库里一条“列取值集合”形态的 CHECK */
export interface DbEnumCheck {
  /** “表.列” */
  column: string;
  constraint: string;
  values: string[];
}

const CHECKS_SQL = `
select coalesce(json_agg(json_build_object(
         'table', c.relname, 'name', con.conname, 'def', pg_get_constraintdef(con.oid),
         'columns', (select json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod))
                             order by a.attnum)
                       from pg_attribute a
                      where a.attrelid = c.oid and a.attnum = any (con.conkey)))
         order by c.relname, con.conname), '[]'::json)
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where con.contype = 'c' and n.nspname = 'public' and not c.relispartition
   and c.relname <> '_prisma_migrations';
`;

// ---------- 认 CHECK 的写法 ----------

const LITERAL = String.raw`'(?:[^']|'')*'::text`;
const LIST = String.raw`ARRAY\[(${LITERAL}(?:, ${LITERAL})*)\]`;
const NAME = String.raw`([a-z_][a-z0-9_]*)`;
/** 四种写法，都是：第 1 组列名，第 2 组取值（一个或一串字面量） */
const ENUM_FORMS = [
  new RegExp(String.raw`^CHECK \(\(${NAME} = ANY \(${LIST}\)\)\)$`),
  new RegExp(String.raw`^CHECK \(\(\(${NAME} IS NULL\) OR \(\1 = ANY \(${LIST}\)\)\)\)$`),
  new RegExp(String.raw`^CHECK \(\(${NAME} = (${LITERAL})\)\)$`),
  new RegExp(String.raw`^CHECK \(\(\(${NAME} IS NULL\) OR \(\1 = (${LITERAL})\)\)\)$`),
];
const LITERAL_VALUE = /'((?:[^']|'')*)'::text/g;
/** 一个列等于一串取值里的某一个，取值不是 text 字面量 */
const NON_TEXT_SET = new RegExp(String.raw`^CHECK \(\(${NAME} = ANY \(ARRAY\[[^\]']*\]\)\)\)$`);

const unescape = (text: string) => text.replaceAll("''", "'");

/** 这条 CHECK 是不是“列取值集合”形态；是则返回列与取值 */
export function enumCheckOf(check: DbCheck): DbEnumCheck | null {
  for (const form of ENUM_FORMS) {
    const match = form.exec(check.def);
    if (!match) continue;
    const values = [...match[2]!.matchAll(LITERAL_VALUE)].map((literal) => unescape(literal[1]!));
    return { column: `${check.table}.${match[1]!}`, constraint: check.name, values };
  }
  return null;
}

/** 只涉及一个 text 列、带“等于某个字面量”或“等于一串里的某个”的 CHECK：看着像取值集合 */
const looksLikeValueSet = (check: DbCheck) =>
  check.columns.length === 1 &&
  check.columns[0]!.type === "text" &&
  / = (?:ANY \(|')/.test(check.def);

export interface EnumCheckResult {
  problems: string[];
  /** 库里“列取值集合”形态的 CHECK */
  dbEnumChecks: DbEnumCheck[];
  /** 其中只有一个取值的条数 */
  singleValue: number;
  /** 不是 text 的取值集合：不算枚举，只列出 */
  nonText: string[];
  /** 组合条件里带取值清单、不单独对账的 CHECK 条数 */
  compound: number;
  /** 核对过的写法 CHECK 条数 */
  formats: number;
}

/** 库里的 CHECK 与契约的枚举、写法对账。纯函数：不连库 */
export function enumProblems(
  checks: readonly DbCheck[],
  enums: readonly EnumDef[] = ENUMS,
  formats: readonly NameFormat[] = CHECKED_FORMATS,
): EnumCheckResult {
  const problems: string[] = [];
  const dbEnumChecks: DbEnumCheck[] = [];
  const nonText: string[] = [];
  let compound = 0;

  for (const check of checks) {
    const found = enumCheckOf(check);
    if (found) {
      dbEnumChecks.push(found);
    } else if (NON_TEXT_SET.test(check.def)) {
      nonText.push(`${check.table}.${check.columns[0]?.name ?? "?"}（${check.name}）`);
    } else if (looksLikeValueSet(check)) {
      problems.push(
        `${check.table}.${check.columns[0]!.name}：约束 ${check.name} 看着是取值集合，但写法认不出，没有对账：${check.def}`,
      );
    } else if (check.def.includes("= ANY (ARRAY[")) {
      compound += 1;
    }
  }

  const byColumn = new Map<string, DbEnumCheck>();
  for (const found of dbEnumChecks) {
    const earlier = byColumn.get(found.column);
    if (earlier) {
      problems.push(
        `${found.column}：库里有两条取值集合 CHECK（${earlier.constraint}、${found.constraint}），判不出以哪条为准`,
      );
    } else byColumn.set(found.column, found);
  }

  const bound = new Map<string, EnumDef>();
  for (const def of enums) {
    for (const column of def.columns) {
      const earlier = bound.get(column);
      if (earlier)
        problems.push(`${column}：契约里有两个枚举绑定了它（${earlier.name}、${def.name}）`);
      else bound.set(column, def);
    }
  }

  const quote = (values: readonly string[]) => values.map((value) => `'${value}'`).join("、");
  for (const [column, found] of byColumn) {
    const def = bound.get(column);
    if (!def) {
      problems.push(
        `${column}：库里有取值集合 CHECK（${found.constraint}：${quote(found.values)}），契约没有绑定它的枚举`,
      );
      continue;
    }
    const [inDb, inContract] = [new Set(found.values), new Set<string>(def.values)];
    const onlyDb = found.values.filter((value) => !inContract.has(value));
    const onlyContract = def.values.filter((value) => !inDb.has(value));
    if (onlyDb.length > 0)
      problems.push(
        `${column}：库的 CHECK（${found.constraint}）有、契约枚举 ${def.name} 没有的取值：${quote(onlyDb)}`,
      );
    if (onlyContract.length > 0)
      problems.push(
        `${column}：契约枚举 ${def.name} 有、库的 CHECK（${found.constraint}）没有的取值：${quote(onlyContract)}`,
      );
  }
  for (const [column, def] of bound) {
    if (!byColumn.has(column))
      problems.push(`${column}：契约枚举 ${def.name} 绑定了它，库里没有这一列的取值集合 CHECK`);
  }

  for (const format of formats) {
    const [table, column] = format.column.split(".") as [string, string];
    const pattern = new RegExp(String.raw`\(${column} ~ '((?:[^']|'')*)'::text\)`);
    const candidates = checks.filter((check) => check.table === table && pattern.test(check.def));
    if (candidates.length !== 1) {
      problems.push(
        `${format.column}：库里应恰有一条“${column} 匹配正则”的 CHECK，找到 ${candidates.length} 条`,
      );
      continue;
    }
    const check = candidates[0]!;
    const inDb = unescape(pattern.exec(check.def)![1]!);
    if (inDb !== format.pattern)
      problems.push(
        `${format.column}：写法的正则不一致。库（${check.name}）：${inDb}；契约：${format.pattern}`,
      );
    const limit = new RegExp(String.raw`char_length\(${column}\) <= (\d+)`).exec(check.def)?.[1];
    const inDbLimit = limit === undefined ? undefined : Number(limit);
    if (inDbLimit !== format.maxLength)
      problems.push(
        `${format.column}：长度上限不一致。库（${check.name}）：${inDbLimit ?? "没有"}；契约：${format.maxLength ?? "没有"}`,
      );
  }

  return {
    problems,
    dbEnumChecks,
    singleValue: dbEnumChecks.filter((found) => found.values.length === 1).length,
    nonText,
    compound,
    formats: formats.length,
  };
}

// ---------- 连库 ----------

class EnvironmentError extends Error {}

/** 给 psql 的连接环境变量：有 PGHOST 就用现成的，否则从 DATABASE_URL 拆 */
function pgEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  if (source.PGHOST) return {};
  if (!source.DATABASE_URL) {
    throw new EnvironmentError(
      "没有连接参数：给 DATABASE_URL，或给 PGHOST、PGPORT、PGUSER、PGPASSWORD（本地的取值见 CLAUDE.md 第 9 节）",
    );
  }
  let url: URL;
  try {
    url = new URL(source.DATABASE_URL);
  } catch {
    throw new EnvironmentError("DATABASE_URL 不是合法的连接串");
  }
  const env: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/** 从库里读出全部 CHECK */
export function readDbChecks(db: string, source: NodeJS.ProcessEnv = process.env): DbCheck[] {
  if (!DB_NAME.test(db)) throw new EnvironmentError(`库名只认 lyx_ 开头的：${db}`);
  const result = spawnSync("psql", ["-X", "-w", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db], {
    input: CHECKS_SQL,
    encoding: "utf8",
    env: { ...source, ...pgEnv(source) },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new EnvironmentError(`psql 没跑起来：${result.error.message}`);
  if (result.status !== 0) throw new EnvironmentError(`库 ${db} 读不了：${result.stderr.trim()}`);
  const checks = JSON.parse(result.stdout) as DbCheck[];
  if (checks.length === 0)
    throw new EnvironmentError(
      `库 ${db} 里一条 CHECK 都没有：它还没跑过迁移（pnpm db:deploy；见 packages/db/README.md 第 3 节）`,
    );
  return checks;
}

function main(argv: readonly string[]): void {
  let db = DEFAULT_DB;
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === "--") continue;
    if (argv[i] === "--db" && value) {
      db = value;
      i += 1;
    } else {
      console.error(`不认识的参数 ${argv[i]}。用法：tsx scripts/enums-check.ts [--db <库名>]`);
      process.exit(2);
    }
  }
  let result: EnumCheckResult;
  try {
    result = enumProblems(readDbChecks(db));
  } catch (error) {
    if (!(error instanceof EnvironmentError)) throw error;
    console.error(`枚举与库 CHECK 对账：没跑成。${error.message}`);
    process.exit(2);
  }
  const { problems, dbEnumChecks, singleValue, nonText, compound, formats } = result;
  const tables = new Set(dbEnumChecks.map((found) => found.column.split(".")[0])).size;
  const bindings = ENUMS.reduce((sum, def) => sum + def.columns.length, 0);
  console.log(
    [
      `枚举与库 CHECK 对账（库 ${db} ↔ 契约 packages/contract/src/enums）`,
      `  库里“列取值集合”形态的 CHECK ${dbEnumChecks.length} 条（多个取值 ${dbEnumChecks.length - singleValue}、单个取值 ${singleValue}），涉及 ${tables} 张表`,
      `  契约枚举 ${ENUMS.length} 个，绑定 ${bindings} 列`,
      `  名字写法的 CHECK 正则 ${formats} 条`,
      `  不算枚举、只列出：不是 text 的取值集合 ${nonText.length} 条${nonText.length > 0 ? `（${nonText.join("、")}）` : ""}；组合条件里带取值清单的 CHECK ${compound} 条（由所属列自己的 CHECK 覆盖）`,
    ].join("\n"),
  );
  if (problems.length > 0) {
    console.error(`\n枚举与库 CHECK 对账未通过：${problems.length} 处差异`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("\n枚举与库 CHECK 对账通过：0 差异");
}

// 只在被直接执行时跑；被用例 import 时不跑
const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
