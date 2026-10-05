import { describe, expect, it } from "vitest";

import { APP_ENVS } from "../env.js";
import type { AppEnv } from "../env.js";
import type { Tx } from "../tx.js";
import * as alpha from "./__fixtures__/lyxtest_alpha/index.js";
import * as beta from "./__fixtures__/lyxtest_beta/index.js";
import { assemble, AssemblyError } from "./assemble.js";
import type { AssemblyIssue } from "./assemble.js";
import { auditModuleEntries, collectRegistrations, RegistrationShapeError } from "./collect.js";
import { defineRegistration, implement, implementKeyed, REGISTRATION_KINDS } from "./types.js";
import type { Assembly, AssemblyEntry, ModuleRegistration } from "./types.js";

// 任务书 第 7 节验收 1–4：两个样例模块、两个入口；重名；缺实现；按环境过滤。都不连库。

/** 两个样例模块的入口，照组合根的写法：整体引入，键是目录名 */
const SAMPLE_ENTRIES = { lyxtest_alpha: alpha, lyxtest_beta: beta };
const samples = (): ModuleRegistration[] => collectRegistrations(SAMPLE_ENTRIES);

const assembleSamples = (entry: AssemblyEntry, appEnv: AppEnv = "test"): Assembly =>
  assemble({ entry, appEnv, registrations: samples() });

/** 装配必须失败：取回全部问题 */
function issuesOf(registrations: readonly ModuleRegistration[], appEnv: AppEnv = "test") {
  try {
    assemble({ entry: "api", appEnv, registrations });
  } catch (error) {
    if (error instanceof AssemblyError) return error.issues;
    throw error;
  }
  throw new Error("装配本该失败，却通过了");
}

const pick = (issues: readonly AssemblyIssue[]) =>
  issues.map(({ category, name, modules, reason }) => ({ category, name, modules, reason }));

const tx = {} as unknown as Tx;
const noop = async (): Promise<void> => {};
/** 一个只为撞名而建的模块 */
const other = (parts: Parameters<typeof defineRegistration>[1]): ModuleRegistration =>
  defineRegistration("lyxtest_gamma", parts);

describe("收集：从模块入口里取 registration", () => {
  it("两个样例模块各带一个 register.ts，经各自的入口收到；没有登记的模块略过", () => {
    const collected = collectRegistrations({ ...SAMPLE_ENTRIES, lyxtest_plain: {} });
    expect(collected.map((item) => item.module)).toEqual(["lyxtest_alpha", "lyxtest_beta"]);
    expect(collected[0]).toBe(alpha.registration);
    expect(collected[1]).toBe(beta.registration);
  });

  it("入口给出的 registration 不是 defineRegistration 的结果：报错并指出模块", () => {
    expect(() => collectRegistrations({ lyxtest_bad: { registration: { module: 1 } } })).toThrow(
      RegistrationShapeError,
    );
    expect(() => collectRegistrations({ lyxtest_bad: { registration: [] } })).toThrow(
      /模块 lyxtest_bad .*要用 defineRegistration 造/,
    );
  });

  it("登记的模块名与目录名不同：报错", () => {
    expect(() => collectRegistrations({ lyxtest_renamed: alpha })).toThrow(
      /模块 lyxtest_renamed .*模块名写的是 lyxtest_alpha，要与目录名相同/,
    );
  });
});

describe("入口清单与模块目录对账", () => {
  const directories = [
    { name: "lyxtest_alpha", hasRegisterFile: true },
    { name: "lyxtest_beta", hasRegisterFile: true },
    { name: "lyxtest_plain", hasRegisterFile: false },
  ];

  it("一致：没有问题", () => {
    expect(auditModuleEntries({ ...SAMPLE_ENTRIES, lyxtest_plain: {} }, directories)).toEqual([]);
  });

  it("有 register.ts 而入口没给出 registration：查得出来", () => {
    expect(
      auditModuleEntries(
        { lyxtest_alpha: alpha, lyxtest_beta: {}, lyxtest_plain: {} },
        directories,
      ),
    ).toEqual([
      "模块 lyxtest_beta 有 register.ts，入口 index.ts 却没有给出 registration：登记收不到",
    ]);
  });

  it("清单多一个、少一个，入口给出了登记却没有 register.ts：各报一条", () => {
    expect(
      auditModuleEntries(
        { lyxtest_alpha: alpha, lyxtest_plain: beta, lyxtest_gone: {} },
        directories,
      ),
    ).toEqual([
      "组合根清单里的 lyxtest_gone 没有对应的模块目录",
      "模块目录 lyxtest_beta 不在组合根的清单里",
      "模块 lyxtest_plain 的入口给出了 registration，目录里却没有 register.ts：登记要写在 register.ts 里",
    ]);
  });
});

