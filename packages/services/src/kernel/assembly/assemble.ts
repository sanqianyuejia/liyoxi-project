// 装配（W0-07b）：把各模块的登记收成一份，按环境过滤，查重名与缺实现；有问题在进程启动时一次报全。
//
//   1. 先查与环境无关的：名字的写法、envs 的取值、处理函数有没有给、端口的声明。
//   2. 再对四个环境各过滤一遍，各查重名与缺实现。只在生产才会出的问题，本地与 CI 装配时就报，不留到上线。
//      环境不相交的两个同名项不算重名（如预发与生产各一个实现）。
//   3. 一个问题都没有，才给出当前环境的装配结果。entry 只记在结果上，不参与过滤：两个入口收到的内容相同。
// 本文件不读 process.env：环境由调用方传入。
import { matchesFormat, NAME_FORMATS } from "@liyoxi/contract/registry";

import { APP_ENVS } from "../env.js";
import type { AppEnv } from "../env.js";
import {
  ASSEMBLY_ENTRIES,
  CLEANUP_EVERY,
  INVARIANT_EVERY,
  INVARIANT_HEAL,
  INVARIANT_MODES,
  INVARIANT_SEVERITIES,
} from "./types.js";
import type {
  AnyPort,
  Assembly,
  AssemblyEntry,
  CleanupRegistration,
  Collected,
  DeclaredPort,
  EnvScoped,
  InvariantRegistration,
  KeyedPort,
  ModuleRegistration,
  Port,
  PortImplementation,
  RecurringJobRegistration,
  SubscriberRegistration,
  TimerHandlerRegistration,
} from "./types.js";

/** 问题出在哪一类上 */
export const ASSEMBLY_ISSUE_CATEGORIES = {
  module: "模块",
  subscriber: "订阅者",
  timerHandler: "定时器处理器",
  recurringJob: "周期任务",
  timerKind: "定时器处理器与周期任务",
  port: "端口",
  portImplementation: "端口实现",
  invariant: "不变量",
  cleanup: "清理",
} as const;
export type AssemblyIssueCategory = keyof typeof ASSEMBLY_ISSUE_CATEGORIES;

export interface AssemblyIssue {
  readonly category: AssemblyIssueCategory;
  /** 登记项的名字（订阅者名、kind、端口名、编号……） */
  readonly name: string;
  /** 涉及的模块；重名时是登记了同名项的各个模块 */
  readonly modules: readonly string[];
  readonly reason: string;
  /** 在哪些环境里成立 */
  readonly envs: readonly AppEnv[];
}

/** 装配失败：登记有重名、缺实现或写法不对。issues 是全部问题，不只第一条 */
export class AssemblyError extends Error {
  readonly issues: readonly AssemblyIssue[];

  constructor(issues: readonly AssemblyIssue[]) {
    const lines = issues.map((issue) => {
      const scope =
        issue.envs.length === APP_ENVS.length ? "" : `（环境：${issue.envs.join("、")}）`;
      const modules = issue.modules.length > 0 ? `；模块：${issue.modules.join("、")}` : "";
      return `  - [${ASSEMBLY_ISSUE_CATEGORIES[issue.category]}] ${issue.name}：${issue.reason}${modules}${scope}`;
    });
    super(`服务装配失败，共 ${issues.length} 处：\n${lines.join("\n")}`);
    this.name = "AssemblyError";
    this.issues = issues;
  }
}

/** 攒问题：同一个问题在几个环境里都有，只记一条，envs 写全 */
class IssueLog {
  readonly #issues = new Map<string, AssemblyIssue & { envs: AppEnv[] }>();

  add(
    category: AssemblyIssueCategory,
    name: string,
    modules: readonly string[],
    reason: string,
    env?: AppEnv,
  ): void {
    const key = JSON.stringify([category, name, modules, reason]);
    const known = this.#issues.get(key);
    const envs = env === undefined ? [...APP_ENVS] : [env];
    if (known === undefined) this.#issues.set(key, { category, name, modules, reason, envs });
    else for (const one of envs) if (!known.envs.includes(one)) known.envs.push(one);
  }

