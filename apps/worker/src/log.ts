// 任务进程的日志口（W0-23）：一行一条 JSON，写到标准输出。先用这个最小的实现，日志库随 api 骨架定了再换。
// 字段里的错误对象展开成 name、message、stack；别的值原样序列化。连接串、密钥不进日志，由调用方守。
import type { LogLevel } from "@liyoxi/services";

const ORDER: readonly LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
type Fields = Record<string, unknown>;

export interface Logger {
  debug(fields: Fields, message: string): void;
  info(fields: Fields, message: string): void;
  warn(fields: Fields, message: string): void;
  error(fields: Fields, message: string): void;
}

const plain = (value: unknown): unknown =>
  value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;

export function createLogger(
  level: LogLevel,
  write: (line: string) => void = (line) => void process.stdout.write(`${line}\n`),
): Logger {
  const floor = ORDER.indexOf(level);
  const at =
    (name: LogLevel) =>
    (fields: Fields, message: string): void => {
      if (ORDER.indexOf(name) < floor) return;
      const entries = Object.entries(fields).map(([key, value]) => [key, plain(value)]);
      write(
        JSON.stringify({
          level: name,
          time: new Date().toISOString(),
          app: "lyx-worker",
          msg: message,
          ...Object.fromEntries(entries),
        }),
      );
    };
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}

/** 什么都不记：用例里用 */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