describe("装配：两个入口都能收集到", () => {
  it("api 与 worker 装配出的六类登记项相同", () => {
    const api = assembleSamples("api");
    const worker = assembleSamples("worker");
    expect(api.entry).toBe("api");
    expect(worker.entry).toBe("worker");
    for (const kind of REGISTRATION_KINDS) expect(api[kind]).toEqual(worker[kind]);
    expect(api.modules).toEqual(worker.modules);
    expect(api.ports).toEqual(worker.ports);
  });

  it.each(["api", "worker"] as const)("%s：条数与名字对得上，每项带着所属模块", (entry) => {
    const assembly = assembleSamples(entry);
    expect(assembly.appEnv).toBe("test");
    expect(assembly.modules).toEqual(["lyxtest_alpha", "lyxtest_beta"]);
    const named = <T extends { module: string }>(
      items: readonly T[],
      nameOf: (item: T) => string,
    ) => items.map((item) => `${nameOf(item)}@${item.module}`);

    expect(named(assembly.subscribers, (item) => item.name)).toEqual([
      "lyxtest.onPingAlpha@lyxtest_alpha",
      "lyxtest.onPingBeta@lyxtest_beta",
    ]);
    expect(named(assembly.timerHandlers, (item) => item.kind)).toEqual([
      "lyxtest.followup@lyxtest_beta",
      "lyxtest.remind@lyxtest_alpha",
    ]);
    expect(named(assembly.recurringJobs, (item) => item.kind)).toEqual([
      "lyxtest.digest@lyxtest_beta",
      "lyxtest.sweep@lyxtest_alpha",
    ]);
    expect(named(assembly.invariants, (item) => item.code)).toEqual([
      "lyxtest.I1@lyxtest_alpha",
      "lyxtest.I2@lyxtest_beta",
    ]);
    expect(named(assembly.cleanups, (item) => item.name)).toEqual([
      "lyxtest.alpha_rows@lyxtest_alpha",
      "lyxtest.beta_rows@lyxtest_beta",
    ]);
    expect(
      named(assembly.portImplementations, (item) => `${item.port.name}#${item.key ?? ""}`),
    ).toEqual([
      "lyxtest.executor#cancel@lyxtest_beta",
      "lyxtest.executor#refund@lyxtest_beta",
      "lyxtest.greeter#@lyxtest_beta",
    ]);
    expect(named(assembly.ports, (item) => item.port.name)).toEqual([
      "lyxtest.executor@lyxtest_alpha",
      "lyxtest.greeter@lyxtest_alpha",
      "lyxtest.meter@lyxtest_alpha",
    ]);
  });

  it("装配结果里拿到的就是登记的处理函数", async () => {
    const assembly = assembleSamples("worker");
    const event = { id: "e1", type: "lyxtest.ping", payload: { v: 1 } };
    const timer = { id: "t1", kind: "", subjectType: null, subjectId: null, payload: null };
    alpha.calls.length = 0;
    beta.calls.length = 0;

    await assembly.subscriber("lyxtest.onPingAlpha")?.handle(tx, event);
    await assembly.subscriber("lyxtest.onPingBeta")?.handle(tx, event);
    const remind = assembly.timerHandler("lyxtest.remind");
    const followup = assembly.timerHandler("lyxtest.followup");
    expect(await remind?.handle(tx, { ...timer, kind: "lyxtest.remind" })).toBe("fired");
    expect(await followup?.handle(tx, { ...timer, kind: "lyxtest.followup" })).toBe("skipped");
    const scheduledFor = new Date("2026-10-05T00:00:00Z");
    expect(await assembly.recurringJob("lyxtest.sweep")?.run({ scheduledFor })).toEqual({
      swept: 0,
    });
    expect(await assembly.recurringJob("lyxtest.digest")?.run({ scheduledFor })).toBeUndefined();
    expect(await assembly.invariant("lyxtest.I2")?.run?.(tx, {})).toHaveLength(1);
    expect(
      await assembly.cleanup("lyxtest.beta_rows")?.run(tx, { now: scheduledFor, limit: 10 }),
    ).toBe(3);

    expect(alpha.calls).toEqual([
      "alpha.onPing:lyxtest.ping",
      "alpha.remind:lyxtest.remind",
      "alpha.sweep",
    ]);
    expect(beta.calls).toEqual([
      "beta.onPing:lyxtest.ping",
      "beta.followup:lyxtest.followup",
      "beta.digest",
    ]);
    expect(assembly.subscriber("lyxtest.nobody")).toBeUndefined();
  });

  it("端口：下层定义、上层实现；按键的端口按键取", () => {
    const assembly = assembleSamples("api");
    expect(assembly.port(alpha.greeterPort).greet("狸")).toBe("你好，狸");
    const executors = assembly.portEntries(alpha.executorPort);
    expect([...executors.keys()]).toEqual(["cancel", "refund"]);
    expect(executors.get("refund")?.("x")).toBe("refund:x");
  });

  it("入口或环境写错：直接抛错", () => {
    const registrations = samples();
    expect(() =>
      assemble({ entry: "cli" as AssemblyEntry, appEnv: "test", registrations }),
    ).toThrow(/装配入口只能是 api、worker/);
    expect(() => assemble({ entry: "api", appEnv: "production" as AppEnv, registrations })).toThrow(
      /环境只能是/,
    );
  });
});

