import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./helpers.js";

// 授权下限清单 infra/ci/grants-floor.txt 对期望数据 packages/db/src/grants.expected.json 的核对（W0-06a）。不连库。
// 期望数据不是门禁文件：一个普通的 PR 把迁移、期望、测试里的数一起改，就能放开一张只增表而门禁改动分类不报。
// 下限清单是门禁文件（加行算只增，删行、改行算放松）：期望不得超过它写的上限，受限的表都得登记。
// 库里实际的授权对下限清单由核对脚本 db-verify-grants.mjs 管（用例在 db-verify-grants.test.ts）。
// 本文件不点名哪张表是什么权限：要改的表从期望数据里现挑。

interface Expected {
  tables: Record<string, string>;
  appendOnly: string[];
  columnUpdate: Record<string, string[]>;
  definerFunctions: Record<string, string[]>;
}
interface Floor {
  tables: Map<string, { max: string[]; columns: string[] }>;
  problems: string[];
}
interface Rules {
  FLOOR_FILE: string;
  parseFloor(text: string): Floor;
  floorProblems(floor: Floor, expected: Expected): string[];
}
const rules = (await import(
  pathToFileURL(join(repoRoot, "infra/ci/db-grants-rules.mjs")).href
)) as Rules;

const FULL = "DELETE,INSERT,SELECT,UPDATE";
const text = readFileSync(join(repoRoot, rules.FLOOR_FILE), "utf8");
const expected = JSON.parse(
  readFileSync(join(repoRoot, "packages/db/src/grants.expected.json"), "utf8"),
) as Expected;
const floor = rules.parseFloor(text);

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`期望数据里找不到${what}：这份用例要它来试`);
  return value;
}
/** 清单里这张表的上限是不是恰好只有插入与查询 */
const insertSelectOnly = (table: string): boolean =>
  floor.tables.get(table)?.max.join(",") === "INSERT,SELECT";
// 要试的表现挑，不点名：清单里上限恰好是 INSERT、SELECT 的只增表里，取一张不带例外列的、一张带例外列的。
// 以后哪张表的上限被门禁 PR 改大了，这里自动换下一张，不用跟着改
const appendOnly = need(
  expected.appendOnly.find(
    (table) => insertSelectOnly(table) && !Object.hasOwn(expected.columnUpdate, table),
  ),
  "上限是 INSERT、SELECT 的只增表",
);
const withColumns = need(
  expected.appendOnly.find(
    (table) => insertSelectOnly(table) && Object.hasOwn(expected.columnUpdate, table),
  ),
  "带例外列的只增表",
);
const regular = need(
  Object.keys(expected.tables).find((table) => expected.tables[table] === FULL),
  "常规读写的表",
);
/** 期望数据改一处（深拷贝之后改） */
function changed(change: (draft: Expected) => void): Expected {
  const draft = structuredClone(expected);
  change(draft);
  return draft;
}
/** 下限清单改一处：把某张表那一行换掉（给 null 就是删掉），或在末尾加几行 */
function floorWith(table: string | null, replacement: string | null, ...appended: string[]): Floor {
  const lines = text
    .split("\n")
    .flatMap((line) =>
      table !== null && line.startsWith(`${table} `)
        ? replacement === null
          ? []
          : [replacement]
        : [line],
    );
  return rules.parseFloor([...lines, ...appended].join("\n"));
}

