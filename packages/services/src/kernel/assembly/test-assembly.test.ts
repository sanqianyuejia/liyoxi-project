import { describe, expect, it } from "vitest";

import { moduleRegistrations } from "../../assembly.js";
import { assembleForTest } from "../../testing/index.js";
import * as alpha from "./__fixtures__/lyxtest_alpha/index.js";
import * as beta from "./__fixtures__/lyxtest_beta/index.js";
import { AssemblyError } from "./assemble.js";
import { collectRegistrations } from "./collect.js";
import { defineRegistration, REGISTRATION_KINDS } from "./types.js";

// 任务书 第 7 节验收 1：测试装配的两个入口（模拟 api 与 worker）都能收集到两个样例模块的登记。
// 测试装配 = 真实模块的登记 + 追加的样例登记，走的是与生产相同的 assemble。

const extra = collectRegistrations({ lyxtest_alpha: alpha, lyxtest_beta: beta });

describe("测试装配：模拟 api 与 worker 两个入口", () => {
  it.each(["api", "worker"] as const)("%s：两个样例模块的登记都在", (entry) => {
    const assembly = assembleForTest({ entry, extra });
    expect(assembly.entry).toBe(entry);
    expect(assembly.appEnv).toBe("test");
    expect(assembly.modules).toEqual(
      [...moduleRegistrations().map((item) => item.module), "lyxtest_alpha", "lyxtest_beta"].sort(),
    );
    const mine = REGISTRATION_KINDS.map(
      (kind) => assembly[kind].filter((item) => item.module.startsWith("lyxtest_")).length,
    );
    // 订阅者 2、定时器处理器 2、周期任务 2（预发专用的那个不在）、端口实现 3、不变量 2、清理 2
    expect(mine).toEqual([2, 2, 2, 3, 2, 2]);
    expect(assembly.port(alpha.greeterPort).greet("狸")).toBe("你好，狸");
  });

  it("两个入口收到的内容相同", () => {
    const api = assembleForTest({ entry: "api", extra });
    const worker = assembleForTest({ entry: "worker", extra });
    for (const kind of REGISTRATION_KINDS) expect(api[kind]).toEqual(worker[kind]);
  });

  it("appEnv 写 stg 看得到预发专用的任务，写 prod 看不到", () => {
    const at = (appEnv: "stg" | "prod") =>
      assembleForTest({ entry: "worker", appEnv, extra }).recurringJob("lyxtest.stg_autorefund");
    expect(at("stg")?.module).toBe("lyxtest_alpha");
    expect(at("prod")).toBeUndefined();
  });

  it("isolated：只装追加的登记", () => {
    const assembly = assembleForTest({ entry: "api", extra, isolated: true });
    expect(assembly.modules).toEqual(["lyxtest_alpha", "lyxtest_beta"]);
  });

  it("样例之间撞名，照样启动失败", () => {
    const clash = defineRegistration("lyxtest_gamma", {
      recurringJobs: [{ kind: "lyxtest.sweep", run: async () => {} }],
    });
    expect(() => assembleForTest({ entry: "worker", extra: [...extra, clash] })).toThrow(
      AssemblyError,
    );
  });
});
