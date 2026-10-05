// 埋点直记端口 track.record（W0-17）。kernel 定义，analytics 注册实现（M7）；没人实现时是空实现。
// 依据：14 分组 第 2.9、5.3 节；D6 第 5.1.2 节。
// 不让埋点带坏业务事务：tx 非空时外壳用保存点包住实现，实现失败（含数据库错误）只回滚它自己的写入并记日志；
// tx 为空时实现独立写入，失败同样只记日志。
import { definePort } from "../assembly/index.js";
import type { Assembly } from "../assembly/index.js";
import { savepoint } from "../tx.js";
import type { Tx } from "../tx.js";
import { portLog, quiet } from "./log.js";

export interface TrackEvent {
  /** 服务端埋点事件名；取值与 props 的结构由契约的埋点事件登记定，实现方校验 */
  readonly name: string;
  readonly props: Readonly<Record<string, unknown>>;
  /** 去重标识；不给时由实现方取 srv-{requestId}-{name} */
  readonly eventId?: string;
  readonly subject?: {
    readonly userId?: string;
    readonly entityId?: string;
    readonly storeId?: string;
  };
}

export interface Track {
  /** tx 非空：与业务写同事务；tx 为空：独立写入 */
  record(tx: Tx | null, event: TrackEvent): Promise<void>;
}

export const noopTrack: Track = {
  async record(_tx, event) {
    portLog.debug({ port: "track.record", name: event.name }, "埋点端口没有实现：只记日志");
  },
};

export const trackPort = definePort<Track>("track.record", { fallback: noopTrack });

/** 取埋点端口。用例里直记埋点只经这个外壳调，不直接调实现 */
export function trackOf(assembly: Assembly): Track {
  const impl = assembly.port(trackPort);
  return {
    record: (tx, event) =>
      quiet(trackPort.name, () =>
        tx === null ? impl.record(null, event) : savepoint(tx, () => impl.record(tx, event)),
      ),
  };
}