describe("重名：启动失败", () => {
  it.each([
    [
      "订阅者",
      other({
        subscribers: [{ name: "lyxtest.onPingAlpha", events: ["lyxtest.ping"], handle: noop }],
      }),
      { category: "subscriber", name: "lyxtest.onPingAlpha" },
    ],
    [
      "定时器处理器",
      other({ timerHandlers: [{ kind: "lyxtest.remind", handle: async () => "fired" as const }] }),
      { category: "timerHandler", name: "lyxtest.remind" },
    ],
    [
      "周期任务",
      other({ recurringJobs: [{ kind: "lyxtest.sweep", run: noop }] }),
      { category: "recurringJob", name: "lyxtest.sweep" },
    ],
    [
      "不变量",
      other({ invariants: [{ code: "lyxtest.I1", severity: "P2", modes: [] }] }),
      { category: "invariant", name: "lyxtest.I1" },
    ],
    [
      "清理",
      other({ cleanups: [{ name: "lyxtest.alpha_rows", every: "day", run: async () => 0 }] }),
      { category: "cleanup", name: "lyxtest.alpha_rows" },
    ],
  ] as const)("%s：两个模块登记同名项", (_label, extra, expected) => {
    expect(pick(issuesOf([...samples(), extra]))).toEqual([
      {
        ...expected,
        modules: ["lyxtest_alpha", "lyxtest_gamma"],
        reason: "重名：登记了 2 次",
      },
    ]);
  });

  it("端口实现：单实现的端口有两个模块实现；按键的端口同一个键登记两次", () => {
    const extra = other({
      portImplementations: [
        implement(alpha.greeterPort, { greet: () => "" }),
        implementKeyed(alpha.executorPort, "refund", () => ""),
      ],
    });
    expect(pick(issuesOf([...samples(), extra]))).toEqual([
      {
        category: "portImplementation",
        name: "lyxtest.executor#refund",
        modules: ["lyxtest_beta", "lyxtest_gamma"],
        reason: "重名：登记了 2 次",
      },
      {
        category: "portImplementation",
        name: "lyxtest.greeter",
        modules: ["lyxtest_beta", "lyxtest_gamma"],
        reason: "重名：登记了 2 次",
      },
    ]);
  });

  it("定时器处理器与周期任务共用 timer.kind：互相撞名也算", () => {
    const extra = other({ recurringJobs: [{ kind: "lyxtest.remind", run: noop }] });
    expect(pick(issuesOf([...samples(), extra]))).toEqual([
      {
        category: "timerKind",
        name: "lyxtest.remind",
        modules: ["lyxtest_alpha", "lyxtest_gamma"],
        reason: "重名：同一个 kind 既是定时器处理器又是周期任务",
      },
    ]);
  });

  it("同一个模块里登记两次、模块重名、端口声明两次，都算", () => {
    const twice = other({
      cleanups: [
        { name: "lyxtest.gamma_rows", every: "day", run: async () => 0 },
        { name: "lyxtest.gamma_rows", every: "hour", run: async () => 0 },
      ],
      ports: [alpha.meterPort],
    });
    expect(pick(issuesOf([...samples(), twice, defineRegistration("lyxtest_gamma")]))).toEqual([
      {
        category: "module",
        name: "lyxtest_gamma",
        modules: ["lyxtest_gamma"],
        reason: "重名：这个模块名有 2 份登记",
      },
      {
        category: "port",
        name: "lyxtest.meter",
        modules: ["lyxtest_alpha", "lyxtest_gamma"],
        reason: "重名：端口被声明了多次",
      },
      {
        category: "cleanup",
        name: "lyxtest.gamma_rows",
        modules: ["lyxtest_gamma"],
        reason: "重名：登记了 2 次",
      },
    ]);
  });

  it("问题一次报全，报错信息写明哪一类、什么名字、哪些模块", () => {
    const extra = other({
      subscribers: [{ name: "lyxtest.onPingBeta", events: ["lyxtest.ping"], handle: noop }],
      recurringJobs: [{ kind: "lyxtest.digest", run: noop }],
    });
    let message = "";
    try {
      assemble({ entry: "worker", appEnv: "test", registrations: [...samples(), extra] });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toBe(
      [
        "服务装配失败，共 2 处：",
        "  - [订阅者] lyxtest.onPingBeta：重名：登记了 2 次；模块：lyxtest_beta、lyxtest_gamma",
        "  - [周期任务] lyxtest.digest：重名：登记了 2 次；模块：lyxtest_beta、lyxtest_gamma",
      ].join("\n"),
    );
  });
});

describe("缺实现：启动失败", () => {
  it("端口没有默认实现，也没有模块实现它：指出端口名与声明它的模块", () => {
    // 只装 alpha：greeter 没人实现
    expect(pick(issuesOf([alpha.registration]))).toEqual([
      {
        category: "port",
        name: "lyxtest.greeter",
        modules: ["lyxtest_alpha"],
        reason: "缺实现：端口没有默认实现，也没有模块实现它",
      },
    ]);
  });

  it("有默认实现的端口：没人实现时走默认，有人实现后由实现接管", () => {
    expect(assembleSamples("api").port(alpha.meterPort).count()).toBe(0);

    const extra = other({ portImplementations: [implement(alpha.meterPort, { count: () => 7 })] });
    const assembly = assemble({
      entry: "api",
      appEnv: "test",
      registrations: [...samples(), extra],
    });
    expect(assembly.port(alpha.meterPort).count()).toBe(7);
  });

  it("按键的端口可以一个实现都没有", () => {
    const lonely = defineRegistration("lyxtest_alpha", { ports: [alpha.executorPort] });
    const assembly = assemble({ entry: "api", appEnv: "test", registrations: [lonely] });
    expect(assembly.portEntries(alpha.executorPort).size).toBe(0);
  });

  it("登记项没给处理函数：六类各一例", () => {
    /** 类型上骗过去：登记时把处理函数漏掉了 */
    const missing = <T>(): T => undefined as unknown as T;
    const extra = other({
      subscribers: [{ name: "lyxtest.onNothing", events: ["lyxtest.ping"], handle: missing() }],
      timerHandlers: [{ kind: "lyxtest.nothing", handle: missing() }],
      recurringJobs: [{ kind: "lyxtest.nothing_job", run: missing() }],
      portImplementations: [implementKeyed(alpha.executorPort, "nothing", missing())],
      invariants: [{ code: "lyxtest.I9", severity: "P2", modes: ["full"] }],
      cleanups: [{ name: "lyxtest.nothing_rows", every: "day", run: missing() }],
    });
    expect(
      pick(issuesOf([...samples(), extra])).map(({ category, reason }) => `${category}｜${reason}`),
    ).toEqual([
      "subscriber｜缺实现：没有给 handle",
      "timerHandler｜缺实现：没有给 handle",
      "recurringJob｜缺实现：没有给 run",
      "invariant｜缺实现：modes 非空的检查项要给 run",
      "cleanup｜缺实现：没有给 run",
      "portImplementation｜缺实现：impl 是空的",
    ]);
  });

  it("只经端口上报、不由框架运行的检查项：modes 为空，可以不给 run", () => {
    const extra = other({ invariants: [{ code: "lyxtest.STUCK", severity: "P2", modes: [] }] });
    const assembly = assemble({
      entry: "api",
      appEnv: "test",
      registrations: [...samples(), extra],
    });
    expect(assembly.invariant("lyxtest.STUCK")?.run).toBeUndefined();
  });

  it("实现指向没有模块声明过的端口：报错；取没声明过的端口也抛错", () => {
    // 只装 beta：它实现的两个端口都没人声明
    expect(
      pick(issuesOf([beta.registration])).map(({ name, reason }) => `${name}｜${reason}`),
    ).toEqual([
      "lyxtest.greeter｜实现的端口没有模块声明过（定义它的模块要把它写进 ports）",
      "lyxtest.executor#refund｜实现的端口没有模块声明过（定义它的模块要把它写进 ports）",
      "lyxtest.executor#cancel｜实现的端口没有模块声明过（定义它的模块要把它写进 ports）",
    ]);
    const empty = assemble({ entry: "api", appEnv: "test", registrations: [] });
    expect(() => empty.port(alpha.meterPort)).toThrow(/端口 lyxtest.meter 没有模块声明过/);
    expect(() => empty.portEntries(alpha.executorPort)).toThrow(/没有模块声明过/);
  });
});

describe("按环境过滤（envs）", () => {
  const kinds = (appEnv: AppEnv): string[] =>
    assembleSamples("worker", appEnv).recurringJobs.map((item) => item.kind);

  it("标了 envs: ['stg'] 的周期任务：预发配置下在，生产配置下不出现", () => {
    expect(kinds("stg")).toEqual(["lyxtest.digest", "lyxtest.stg_autorefund", "lyxtest.sweep"]);
    expect(kinds("prod")).toEqual(["lyxtest.digest", "lyxtest.sweep"]);
    expect(
      assembleSamples("worker", "prod").recurringJob("lyxtest.stg_autorefund"),
    ).toBeUndefined();
    expect(assembleSamples("api", "prod").recurringJob("lyxtest.stg_autorefund")).toBeUndefined();
    expect(kinds("local")).toEqual(kinds("prod"));
    expect(kinds("test")).toEqual(kinds("prod"));
  });

  it("六类都认 envs", () => {
    const scoped = other({
      subscribers: [
        { name: "lyxtest.onStg", events: ["lyxtest.ping"], handle: noop, envs: ["stg"] },
      ],
      timerHandlers: [{ kind: "lyxtest.stg_timer", handle: async () => "fired", envs: ["stg"] }],
      recurringJobs: [{ kind: "lyxtest.stg_job", run: noop, envs: ["stg"] }],
      portImplementations: [implement(alpha.meterPort, { count: () => 9 }, { envs: ["stg"] })],
      invariants: [{ code: "lyxtest.I8", severity: "P2", modes: [], envs: ["stg"] }],
      cleanups: [{ name: "lyxtest.stg_rows", every: "day", run: async () => 0, envs: ["stg"] }],
    });
    const at = (appEnv: AppEnv) =>
      assemble({ entry: "worker", appEnv, registrations: [...samples(), scoped] });
    const fromGamma = (assembly: Assembly): number[] =>
      REGISTRATION_KINDS.map(
        (kind) => assembly[kind].filter((item) => item.module === "lyxtest_gamma").length,
      );

    expect(fromGamma(at("stg"))).toEqual([1, 1, 1, 1, 1, 1]);
    expect(at("stg").port(alpha.meterPort).count()).toBe(9);
    for (const appEnv of ["local", "test", "prod"] as const) {
      expect(fromGamma(at(appEnv))).toEqual([0, 0, 0, 0, 0, 0]);
      expect(at(appEnv).port(alpha.meterPort).count()).toBe(0);
    }
  });

  it("环境不相交的两个同名项不算重名：各环境拿到各自的那一个", () => {
    const perEnv = other({
      portImplementations: [
        implement(alpha.meterPort, { count: () => 1 }, { envs: ["local", "test", "stg"] }),
        implement(alpha.meterPort, { count: () => 2 }, { envs: ["prod"] }),
      ],
    });
    const at = (appEnv: AppEnv) =>
      assemble({ entry: "api", appEnv, registrations: [...samples(), perEnv] });
    expect(at("stg").port(alpha.meterPort).count()).toBe(1);
    expect(at("prod").port(alpha.meterPort).count()).toBe(2);
  });

  it("只在生产才会出的重名与缺实现，测试环境装配时就报", () => {
    const prodOnly = other({
      recurringJobs: [{ kind: "lyxtest.sweep", run: noop, envs: ["prod"] }],
    });
    const duplicated = issuesOf([...samples(), prodOnly], "test");
    expect(duplicated).toHaveLength(1);
    expect(duplicated[0]).toMatchObject({ name: "lyxtest.sweep", envs: ["prod"] });

    // greeter 只在预发有实现：其余三个环境缺实现
    const stgOnly = defineRegistration("lyxtest_beta", {
      portImplementations: [implement(alpha.greeterPort, { greet: () => "" }, { envs: ["stg"] })],
    });
    const missing = issuesOf([alpha.registration, stgOnly], "stg");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      category: "port",
      name: "lyxtest.greeter",
      envs: ["local", "test", "prod"],
    });
    expect(() =>
      assemble({ entry: "api", appEnv: "stg", registrations: [alpha.registration, stgOnly] }),
    ).toThrow(/\[端口\] lyxtest\.greeter：缺实现.*（环境：local、test、prod）/);
  });

  it("envs 写了空数组或不认识的环境：报错", () => {
    const extra = other({
      recurringJobs: [
        { kind: "lyxtest.never", run: noop, envs: [] },
        { kind: "lyxtest.typo", run: noop, envs: ["staging" as AppEnv] },
      ],
    });
    expect(
      pick(issuesOf([...samples(), extra])).map(({ name, reason }) => `${name}｜${reason}`),
    ).toEqual([
      "lyxtest.never｜envs 写了就不得为空：不写即全部环境",
      "lyxtest.typo｜envs 里有不认识的环境 staging",
    ]);
  });

  it("与环境无关的问题，envs 是全部环境", () => {
    const [issue] = issuesOf([alpha.registration, alpha.registration]);
    expect(issue?.envs).toEqual([...APP_ENVS]);
  });
});