  list(): AssemblyIssue[] {
    return [...this.#issues.values()];
  }
}

const MODULE_NAME = /^[a-z][a-z0-9_-]*$/;
/** 端口名、清理项名：点分，至少两段 */
const DOTTED_NAME = /^[a-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
/** 不变量编号：<命名空间>.<编号>，命名空间可以带点（如 billing.ledger.I3） */
const INVARIANT_CODE = /^[a-z][a-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

const isFunction = (value: unknown): boolean => typeof value === "function";
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const byText =
  <T>(pick: (item: T) => string) =>
  (left: T, right: T): number =>
    pick(left) < pick(right) ? -1 : pick(left) > pick(right) ? 1 : 0;

/** 把各模块某一类的登记项摊平，带上模块名 */
function flatten<T>(
  registrations: readonly ModuleRegistration[],
  pick: (registration: ModuleRegistration) => readonly T[],
): Collected<T>[] {
  return registrations.flatMap((registration) =>
    pick(registration).map((item) => ({ ...item, module: registration.module })),
  );
}

const inEnv =
  (env: AppEnv) =>
  (item: EnvScoped): boolean =>
    item.envs === undefined || item.envs.includes(env);

/** 按环境过滤之前的全部登记 */
interface Everything {
  readonly modules: readonly string[];
  readonly subscribers: Collected<SubscriberRegistration>[];
  readonly timerHandlers: Collected<TimerHandlerRegistration>[];
  readonly recurringJobs: Collected<RecurringJobRegistration>[];
  readonly portImplementations: Collected<PortImplementation>[];
  readonly invariants: Collected<InvariantRegistration>[];
  readonly cleanups: Collected<CleanupRegistration>[];
  readonly ports: DeclaredPort[];
}

function gather(registrations: readonly ModuleRegistration[]): Everything {
  return {
    modules: registrations.map((registration) => registration.module),
    subscribers: flatten(registrations, (r) => r.subscribers),
    timerHandlers: flatten(registrations, (r) => r.timerHandlers),
    recurringJobs: flatten(registrations, (r) => r.recurringJobs),
    portImplementations: flatten(registrations, (r) => r.portImplementations),
    invariants: flatten(registrations, (r) => r.invariants),
    cleanups: flatten(registrations, (r) => r.cleanups),
    ports: registrations.flatMap((r) => r.ports.map((port) => ({ port, module: r.module }))),
  };
}

/** 端口实现在报错里的名字：按键端口带上键 */
const implementationName = (item: PortImplementation): string =>
  item.key === undefined ? item.port.name : `${item.port.name}#${item.key}`;

// ---------- 1. 与环境无关的检查 ----------

function checkEnvs(
  log: IssueLog,
  category: AssemblyIssueCategory,
  name: string,
  item: Collected<EnvScoped>,
): void {
  if (item.envs === undefined) return;
  const known: readonly string[] = APP_ENVS;
  if (!Array.isArray(item.envs) || item.envs.length === 0) {
    log.add(category, name, [item.module], "envs 写了就不得为空：不写即全部环境");
    return;
  }
  const unknown = item.envs.filter((env) => !known.includes(env));
  if (unknown.length > 0) {
    log.add(category, name, [item.module], `envs 里有不认识的环境 ${unknown.join("、")}`);
  }
}

function checkStatic(all: Everything, log: IssueLog): void {
  for (const module of sorted(all.modules)) {
    if (!MODULE_NAME.test(module)) log.add("module", module, [module], "模块名的写法不对");
    const count = all.modules.filter((name) => name === module).length;
    if (count > 1) log.add("module", module, [module], `重名：这个模块名有 ${count} 份登记`);
  }

  for (const item of all.subscribers) {
    const at = [item.module];
    if (!matchesFormat(NAME_FORMATS.subscriber, item.name)) {
      log.add("subscriber", item.name, at, "订阅者名的写法不对（outbox_delivery.subscriber）");
    }
    if (!isFunction(item.handle)) log.add("subscriber", item.name, at, "缺实现：没有给 handle");
    if (!Array.isArray(item.events) || item.events.length === 0) {
      log.add("subscriber", item.name, at, "没有写订阅哪些事件");
    } else {
      const bad = item.events.filter((event) => !matchesFormat(NAME_FORMATS.eventType, event));
      if (bad.length > 0) {
        log.add("subscriber", item.name, at, `订阅的事件名写法不对：${bad.join("、")}`);
      }
      if (new Set(item.events).size !== item.events.length) {
        log.add("subscriber", item.name, at, "订阅的事件有重复");
      }
    }
    checkEnvs(log, "subscriber", item.name, item);
  }

  for (const item of all.timerHandlers) {
    if (!matchesFormat(NAME_FORMATS.timerKind, item.kind)) {
      log.add("timerHandler", item.kind, [item.module], "kind 的写法不对（timer.kind）");
    }
    if (!isFunction(item.handle)) {
      log.add("timerHandler", item.kind, [item.module], "缺实现：没有给 handle");
    }
    checkEnvs(log, "timerHandler", item.kind, item);
  }

  for (const item of all.recurringJobs) {
    if (!matchesFormat(NAME_FORMATS.timerKind, item.kind)) {
      log.add("recurringJob", item.kind, [item.module], "kind 的写法不对（timer.kind）");
    }
    if (!isFunction(item.run))
      log.add("recurringJob", item.kind, [item.module], "缺实现：没有给 run");
    checkEnvs(log, "recurringJob", item.kind, item);
  }

  for (const item of all.invariants) {
    const at = [item.module];
    const add = (reason: string): void => log.add("invariant", item.code, at, reason);
    if (!INVARIANT_CODE.test(item.code)) add("编号的写法不对：<命名空间>.<编号>");
    if (!INVARIANT_SEVERITIES.includes(item.severity)) add("severity 只能是 P1、P2");
    const modes: readonly string[] = Array.isArray(item.modes) ? item.modes : ["?"];
    const allowed: readonly string[] = INVARIANT_MODES;
    if (modes.some((mode) => !allowed.includes(mode)) || new Set(modes).size !== modes.length) {
      add("modes 只能取 quick、full，且不重复");
    }
    if (item.every !== undefined && !INVARIANT_EVERY.includes(item.every)) {
      add("every 只能是 hour、week");
    }
    if (item.heal !== undefined && !INVARIANT_HEAL.includes(item.heal)) {
      add("heal 只能是 none、heal_and_alert、heal_only");
    }
    if (item.run !== undefined && !isFunction(item.run)) add("缺实现：run 不是函数");
    if (item.run === undefined && modes.length > 0) add("缺实现：modes 非空的检查项要给 run");
    checkEnvs(log, "invariant", item.code, item);
  }

  for (const item of all.cleanups) {
    const at = [item.module];
    if (!DOTTED_NAME.test(item.name)) log.add("cleanup", item.name, at, "清理项名的写法不对");
    if (!CLEANUP_EVERY.includes(item.every)) {
      log.add("cleanup", item.name, at, "every 只能是 hour、day");
    }
    if (!isFunction(item.run)) log.add("cleanup", item.name, at, "缺实现：没有给 run");
    checkEnvs(log, "cleanup", item.name, item);
  }

  // 端口的声明：名字全局唯一，只由定义它的那一个模块声明
  for (const name of sorted(all.ports.map((item) => item.port.name))) {
    const declared = all.ports.filter((item) => item.port.name === name);
    const modules = sorted(declared.map((item) => item.module));
    if (!DOTTED_NAME.test(name)) log.add("port", name, modules, "端口名的写法不对");
    if (declared.length > 1) log.add("port", name, modules, "重名：端口被声明了多次");
  }

  for (const item of all.portImplementations) {
    const name = implementationName(item);
    const at = [item.module];
    const add = (reason: string): void => log.add("portImplementation", name, at, reason);
    // 认端口认的是对象本身：另造一个同名的端口对象来实现，对不上
    if (!all.ports.some((declared) => declared.port === item.port)) {
      add("实现的端口没有模块声明过（定义它的模块要把它写进 ports）");
    }
    if (item.impl === undefined || item.impl === null) add("缺实现：impl 是空的");
    if (item.port.keyed && (typeof item.key !== "string" || item.key === "")) {
      add("按键的端口要给键：用 implementKeyed 登记");
    }
    if (!item.port.keyed && item.key !== undefined) add("单实现的端口不带键：用 implement 登记");
    checkEnvs(log, "portImplementation", name, item);
  }
}

// ---------- 2. 逐环境的检查 ----------

/** 一类登记项在一个环境里有没有重名 */
function checkDuplicates<T extends { readonly module: string }>(
  log: IssueLog,
  env: AppEnv,
  category: AssemblyIssueCategory,
  items: readonly T[],
  nameOf: (item: T) => string,
): void {
  for (const name of sorted(items.map(nameOf))) {
    const same = items.filter((item) => nameOf(item) === name);
    if (same.length > 1) {
      const modules = sorted(same.map((item) => item.module));
      log.add(category, name, modules, `重名：登记了 ${same.length} 次`, env);
    }
  }
}

function viewOf(all: Everything, env: AppEnv): Everything {
  const keep = inEnv(env);
  return {
    modules: all.modules,
    subscribers: all.subscribers.filter(keep),
    timerHandlers: all.timerHandlers.filter(keep),
    recurringJobs: all.recurringJobs.filter(keep),
    portImplementations: all.portImplementations.filter(keep),
    invariants: all.invariants.filter(keep),
    cleanups: all.cleanups.filter(keep),
    ports: all.ports,
  };
}

function checkEnv(view: Everything, env: AppEnv, log: IssueLog): void {
  checkDuplicates(log, env, "subscriber", view.subscribers, (item) => item.name);
  checkDuplicates(log, env, "timerHandler", view.timerHandlers, (item) => item.kind);
  checkDuplicates(log, env, "recurringJob", view.recurringJobs, (item) => item.kind);
  checkDuplicates(log, env, "invariant", view.invariants, (item) => item.code);
  checkDuplicates(log, env, "cleanup", view.cleanups, (item) => item.name);
  checkDuplicates(log, env, "portImplementation", view.portImplementations, implementationName);

  // 周期任务也是定时器行：kind 与有主体的定时器共用一个名字空间
  const jobKinds = new Set(view.recurringJobs.map((item) => item.kind));
  for (const handler of view.timerHandlers) {
    if (!jobKinds.has(handler.kind)) continue;
    const jobs = view.recurringJobs.filter((item) => item.kind === handler.kind);
    const modules = sorted([handler.module, ...jobs.map((item) => item.module)]);
    log.add(
      "timerKind",
      handler.kind,
      modules,
      "重名：同一个 kind 既是定时器处理器又是周期任务",
      env,
    );
  }

  // 缺实现：声明了、没有默认实现的单实现端口，这个环境里没有模块实现它
  for (const { port, module } of view.ports) {
    if (port.keyed || port.fallback !== undefined) continue;
    if (!view.portImplementations.some((item) => item.port === port)) {
      log.add("port", port.name, [module], "缺实现：端口没有默认实现，也没有模块实现它", env);
    }
  }
}

// ---------- 3. 装配结果 ----------

function build(entry: AssemblyEntry, appEnv: AppEnv, view: Everything): Assembly {
  const subscribers = [...view.subscribers].sort(byText((item) => item.name));
  const timerHandlers = [...view.timerHandlers].sort(byText((item) => item.kind));
  const recurringJobs = [...view.recurringJobs].sort(byText((item) => item.kind));
  const invariants = [...view.invariants].sort(byText((item) => item.code));
  const cleanups = [...view.cleanups].sort(byText((item) => item.name));
  const portImplementations = [...view.portImplementations].sort(byText(implementationName));
  const ports = [...view.ports].sort(byText((item) => item.port.name));

  const assertDeclared = (port: AnyPort): void => {
    if (!ports.some((item) => item.port === port)) {
      throw new Error(`端口 ${port.name} 没有模块声明过：定义它的模块要把它写进登记的 ports`);
    }
  };

  return {
    entry,
    appEnv,
    modules: sorted(view.modules),
    subscribers,
    timerHandlers,
    recurringJobs,
    portImplementations,
    invariants,
    cleanups,
    ports,
    subscriber: (name) => subscribers.find((item) => item.name === name),
    timerHandler: (kind) => timerHandlers.find((item) => item.kind === kind),
    recurringJob: (kind) => recurringJobs.find((item) => item.kind === kind),
    invariant: (code) => invariants.find((item) => item.code === code),
    cleanup: (name) => cleanups.find((item) => item.name === name),
    port<T>(port: Port<T>): T {
      assertDeclared(port);
      const found = portImplementations.find((item) => item.port === port);
      // 类型由 implement 在登记时对上；装配时已查过：没有实现的端口一定有默认实现
      return (found === undefined ? port.fallback : found.impl) as T;
    },
    portEntries<T>(port: KeyedPort<T>): ReadonlyMap<string, T> {
      assertDeclared(port);
      return new Map(
        portImplementations
          .filter((item) => item.port === port)
          .map((item) => [item.key as string, item.impl as T]),
      );
    },
  };
}

export interface AssembleOptions {
  /** 哪个进程在装配 */
  readonly entry: AssemblyEntry;
  /** 当前环境：取 loadEnv 给出的 APP_ENV */
  readonly appEnv: AppEnv;
  /** 各模块的登记 */
  readonly registrations: readonly ModuleRegistration[];
}

/** 装配。登记有问题即抛 AssemblyError（进程启动失败），问题一次列全 */
export function assemble(options: AssembleOptions): Assembly {
  const { entry, appEnv, registrations } = options;
  if (!ASSEMBLY_ENTRIES.includes(entry)) {
    throw new TypeError(`装配入口只能是 ${ASSEMBLY_ENTRIES.join("、")}`);
  }
  if (!APP_ENVS.includes(appEnv)) throw new TypeError(`环境只能是 ${APP_ENVS.join("、")}`);

  const all = gather(registrations);
  const log = new IssueLog();
  checkStatic(all, log);
  for (const env of APP_ENVS) checkEnv(viewOf(all, env), env, log);

  const issues = log.list();
  if (issues.length > 0) throw new AssemblyError(issues);
  return build(entry, appEnv, viewOf(all, appEnv));
}
