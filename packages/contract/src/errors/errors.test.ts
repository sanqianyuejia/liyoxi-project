// 领域错误码登记的自测（任务书 W0-09b 第 7 节第 1、10 条里不看文档的那一半）。
// 与登记文档、frag 的对账在 scripts/api-registries-check.ts（pnpm api-registries:check），它的用例在 src/api-registries.test.ts。
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  COMMON_ERRORS,
  DOMAIN_ERRORS,
  DOMAIN_ERROR_GROUPS,
  DOMAIN_ERROR_SYMBOLS,
  ERRORS,
  HTTP_STATUSES,
  domainErrorSource,
  isDomainErrorSymbol,
  isErrorSymbol,
  type DomainErrorSymbol,
  type ErrorCodeDef,
  type ErrorSymbol,
} from "./index.js";

const domainDir = join(dirname(fileURLToPath(import.meta.url)), "domain");
const domainFiles = readdirSync(domainDir)
  .filter((name) => name.endsWith(".ts") && name !== "index.ts")
  .map((name) => name.slice(0, -3))
  .sort();

/** 全部领域码，带上定义方 */
const all = DOMAIN_ERROR_GROUPS.flatMap((group) =>
  Object.entries<ErrorCodeDef>(group.errors).map(([symbol, def]) => ({
    symbol,
    def,
    source: group.source,
    ranges: group.ranges,
  })),
);
const repeated = (values: readonly (string | number)[]) => [
  ...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
];

describe("一个定义方文档一个文件，汇总自动收集", () => {
  it("目录里的文件与入口收的一一对应，定义方即文件名，按文档名排序", () => {
    expect(DOMAIN_ERROR_GROUPS.map((group) => group.source)).toEqual(domainFiles);
    for (const group of DOMAIN_ERROR_GROUPS) {
      expect(Object.keys(group.errors).length, group.source).toBeGreaterThan(0);
      expect(group.source).toMatch(/^[ahmp]\d\d-[a-z-]+$/);
    }
  });

  it("汇总不丢、不重：条数等于各文件之和；全部错误码 = 通用码 + 领域码", () => {
    expect(DOMAIN_ERROR_SYMBOLS).toHaveLength(all.length);
    expect(Object.keys(ERRORS)).toHaveLength(Object.keys(COMMON_ERRORS).length + all.length);
    for (const { symbol, def } of all) expect(DOMAIN_ERRORS[symbol as DomainErrorSymbol]).toBe(def);
  });
});

describe("符号与数值（约定 C25；裁决 A70）", () => {
  it("符号全大写蛇形，在通用码加领域码之内不重复", () => {
    const symbols = [...Object.keys(COMMON_ERRORS), ...all.map((item) => item.symbol)];
    expect(repeated(symbols)).toEqual([]);
    expect(symbols.filter((symbol) => !/^[A-Z][A-Z0-9_]*$/.test(symbol))).toEqual([]);
  });

  it("数值五位，在通用码加领域码之内不重复", () => {
    const codes = Object.values<ErrorCodeDef>(ERRORS).map((def) => def.code);
    expect(repeated(codes)).toEqual([]);
    expect(codes.filter((code) => !/^\d{5}$/.test(String(code)))).toEqual([]);
  });

  it("每个码都在定义方文档的取号区间内；各文档的区间互不重叠，也不落进通用码的段", () => {
    const outside = all
      .filter(({ def, ranges }) => !ranges.some(([from, to]) => def.code >= from && def.code <= to))
      .map(({ symbol, def, source }) => `${symbol} ${def.code}（${source}）`);
    expect(outside).toEqual([]);

    const ranges = DOMAIN_ERROR_GROUPS.flatMap((group) =>
      group.ranges.map(([from, to]) => ({ from, to, source: group.source })),
    ).sort((a, b) => a.from - b.from);
    for (const [index, range] of ranges.entries()) {
      expect(range.from, range.source).toBeLessThanOrEqual(range.to);
      const next = ranges[index + 1];
      if (next) expect(range.to, `${range.source} 与 ${next.source}`).toBeLessThan(next.from);
    }
    // 通用码用“HTTP 状态 × 100 + 序号”：40xxx、42xxx、50xxx 三段不分给领域码
    const commonSegments = new Set(
      Object.values<ErrorCodeDef>(COMMON_ERRORS).map((def) => Math.floor(def.code / 1000)),
    );
    expect(ranges.filter((range) => commonSegments.has(Math.floor(range.from / 1000)))).toEqual([]);
  });

  it("HTTP 在约定 C24 之内；默认文案不为空、句末不带句号、不夹表名与字段名", () => {
    for (const { symbol, def } of all) {
      expect(HTTP_STATUSES, symbol).toContain(def.http);
      expect([200, 202], symbol).not.toContain(def.http);
      expect(def.message.trim(), symbol).toBe(def.message);
      expect(def.message.length, symbol).toBeGreaterThan(3);
      expect(def.message, symbol).not.toMatch(/[。.]$/);
      // 给用户看的话：不出现反引号、下划线连着的标识符
      expect(def.message, symbol).not.toMatch(/`|[a-z]+_[a-z]+/);
    }
  });

  it("可重试为真的领域码都是服务端一侧稍后可能成功的（HTTP 5xx 或 409）", () => {
    const retryable = all.filter(({ def }) => def.retryable);
    expect(retryable.length).toBeGreaterThan(0);
    for (const { symbol, def } of retryable) expect([409, 500, 503], symbol).toContain(def.http);
  });
});

describe("查找", () => {
  it("按符号名判断与找定义方", () => {
    expect(isErrorSymbol("POINTS_INSUFFICIENT")).toBe(true);
    expect(isErrorSymbol("VALIDATION_FAILED")).toBe(true);
    expect(isDomainErrorSymbol("VALIDATION_FAILED")).toBe(false);
    expect(isErrorSymbol("NO_SUCH_ERROR")).toBe(false);
    expect(isErrorSymbol("toString")).toBe(false);
    expect(domainErrorSource("POINTS_INSUFFICIENT")).toBe("m07-billing");
    expect(domainErrorSource("VALIDATION_FAILED")).toBeUndefined();
    expect(ERRORS.POINTS_INSUFFICIENT).toMatchObject({ code: 43009, http: 409, hasDetails: true });
    expect(ERRORS.ACCOUNT_BUSY.retryable).toBe(true);
  });

  it("符号名是字面量类型：写错即编译不过", () => {
    const domain: DomainErrorSymbol = "QUOTE_CHANGED";
    const any: ErrorSymbol = "RATE_LIMITED";
    // @ts-expect-error 没登记的符号
    const unknown: ErrorSymbol = "NO_SUCH_ERROR";
    // @ts-expect-error 通用码不是领域码
    const common: DomainErrorSymbol = "RATE_LIMITED";
    expect([domain, any, unknown, common]).toHaveLength(4);
  });
});
