// 测试装配（W0-07b）：真实模块的登记之外，再追加用例自己的样例登记。只给测试用，不进生产装配。
//
//   const assembly = assembleForTest({ entry: "worker", extra: [sampleRegistration] });
//
// 样例登记的名字用 lyxtest 前缀（模块名 lyxtest_…，订阅者、kind、事件 lyxtest.…），不进契约的正式登记。
// 查重名与缺实现的口径与生产装配相同：样例与真实登记撞名，照样报错。两处例外（W0-24）：
//   1. 样例实现了某个单实现的端口（如记录调用的告警、违规上报）时，真实模块对同一个端口的实现让位：
//      端口本来就是给用例换实现用的，不让位就成了重名。
//   2. omitReal 写明不带真实模块的哪几类登记：只想跑样例周期任务的用例写 ["recurringJobs"]，
//      真实的周期任务（不变量、清理）就不会被补登记、被扫描循环领走。
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
  /** 真实模块的这几类登记不带（端口的声明不受影响）；不写即全带 */
  readonly omitReal?: readonly RegistrationKind[];
}

/** 测试装配：同一组参数下，entry 写 api 与写 worker 收到的内容相同 */
export function assembleForTest(options: TestAssemblyOptions): Assembly {
  const extra = options.extra ?? [];
  const overridden = new Set<AnyPort>(
    extra.flatMap((registration) =>
      registration.portImplementations.filter((item) => !item.port.keyed).map((item) => item.port),
    ),
  );
  const omitted = options.omitReal ?? [];
  const real = (options.isolated === true ? [] : collectRegistrations(MODULE_ENTRIES)).map(
    (registration): ModuleRegistration => ({
      ...registration,
      ...Object.fromEntries(omitted.map((kind) => [kind, []])),
      portImplementations: omitted.includes("portImplementations")
        ? []
        : registration.portImplementations.filter((item) => !overridden.has(item.port)),
    }),
  );
  return assemble({
    entry: options.entry,
    appEnv: options.appEnv ?? "test",
    registrations: [...real, ...extra],
  });
}
