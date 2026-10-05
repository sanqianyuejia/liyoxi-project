import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { uuidv7 } from "./ids.js";

// 验收第 8 条（甲类的性质测试）：版本位是 7、变体位正确；同一进程连续生成的值按字典序严格递增；10 万个不重复。
// 轮次与种子的约定同 packages/shared：PR 上固定种子、每个性质 200 轮；要加大或复现用环境变量，例：
//   LYX_FC_RUNS=5000 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/kernel/ids.property.test.ts
// 种子只决定每一轮生成多少个；值本身来自系统时钟与 crypto 的随机数。失败时把反例固化成下面的固定用例再修。
const runs = {
  numRuns: Number(process.env.LYX_FC_RUNS ?? 200),
  seed: Number(process.env.LYX_FC_SEED ?? 20261005),
};

/** 8-4-4-4-12 的小写十六进制；第三段首位是版本 7，第四段首位是变体 10xx（8、9、a、b） */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timestampOf = (id: string): number => Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
const batch = (size: number): string[] => Array.from({ length: size }, () => uuidv7());

function expectStrictlyIncreasing(ids: readonly string[]): void {
  for (let index = 1; index < ids.length; index += 1) {
    if (!((ids[index - 1] as string) < (ids[index] as string))) {
      throw new Error(`第 ${index} 个不大于前一个：${ids[index - 1]} → ${ids[index]}`);
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("uuidv7：性质", () => {
  it("版本位是 7、变体位是 10；时间戳取自系统时钟", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (size) => {
        const before = Date.now();
        const ids = batch(size);
        const after = Date.now();
        // 同一毫秒发得太多会借后面的毫秒，上界留一秒的余量。不逐个走 expect：几万个值，慢
        const bad = ids.filter((id) => {
          const at = timestampOf(id);
          return !UUID_V7.test(id) || at < before || at > after + 1_000;
        });
        expect(bad).toEqual([]);
      }),
      runs,
    );
  });

  it("同一进程连续生成的值按字典序严格递增（跨批次也是）", () => {
    let previous = uuidv7();
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3_000 }), (size) => {
        const ids = [previous, ...batch(size)];
        expectStrictlyIncreasing(ids);
        previous = ids.at(-1) as string;
      }),
      runs,
    );
  });

  it("10 万个不重复，且整体严格递增", () => {
    const ids = batch(100_000);
    expect(new Set(ids).size).toBe(100_000);
    expectStrictlyIncreasing(ids);
  });
});

describe("uuidv7：固定用例", () => {
  it("同一毫秒里发 1 万个（序号 12 位，用完借下一毫秒）：仍严格递增、不重复", () => {
    const frozen = Date.now() + 60_000;
    vi.spyOn(Date, "now").mockReturnValue(frozen);
    const ids = batch(10_000);
    expectStrictlyIncreasing(ids);
    expect(new Set(ids).size).toBe(10_000);
    expect(timestampOf(ids[0] as string)).toBe(frozen);
    // 1 万个至少跨 2 个毫秒、至多 4 个（第一个毫秒的序号从随机数起步，至少 2048 个）
    const borrowed = timestampOf(ids.at(-1) as string) - frozen;
    expect(borrowed).toBeGreaterThanOrEqual(2);
    expect(borrowed).toBeLessThanOrEqual(4);
  });

  it("系统时钟回拨：不跟着退，接着往上数", () => {
    const base = Date.now() + 120_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(base);
    const first = uuidv7();
    now.mockReturnValue(base - 5_000);
    const second = uuidv7();
    expect(first < second).toBe(true);
    expect(timestampOf(second)).toBe(base);
    now.mockReturnValue(base + 1);
    const third = uuidv7();
    expect(second < third).toBe(true);
    expect(timestampOf(third)).toBe(base + 1);
  });

  it("PostgreSQL 的 uuid 比较与字符串比较一致：值都是小写、定长", () => {
    for (const id of batch(1_000)) expect(id).toBe(id.toLowerCase());
  });
});
