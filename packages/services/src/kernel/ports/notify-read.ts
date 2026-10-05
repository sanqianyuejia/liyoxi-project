// 通知场景的只读解析函数 ctx.read.*（W0-17）。kernel 定义端口，拥有数据的领域按函数名登记，通知框架（G2-C）调。
// 依据：13 分组 第 5.1 节；D6 第 2.2.3 节；06 第 3.6 节。没有登记的函数解析为空（null）。
import { defineKeyedPort } from "../assembly/index.js";
import type { Assembly } from "../assembly/index.js";
import type { Tx } from "../tx.js";
import { portLog } from "./log.js";

/** 一个解析函数：回库读当前状态，只读。参数与返回值由登记它的领域定 */
export type NotifyReader = (tx: Tx, ...args: never[]) => Promise<unknown>;

/** 按函数名登记：implementKeyed(notifyReadPort, "sampleForNotify", fn) */
export const notifyReadPort = defineKeyedPort<NotifyReader>("notify.read");

export interface NotifyRead {
  has(name: string): boolean;
  /** 调已登记的解析函数；没有登记即返回 null。解析函数自己抛的错照抛 */
  read<T = unknown>(tx: Tx, name: string, ...args: unknown[]): Promise<T | null>;
}

export function notifyReadOf(assembly: Assembly): NotifyRead {
  const readers = assembly.portEntries(notifyReadPort);
  return {
    has: (name) => readers.has(name),
    async read<T>(tx: Tx, name: string, ...args: unknown[]): Promise<T | null> {
      const reader = readers.get(name) as
        ((tx: Tx, ...args: unknown[]) => Promise<unknown>) | undefined;
      if (reader === undefined) {
        portLog.debug({ port: notifyReadPort.name, name }, "解析函数没有登记：返回空");
        return null;
      }
      return (await reader(tx, ...args)) as T;
    },
  };
}
