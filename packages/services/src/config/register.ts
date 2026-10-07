// config 模块的登记（W0-24）：六条配置类不变量。调度在 invariant.full。
// 依据：14 分组 第 5.4 节（都是 P2、每日；对象不是某张表的一行，subject_type 为空、只写键）。
//   config.N9、N16、N17、N19、N20：W0-21 写成 SQL 断言的五条（invariants.ts），“现在”取框架给的业务时间。
//   config.N8：库里未撤销的参数值（生效中与待生效）满足参数定义，用读侧的自检（params.ts）。
// config.N7、N13、N15、N18 还没有实现，随用到它们的包。
import {
  defineRegistration,
  invariantNow,
  runSqlAssertion,
  dictReferencesPort,
  implementKeyed,
} from "../kernel/index.js";
import type { InvariantRegistration } from "../kernel/index.js";

import { createConfigCache } from "./cache.js";
import { configSeedAssertions } from "./invariants.js";
import { createParams } from "./params.js";
import { configDictReferences } from "./dict-references.js";

/** 写成 SQL 断言的那几条的编号；与 configSeedAssertions 给出的一一对应（用例核对） */
export const CONFIG_SQL_INVARIANTS = [
  "config.N9",
  "config.N16",
  "config.N17",
  "config.N19",
  "config.N20",
] as const;

const sqlInvariant = (code: string): InvariantRegistration => ({
  code,
  severity: "P2",
  modes: ["full"],
  heal: "none",
  run: async (tx, _scope, ctx) => {
    const assertion = configSeedAssertions(invariantNow(ctx)).find((item) => item.code === code);
    if (assertion === undefined) throw new Error(`${code} 没有对应的 SQL 断言`);
    return (await runSqlAssertion(tx, assertion)).map((row) => ({
      subject: { key: row.subjectKey },
      detail: { problem: row.detail },
    }));
  },
});

const paramValues: InvariantRegistration = {
  code: "config.N8",
  severity: "P2",
  modes: ["full"],
  heal: "none",
  run: async (tx, _scope, ctx) => {
    const now = invariantNow(ctx);
    const clock = { now: () => now };
    const params = createParams({
      db: tx,
      clock,
      cache: createConfigCache({ clock, redis: null }),
    });
    const problems = (await params.selfCheck()).filter(
      (problem) => problem.kind === "param_invalid_value",
    );
    // 同一个键的生效中与待生效两行都不合定义时并成一条（对象是参数键）
    const byKey = new Map<string, string[]>();
    for (const problem of problems) {
      byKey.set(problem.subject, [...(byKey.get(problem.subject) ?? []), problem.detail]);
    }
    return [...byKey].map(([key, details]) => ({
      subject: { key },
      detail: { problem: details.join("；") },
    }));
  },
};

export const registration = defineRegistration("config", {
  portImplementations: [implementKeyed(dictReferencesPort, "config", configDictReferences)],
  invariants: [paramValues, ...CONFIG_SQL_INVARIANTS.map(sqlInvariant)],
});
