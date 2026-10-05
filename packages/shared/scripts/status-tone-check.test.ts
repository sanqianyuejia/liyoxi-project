// “状态字典键与契约枚举同名”检查的自测（任务书 W0-30a 第 7 节第 3 条）：真实的字典对真实的契约 0 差异；
// 改坏的字典（列名写错、取值不在枚举里、说明里的标记与契约对不上）各报得出来。不写死字典有几条。
import { describe, expect, it } from "vitest";

import {
  STATUS_TONE_GROUPS,
  UNBOUND_ENUM_NOTE,
  type StatusToneEntry,
  type StatusToneGroup,
} from "../src/design/status-tone/index.js";

import { checkStatusTone, type EnumLookup } from "./status-tone-check.js";

const side = { tone: "info", label: "样例" } as const;
const sample = (patch: Partial<StatusToneEntry>): StatusToneEntry => ({
  state: "样例状态",
  row: "样例状态",
  column: "lyxtest_order.status",
  values: ["open"],
  merchant: side,
  admin: side,
  ...patch,
});
const group = (...entries: StatusToneEntry[]): StatusToneGroup => ({
  key: "lyxtest",
  object: "样例对象",
  entries,
});
/** 样例契约：只有一列绑定了枚举 */
const lookup: EnumLookup = (column) =>
  column === "lyxtest_order.status"
    ? { name: "lyxtest_order_status", values: ["open", "closed", "void"] }
    : undefined;

describe("真实的字典对真实的契约", () => {
  const result = checkStatusTone();

  it("0 差异", () => {
    expect(result.problems).toEqual([]);
  });

  it("条目一个不漏：核对的、无枚举对应的、契约未绑定的，加起来是全部", () => {
    const all = STATUS_TONE_GROUPS.flatMap((item) => item.entries);
    const declared = all.filter(
      (entry) => entry.column !== null && entry.note?.startsWith(UNBOUND_ENUM_NOTE),
    );
    expect(result.checked).toBeGreaterThan(0);
    expect(result.checked + result.derived + declared.length).toBe(all.length);
    expect(result.derived).toBe(all.filter((entry) => entry.column === null).length);
    expect(result.unbound).toEqual([...new Set(declared.map((entry) => entry.column))].sort());
  });
});

describe("改坏的字典", () => {
  it("取值都在枚举之内：通过；枚举里字典没收的取值只列出", () => {
    const result = checkStatusTone([group(sample({}))], lookup);
    expect(result).toMatchObject({ problems: [], checked: 1, derived: 0, unbound: [] });
    expect(result.columns).toEqual(["lyxtest_order.status"]);
    expect(result.uncovered).toEqual(["lyxtest_order.status=closed", "lyxtest_order.status=void"]);
  });

  it("取值不在枚举之内：指出条目、取值与枚举", () => {
    const result = checkStatusTone([group(sample({ values: ["open", "opened"] }))], lookup);
    expect(result.problems).toEqual([
      "样例对象 · 样例状态（lyxtest）：取值 'opened' 不在契约枚举 lyxtest_order_status（lyxtest_order.status）的取值之内",
    ]);
  });

  it("列在契约里没有绑定枚举（列名写错）：报差异", () => {
    const result = checkStatusTone([group(sample({ column: "lyxtest_order.state" }))], lookup);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("lyxtest_order.state 在契约里没有绑定枚举");
    expect(result.checked).toBe(0);
  });

  it("说明以“契约未绑定枚举：”开头的条目：只列出，不算差异", () => {
    const entry = sample({ column: "lyxtest_task.intent", note: `${UNBOUND_ENUM_NOTE}出处` });
    const result = checkStatusTone([group(entry)], lookup);
    expect(result).toMatchObject({ problems: [], checked: 0, unbound: ["lyxtest_task.intent"] });
  });

  it("写了这句而契约里已经有了枚举：报差异，要把这句去掉", () => {
    const result = checkStatusTone([group(sample({ note: `${UNBOUND_ENUM_NOTE}出处` }))], lookup);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("契约里已经有枚举 lyxtest_order_status 绑定了");
  });

  it("没写“表.列”的条目不查", () => {
    const derived = sample({ column: null, values: [], note: "无枚举对应：样例" });
    expect(checkStatusTone([group(derived)], lookup)).toMatchObject({
      problems: [],
      checked: 0,
      derived: 1,
    });
  });
});
