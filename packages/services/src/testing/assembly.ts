// 测试装配（W0-07b）：真实模块的登记之外，再追加用例自己的样例登记。只给测试用，不进生产装配。
//
//   const assembly = assembleForTest({ entry: "worker", extra: [sampleRegistration] });
//
// 样例登记的名字用 lyxtest 前缀（模块名 lyxtest_…，订阅者、kind、事件 lyxtest.…），不进契约的正式登记。
// 查重名与缺实现的口径与生产装配相同：样例与真实登记撞名，照样报错。
import { MODULE_ENTRIES } from "../assembly.js";
import { assemble, collectRegistrations } from "../kernel/index.js";
import type { AppEnv, Assembly, AssemblyEntry, ModuleRegistration } from "../kernel/index.js";

export interface TestAssemblyOptions {
  /** 模拟哪个进程 */
  readonly entry: AssemblyEntry;
  /** 模拟哪个环境；缺省 test。要看预发专用的登记项就写 stg */
  readonly appEnv?: AppEnv;
  /** 追加的样例登记 */
  readonly extra?: readonly ModuleRegistration[];
  /** 为真时不带真实模块的登记，只装 extra */
  readonly isolated?: boolean;
}

/** 测试装配：同一组参数下，entry 写 api 与写 worker 收到的内容相同 */
export function assembleForTest(options: TestAssemblyOptions): Assembly {
  const real = options.isolated === true ? [] : collectRegistrations(MODULE_ENTRIES);
  return assemble({
    entry: options.entry,
    appEnv: options.appEnv ?? "test",
    registrations: [...real, ...(options.extra ?? [])],
  });
}
