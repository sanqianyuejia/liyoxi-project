import { ADMIN_FORCE_EVENT, chainOf, CHAINS } from "@liyoxi/shared/machines";
import { describe, expect, it } from "vitest";

import type { Events } from "../events/index.js";
import { createFlow, rowKey } from "../flow/index.js";
import { assembleForTest } from "./assembly.js";
import { createClock } from "./clock.js";
import { sampleFlowRegistration, sampleGuards } from "./flow.js";

// 样例守卫（KF-1）：链上有人工纠偏（admin.force）行时，sampleGuards 不给它登记守卫。
// 登记了的话 createFlow 在核对状态机登记时会当成“不是这条链上的行”拒掉，带这种行的链拿它当样例就用不了。
// 不连库：只到 createFlow 核对登记为止。

/** 带人工纠偏行的链，从迁移表里现找：以后哪条链加了这种行，自动进来 */
const withForceRows = CHAINS.filter((chain) =>
  chain.rows.some((row) => row.event === ADMIN_FORCE_EVENT),
);

describe("sampleGuards", () => {
  it("迁移表里有带人工纠偏行的链（客服工单在内）", () => {
    expect(withForceRows.map((chain) => chain.machine)).toContain("service_ticket");
  });

  it.each(
    // 键的写法同 chainKey(状态机, 状态列)；这里的链是从迁移表里遍历出来的，状态列只有 string 类型
    withForceRows.map((chain) => [`${chain.machine}.${chain.stateField}`, chain] as const),
  )("%s：写了守卫的普通行都登记，人工纠偏的行一行不登记；拿去建 flow 不抛错", (key, chain) => {
    const guards = sampleGuards(chain);
    const expected = chain.rows
      .filter((row) => row.guard && row.event !== ADMIN_FORCE_EVENT)
      .map((row) => rowKey(row.ref, row.event));
    expect(Object.keys(guards).sort()).toEqual([...new Set(expected)].sort());
    expect(Object.keys(guards).some((name) => name.includes(ADMIN_FORCE_EVENT))).toBe(false);

    const assembly = assembleForTest({
      entry: "api",
      extra: [sampleFlowRegistration({ bindings: { [key]: { guards } } })],
    });
    // createFlow 构造时核对登记；用不到 events 的方法
    expect(() =>
      createFlow({ assembly, clock: createClock(), events: {} as Events }),
    ).not.toThrow();
  });

  it("没有人工纠偏行的链不受影响：写了守卫的行都登记", () => {
    const chain = chainOf("staff", "status");
    expect(Object.keys(sampleGuards(chain))).toHaveLength(
      new Set(chain.rows.filter((row) => row.guard).map((row) => rowKey(row.ref, row.event))).size,
    );
  });
});
