// 十二个外部能力的装配落点（KF-1）。D7 第 2.2 节 D8：驱动的入口只许 kernel 引，进程装配（runtime.ts、ops 的
// buildWorkerServices）都经这里拿 Providers，不直接调 createProviders。
// 外呼前钩子在这里接死：装配方给不了别的，也就漏不掉。事务里调任何 Provider 方法，local、test 下抛错且请求发不出去，
// stg、prod 上报后照常调（01 第 5 节调用规则 3；D7 第 2.3 节规则 5）。
import { createProviders } from "../../providers/index.js";
import type { CreateProvidersOptions, Providers } from "../../providers/index.js";
import { guardProviderCall } from "../three-phase/index.js";

/** 与 createProviders 的选项相同，只是没有 beforeCall：钩子固定是 guardProviderCall */
export type AssembleProvidersOptions = Omit<CreateProvidersOptions, "beforeCall">;

/** 按环境与选项装配十二个 Provider（选哪个实现见 providers/index.ts），并接上“事务内不外呼”的钩子 */
export function assembleProviders(options: AssembleProvidersOptions): Providers {
  return createProviders({ ...options, beforeCall: guardProviderCall });
}