describe("名字的写法", () => {
  it("订阅者名、事件名、kind、不变量编号、清理项名、端口名、模块名写错：各报一条", () => {
    const bad = defineRegistration("Lyxtest-Bad", {
      subscribers: [
        { name: "lyxtest:onPing", events: ["Ping"], handle: noop },
        { name: "lyxtest.onNone", events: [], handle: noop },
        { name: "lyxtest.onTwice", events: ["lyxtest.ping", "lyxtest.ping"], handle: noop },
      ],
      timerHandlers: [{ kind: "remind", handle: async () => "fired" }],
      recurringJobs: [{ kind: "Lyxtest.Sweep", run: noop }],
      invariants: [
        { code: "I1", severity: "P3" as "P1", modes: ["daily" as "full"], run: async () => [] },
      ],
      cleanups: [{ name: "rows", every: "week" as "day", run: async () => 0 }],
      ports: [{ name: "greeter", keyed: false, fallback: {} }],
    });
    expect(pick(issuesOf([bad])).map(({ name, reason }) => `${name}｜${reason}`)).toEqual([
      "Lyxtest-Bad｜模块名的写法不对",
      "lyxtest:onPing｜订阅者名的写法不对（outbox_delivery.subscriber）",
      "lyxtest:onPing｜订阅的事件名写法不对：Ping",
      "lyxtest.onNone｜没有写订阅哪些事件",
      "lyxtest.onTwice｜订阅的事件有重复",
      "remind｜kind 的写法不对（timer.kind）",
      "Lyxtest.Sweep｜kind 的写法不对（timer.kind）",
      "I1｜编号的写法不对：<命名空间>.<编号>",
      "I1｜severity 只能是 P1、P2",
      "I1｜modes 只能取 quick、full，且不重复",
      "rows｜清理项名的写法不对",
      "rows｜every 只能是 hour、day",
      "greeter｜端口名的写法不对",
    ]);
  });
});
