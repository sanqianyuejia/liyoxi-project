import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { countFailure, isLocked, LOCK_MS, LOCK_THRESHOLD } from "./lockout.js";
import type { BucketState } from "./lockout.js";

// D4 第 11.1 节“后台登录锁定”的性质，落在记失败的纯函数上（连库的那一半在 auth.db.test.ts、auth.concurrency.test.ts）。
// 轮次与种子的约定同 packages/shared：PR 上固定种子、每个性质 200 轮；要加大或复现用环境变量，例：
//   LYX_FC_RUNS=5000 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/staff/lockout.property.test.ts
const runs = {
  numRuns: Number(process.env.LYX_FC_RUNS ?? 200),
  seed: Number(process.env.LYX_FC_SEED ?? 20261006),
};
const slow = { timeout: 60_000 };
const START = Date.parse("2026-01-05T04:00:00.000Z");
const EMPTY: BucketState = { fails: 0, lockedUntil: null };

/** 一串操作：哪个桶失败一次，或成功登录一次；每步之前时钟走几秒（0 到 20 分钟） */
const steps = fc.array(
  fc.record({
    wait: fc.integer({ min: 0, max: 20 * 60 }),
    action: fc.constantFrom("fail_untrusted", "fail_trusted", "success"),
  }),
  { maxLength: 60 },
);

describe("分桶锁定：性质", () => {
  it("任意失败序列：一个桶的失败不动另一个桶；计数不超过阈值；锁上那一次恰锁 15 分钟", slow, () => {
    fc.assert(
      fc.property(steps, (sequence) => {
        let at = START;
        let trusted = EMPTY;
        let untrusted = EMPTY;
        for (const step of sequence) {
          at += step.wait * 1000;
          const now = new Date(at);
          if (step.action === "success") {
            // 成功登录的前提是所用的桶没锁；这里按“可信设备上成功”算，两桶清零
            if (isLocked(trusted, now)) continue;
            trusted = EMPTY;
            untrusted = EMPTY;
            continue;
          }
          const mine = step.action === "fail_trusted" ? trusted : untrusted;
          const other = step.action === "fail_trusted" ? untrusted : trusted;
          const wasLocked = isLocked(mine, now);
          const next = countFailure(mine, now);
          if (step.action === "fail_trusted") trusted = next;
          else untrusted = next;

          // 另一个桶原样不动
          expect(step.action === "fail_trusted" ? untrusted : trusted).toBe(other);
          expect(next.fails).toBeGreaterThanOrEqual(1);
          expect(next.fails).toBeLessThanOrEqual(LOCK_THRESHOLD);
          if (wasLocked) {
            // 锁定中：不计数、不顺延、不再报“刚锁上”
            expect(next).toMatchObject({
              fails: mine.fails,
              lockedUntil: mine.lockedUntil,
              lockedNow: false,
            });
          } else {
            expect(next.lockedNow).toBe(next.fails === LOCK_THRESHOLD);
            expect(next.lockedUntil?.getTime() ?? null).toBe(next.lockedNow ? at + LOCK_MS : null);
          }
        }
      }),
      runs,
    );
  });

  it("陌生来源桶无论失败多少次，可信设备桶都不会被锁", slow, () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 3600 }), { maxLength: 80 }), (waits) => {
        let at = START;
        let untrusted = EMPTY;
        const trusted = EMPTY;
        for (const wait of waits) {
          at += wait * 1000;
          untrusted = countFailure(untrusted, new Date(at));
          expect(isLocked(trusted, new Date(at))).toBe(false);
        }
      }),
      runs,
    );
  });
});

describe("分桶锁定：固定用例", () => {
  const at = (ms: number) => new Date(START + ms);

  it("连续 5 次失败锁 15 分钟；到期后从头计", () => {
    let state: ReturnType<typeof countFailure> = { ...EMPTY, lockedNow: false };
    for (let index = 1; index <= 4; index += 1) {
      state = countFailure(state, at(index));
      expect(state).toEqual({ fails: index, lockedUntil: null, lockedNow: false });
    }
    state = countFailure(state, at(5));
    expect(state).toEqual({ fails: 5, lockedUntil: at(5 + LOCK_MS), lockedNow: true });
    expect(isLocked(state, at(5 + LOCK_MS - 1))).toBe(true);
    expect(isLocked(state, at(5 + LOCK_MS))).toBe(false);
    expect(countFailure(state, at(6))).toEqual({
      fails: 5,
      lockedUntil: at(5 + LOCK_MS),
      lockedNow: false,
    });
    expect(countFailure(state, at(5 + LOCK_MS))).toEqual({
      fails: 1,
      lockedUntil: null,
      lockedNow: false,
    });
  });
});
