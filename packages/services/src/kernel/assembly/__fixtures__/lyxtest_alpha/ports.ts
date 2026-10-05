// 样例模块 alpha 定义的三个端口：没有默认实现的、有默认实现的、按键多实现的。
import { defineKeyedPort, definePort } from "../../types.js";

export interface Greeter {
  greet(name: string): string;
}
/** 没有默认实现：没人实现即装配失败 */
export const greeterPort = definePort<Greeter>("lyxtest.greeter");

export interface Meter {
  count(): number;
}
/** 有默认实现（空实现）：没人实现时用它 */
export const meterPort = definePort<Meter>("lyxtest.meter", { fallback: { count: () => 0 } });

export type Executor = (input: string) => string;
/** 按键多实现：各模块各登记自己那个键 */
export const executorPort = defineKeyedPort<Executor>("lyxtest.executor");
