// 测试装配（W0-07b）：真实模块的登记之外，再追加用例自己的样例登记。只给测试用，不进生产装配。
//
//   const assembly = assembleForTest({ entry: "worker", extra: [sampleRegistration] });
//
// 样例登记的名字用 lyxtest 前缀（模块名 lyxtest_…，订阅者、kind、事件 lyxtest.…），不进契约的正式登记。
// 查重名与缺实现的口径与生产装配相同：样例与真实登记撞名，照样报错。三处例外：
//   1. 样例实现了某个单实现的端口（如记录调用的告警、违规上报）时，真实模块对同一个端口的实现让位（W0-24）：
//      端口本来就是给用例换实现用的，不让位就成了重名。
//   2. omitReal 写明不带真实模块的哪几类登记（W0-24）：只想跑样例周期任务的用例写 ["recurringJobs"]，
//      真实的周期任务（不变量、清理）就不会被补登记、被扫描循环领走。
//   3. 样例登记了按键端口里的某个键（如状态机登记 flow.machine 的 staff.status），真实模块对同一个键的实现让位（W1-01a）。
//      按键端口本来就是给各域各登记各的；真实的域接上之后，flow 的样例守卫还要能顶在它上面跑自己的用例。
//      别的键上真实的实现照旧带着；整个端口都不带真实实现，用 withoutRealPorts。
import { MODULE_ENTRIES } from "../assembly.js";
import { assemble, collectRegistrations } from "../kernel/index.js";
import type {
  AnyPort,
  AppEnv,
  Assembly,
  AssemblyEntry,
  ModuleRegistration,
  RegistrationKind,
} from "../kernel/index.js";

export interface TestAssemblyOptions {
  /** 模拟哪个进程 */
  readonly entry: AssemblyEntry;
  /** 模拟哪个环境；缺省 test。要看预发专用的登记项就写 stg */
  readonly appEnv?: AppEnv;
  /** 追加的样例登记 */
  readonly extra?: readonly ModuleRegistration[];
  /** 为真时不带真实模块的登记，只装 extra */
  readonly isolated?: boolean;
  /**
   * 这几个端口不带真实模块登记的实现（W0-30a）：用例要换成自己的实现（写进 extra），
   * 或要看没有实现时的行为。样例与真实登记撞名照样报错，所以换实现得先把真实的那一份拿掉。
   */
  readonly withoutRealPorts?: readonly AnyPort[];
  /**
   * 真实模块的这几类登记不带（端口的声明不受影响）；不写即全带。
   * 写了 portImplementations 时，没有默认实现的单实现端口照旧带着真实模块的实现（如 tenant 的计费账户端口）：
   * 一个都不带，装配按“缺实现”报错、起不来。要看这种端口缺实现时的行为，用 withoutRealPorts 点名。
   */
  readonly omitReal?: readonly RegistrationKind[];
}

/** 真实模块的登记里，去掉 extra 已经登记了同一个键的按键端口实现 */
function yieldKeyedTo(
  real: readonly ModuleRegistration[],
  extra: readonly ModuleRegistration[],
): ModuleRegistration[] {
  const taken = extra.flatMap((registration) =>
    registration.portImplementations.filter((item) => item.port.keyed),
  );
  const overridden = (item: ModuleRegistration["portImplementations"][number]): boolean =>
    taken.some((sample) => sample.port === item.port && sample.key === item.key);
  return real.map((registration) => ({
    ...registration,
    portImplementations: registration.portImplementations.filter((item) => !overridden(item)),
  }));
}

/** 测试装配：同一组参数下，entry 写 api 与写 worker 收到的内容相同 */
export function assembleForTest(options: TestAssemblyOptions): Assembly {
  const extra = options.extra ?? [];
  // 真实实现被拿掉的端口：点名不带的（withoutRealPorts，W0-30a），加上样例在 extra 里给了实现的（W0-24）
  const overridden = new Set<AnyPort>([
    ...(options.withoutRealPorts ?? []),
    ...extra.flatMap((registration) =>
      registration.portImplementations.filter((item) => !item.port.keyed).map((item) => item.port),
    ),
  ]);
  const omitted = options.omitReal ?? [];
  // 不带真实的端口实现时，没有默认实现的单实现端口除外：拿掉它，装配查“缺实现”就过不去
  const omitPorts = omitted.includes("portImplementations");
  const required = (port: AnyPort): boolean => !port.keyed && port.fallback === undefined;
  const real = (options.isolated === true ? [] : collectRegistrations(MODULE_ENTRIES)).map(
    (registration): ModuleRegistration => ({
      ...registration,
      ...Object.fromEntries(omitted.map((kind) => [kind, []])),
      portImplementations: registration.portImplementations.filter(
        (item) => !overridden.has(item.port) && (!omitPorts || required(item.port)),
      ),
    }),
  );
  return assemble({
    entry: options.entry,
    appEnv: options.appEnv ?? "test",
    registrations: [...yieldKeyedTo(real, extra), ...extra],
  });
}
