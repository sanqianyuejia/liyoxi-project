// 结构防漂移几个反例共用的两个库（W0-06b）。本文件不是反例（反例只收 cases/*.mjs）。
//
// 建库、跑迁移是这几例里最慢的一步，所以只做一遍：头一个用到的反例建“基准库”（空库上跑完全部迁移），
// 再从它拷一个“改过的库”，把下面几处一次改完；之后的反例都对着这两个库跑，各自只认自己那一处的报错。
// 两个库都以 lyx_selftest_ 开头、带进程号，门禁自测退出时删掉；不碰共享的 lyx_schema_check、lyx_migrate_check。
// 改了什么（对象都从基准库的结构里现挑，不点名：以后加表、改索引的包不用回来改这里）：
//   - 删一个不唯一的部分索引；一列 integer 改成 bigint；
//   - 停用一个触发器；把另一个触发器调的函数换成空函数（名字、参数不变）；
//   - 删掉最远的那个月的分区；往兜底分区写一行。
// 要本地那套 PostgreSQL 在运行（pnpm infra:up），并给出 DATABASE_URL 或 PG* 环境变量（CLAUDE.md 第 9 节）；
// 连不上时用到它的反例会红，不会被悄悄跳过。

import { dropDb, psql, recreateDb, sqlOrThrow } from "../../db-lib.mjs";
import {
  applyMigrations,
  expectedMonths,
  readPartitions,
  readStructure,
} from "../../db-structure-lib.mjs";

const BASE = `lyx_selftest_struct_${process.pid}`;
const MUTATED = `${BASE}_mutated`;
let fixture = null;

function pick(base) {
  const { sections } = readStructure(base);
  const ordinary = (table) => sections.tables.find((row) => row.key === table)?.def.kind === "r";
  const index = sections.indexes.find(
    (row) =>
      / WHERE /.test(row.def.definition) &&
      !row.def.unique &&
      !row.def.exclusion &&
      ordinary(row.def.table),
  )?.key;
  const column = sections.columns
    .filter((row) => row.def.type === "integer" && ordinary(row.key.split(".")[0]))
    .map((row) => row.key.split("."))
    .find(
      ([table, name]) =>
        psql(base, `begin;\nALTER TABLE ${table} ALTER COLUMN ${name} TYPE bigint;\nrollback;`)
          .status === 0,
    );
  // 两个触发器：一个拿来停用；另一个调的函数拿来换成空函数（不带参数的触发器函数）
  const triggers = sections.triggers
    .map((row) => [
      ...row.key.split("."),
      row.def.definition.match(/EXECUTE FUNCTION (\w+)\(\)$/)?.[1],
    ])
    .filter(([table, , fn]) => fn && ordinary(table));
  const disabled = triggers[0];
  const emptied = triggers.find(([, , fn]) => fn !== disabled?.[2])?.[2];
  const info = readPartitions(base);
  const parent = info.parents[0]?.name;
  const month = `${parent}_${expectedMonths(info.today).at(-1).suffix}`;
  if (!index || !column || !disabled || !emptied || !parent) {
    throw new Error("基准库里挑不出要动手脚的对象（部分索引、integer 列、两个触发器、分区表）");
  }
  return { index, column, trigger: disabled.slice(0, 2), fn: `${emptied}()`, parent, month };
}

/** { base, mutated, picks }：两个库的名字，与改了哪几个对象。头一次调用时建，之后复用 */
export function structureFixture() {
  if (fixture) return fixture;
  process.on("exit", () => {
    for (const db of [MUTATED, BASE]) {
      try {
        dropDb(db);
      } catch {
        // 退出时删不掉就留着：库名带进程号，不会被下一次运行误用
      }
    }
  });
  recreateDb(BASE);
  applyMigrations(BASE);
  const picks = pick(BASE);
  recreateDb(MUTATED, { template: BASE });
  sqlOrThrow(
    MUTATED,
    [
      `DROP INDEX ${picks.index}`,
      `ALTER TABLE ${picks.column[0]} ALTER COLUMN ${picks.column[1]} TYPE bigint`,
      `ALTER TABLE ${picks.trigger[0]} DISABLE TRIGGER ${picks.trigger[1]}`,
      `CREATE OR REPLACE FUNCTION ${picks.fn} RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,
      `DROP TABLE ${picks.month}`,
      // 发生时间取 2000 年：没有哪个月分区接得住，落进兜底分区
      `insert into ${picks.parent} (occurred_at, id, event_id, name, source, actor_type)
         values ('2000-01-01T00:00:00Z', gen_random_uuid(), 'selftest-' || gen_random_uuid(), 'selftest_struct', 'direct', 'system')`,
    ].join(";\n"),
  );
  fixture = { base: BASE, mutated: MUTATED, picks };
  return fixture;
}

/**
 * 对两个库各跑一遍同一个检查：基准库上必须通过（否则改过的库上的失败说明不了什么），返回改过的库上的结果。
 * marks 是接在输出末尾的几行“反例动的是哪个对象”，反例的 reason 用反向引用把报错里的名字与它对上。
 */
export function checkMutated(ctx, script, marks) {
  const { base, mutated, picks } = structureFixture();
  const clean = ctx.node(script, [
    "--db",
    base,
    ...(script.includes("snapshot") ? ["--check"] : []),
  ]);
  if (clean.status !== 0) {
    throw new Error(
      `没动过的库上检查就不通过：${clean.output.trim().split("\n").slice(-3).join(" ")}`,
    );
  }
  const result = ctx.node(script, [
    "--db",
    mutated,
    ...(script.includes("snapshot") ? ["--check"] : []),
  ]);
  // 退出码 2 是环境问题（连不上库），不算“检查失败”
  if (result.status === 2) throw new Error(result.output.trim().split("\n").slice(-2).join(" "));
  const lines = marks(picks).map((mark) => `反例动的是：${mark}`);
  return { status: result.status, output: `${result.output}\n${lines.join("\n")}\n` };
}
