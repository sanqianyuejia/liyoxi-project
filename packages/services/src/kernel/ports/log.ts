// 端口的空实现与外壳用的日志口（W0-17）。进程装配时（W0-22、W0-23）用 setPortLogger 接上真正的日志；
// 没接之前：调试日志丢弃，错误走 console.error。pino 的 logger 可以直接传进来。

export interface PortLogger {
  debug(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

const silent: PortLogger = {
  debug: () => undefined,
  error: (fields, message) => console.error(message, fields),
};
let sink: PortLogger = silent;

/** 接上日志；不传即恢复缺省 */
export function setPortLogger(logger?: PortLogger): void {
  sink = logger ?? silent;
}

export const portLog: PortLogger = {
  debug: (fields, message) => sink.debug(fields, message),
  error: (fields, message) => sink.error(fields, message),
};

/** “失败不抛”的外壳：实现抛错只记日志，不抛给调用方（01 分组 第 5.2 节；14 分组 第 2.9 节） */
export async function quiet(port: string, call: () => Promise<void>): Promise<void> {
  try {
    await call();
  } catch (error) {
    portLog.error({ port, err: error }, "端口的实现抛错，已吞掉：不影响调用方");
  }
}