describe("授权下限清单 grants-floor.txt", () => {
  it("写法合规，没有重复；期望数据没有超过它，受限的表都登记了", () => {
    expect(floor.problems).toEqual([]);
    expect(rules.floorProblems(floor, expected)).toEqual([]);
    const restricted = Object.keys(expected.tables).filter(
      (table) => expected.tables[table] !== FULL || expected.appendOnly.includes(table),
    );
    expect(restricted.length).toBeGreaterThan(0);
    expect(restricted.filter((table) => !floor.tables.has(table))).toEqual([]);
  });

  it("悄悄放开一张只增表（期望那一行改成全套读写，并从只增清单里拿掉）：不通过，指到这张表", () => {
    const opened = changed((draft) => {
      draft.tables[appendOnly] = FULL;
      draft.appendOnly = draft.appendOnly.filter((table) => table !== appendOnly);
    });
    expect(rules.floorProblems(floor, opened)).toEqual([
      `期望的授权超过下限清单（${rules.FLOOR_FILE}）：${appendOnly}（期望 ${FULL}，下限只许 INSERT,SELECT）`,
    ]);
    // 只多给一种权限、只多许一列也一样
    const oneMore = changed((draft) => {
      draft.tables[appendOnly] = "INSERT,SELECT,UPDATE";
    });
    expect(rules.floorProblems(floor, oneMore)).toEqual([
      expect.stringContaining(`${appendOnly}（期望 INSERT,SELECT,UPDATE，下限只许 INSERT,SELECT）`),
    ]);
    const oneColumn = changed((draft) => {
      draft.columnUpdate[appendOnly] = ["id"];
    });
    expect(rules.floorProblems(floor, oneColumn)).toEqual([
      `期望的授权超过下限清单（${rules.FLOOR_FILE}）：${appendOnly}.id（期望另有列级 UPDATE，下限没有许这一列）`,
    ]);
    const moreColumns = changed((draft) => {
      draft.columnUpdate[withColumns] = [...(draft.columnUpdate[withColumns] ?? []), "id"];
    });
    expect(rules.floorProblems(floor, moreColumns)).toEqual([
      expect.stringContaining(`${withColumns}.id（期望另有列级 UPDATE，下限没有许这一列）`),
    ]);
  });

  it("受限的表没有登记：新加一张受限的表而清单里没有它，或只从清单里删掉一行，都不通过", () => {
    const added = changed((draft) => {
      draft.tables.lyx_new_ledger = "INSERT,SELECT";
      draft.appendOnly.push("lyx_new_ledger");
    });
    expect(rules.floorProblems(floor, added)).toEqual([
      `受限的表没有登记进下限清单（${rules.FLOOR_FILE}）：lyx_new_ledger`,
    ]);
    expect(
      rules.floorProblems(floorWith(null, null, "lyx_new_ledger INSERT,SELECT"), added),
    ).toEqual([]);
    // 收紧一张原来常规读写的表：也要登记
    const tightened = changed((draft) => {
      draft.tables[regular] = "INSERT,SELECT,UPDATE";
    });
    expect(rules.floorProblems(floor, tightened)).toEqual([
      `受限的表没有登记进下限清单（${rules.FLOOR_FILE}）：${regular}`,
    ]);
    expect(rules.floorProblems(floorWith(appendOnly, null), expected)).toEqual([
      `受限的表没有登记进下限清单（${rules.FLOOR_FILE}）：${appendOnly}`,
    ]);
  });

  it("放开的走法：只把清单里那一行的上限改大而不动期望，没有问题；之后期望再跟着放开，也没有问题", () => {
    // 这一步是单独的 gate-change PR（改已有的行，门禁改动分类判放松）：它自己得是绿的
    const raised = floorWith(appendOnly, `${appendOnly} ${FULL}`);
    expect(rules.floorProblems(raised, expected)).toEqual([]);
    const opened = changed((draft) => {
      draft.tables[appendOnly] = FULL;
      draft.appendOnly = draft.appendOnly.filter((table) => table !== appendOnly);
    });
    expect(rules.floorProblems(raised, opened)).toEqual([]);
    // 彻底放开之后那一行可以删掉；表删了、上限已是全套读写的空行留着也不算问题
    expect(rules.floorProblems(floorWith(appendOnly, null), opened)).toEqual([]);
    expect(
      rules.floorProblems(floorWith(null, null, `lyx_dropped_table ${FULL}`), expected),
    ).toEqual([]);
    // 收紧不用先动清单：期望比清单更紧是允许的
    const tighter = changed((draft) => {
      delete draft.columnUpdate[withColumns];
    });
    expect(rules.floorProblems(floor, tighter)).toEqual([]);
  });

  it("清单写得不对：重复登记（加一行更宽的盖不掉原来那一行）、写法不合、登记了期望里没有的表", () => {
    const duplicated = floorWith(null, null, `${appendOnly} ${FULL}`);
    expect(duplicated.problems).toEqual([
      expect.stringMatching(new RegExp(`${appendOnly} 重复登记`)),
    ]);
    expect(rules.floorProblems(duplicated, expected)).toEqual([
      expect.stringContaining(`下限清单写得不对（${rules.FLOOR_FILE}）：`),
    ]);
    // 原来那一行仍然作数
    expect(duplicated.tables.get(appendOnly)?.max.join(",")).toBe("INSERT,SELECT");
    for (const bad of [
      `${regular}`,
      `${regular} ALL`,
      `${regular} select,insert`,
      `${regular}  INSERT,SELECT`,
      ` ${regular} INSERT,SELECT`,
      `${regular} INSERT,SELECT,TRUNCATE`,
      `${regular} INSERT,SELECT col-umn`,
    ])
      expect(floorWith(null, null, bad).problems, bad).toEqual([
        expect.stringMatching(/^第 \d+ 行写法不对$/),
      ]);
    expect(
      rules.floorProblems(floorWith(null, null, "lyx_ghost_table INSERT,SELECT"), expected),
    ).toEqual([`下限清单里有而期望清单里没有的表（${rules.FLOOR_FILE}）：lyx_ghost_table`]);
  });
});
