// 只读逻辑导出→age公钥加密→有界备份流；租约、续租和重试由既有job包装。
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { pipeline } from "node:stream/promises";

import type { Clock } from "../kernel/index.js";
import { failed, ok } from "../providers/types.js";
import type { ProviderLogger, ProviderResult, StorageProvider } from "../providers/types.js";

export interface BackupConfig {
  readonly readOnlyUrl: string;
  readonly recipients: readonly string[];
  readonly bucket: string;
  readonly prefix?: string;
  readonly maxBytes?: number;
}
export interface BackupSummary {
  readonly key: string;
  readonly bytes: number;
  readonly seconds: number;
  readonly pgDumpVersion: string;
  readonly etag: string;
  readonly monthlyKey?: string;
}
export type BackupSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

const defaultSpawn: BackupSpawn = (command, args, options) =>
  spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
const quiet: ProviderLogger = { info() {}, warn() {}, error() {} };

/** 不传配置即明确未配置，不会调pg_dump、读钥文件或试探目标桶。 */
export function createBackup(options: {
  readonly config?: BackupConfig;
  readonly storage: Pick<
    StorageProvider,
    "configured" | "backupPutStream" | "backupHead" | "backupCopy"
  >;
  readonly clock: Clock;
  readonly logger?: ProviderLogger;
  readonly spawn?: BackupSpawn;
}) {
  const launch = options.spawn ?? defaultSpawn;
  const logger = options.logger ?? quiet;
  return {
    async run(
      input: { signal?: AbortSignal; previousSize?: number } = {},
    ): Promise<ProviderResult<BackupSummary>> {
      const config = options.config;
      if (!config || !options.storage.configured) return failed("unconfigured", "逻辑备份未配置");
      const prefix = (config.prefix ?? "backups").replace(/\/+$/, "");
      const maxBytes = config.maxBytes ?? 10 * 1024 ** 3;
      let connection: URL;
      try {
        connection = new URL(config.readOnlyUrl);
      } catch {
        return failed("rejected", "逻辑备份只读连接配置不合格");
      }
      if (
        !["postgresql:", "postgres:"].includes(connection.protocol) ||
        !connection.hostname ||
        connection.pathname.length <= 1 ||
        [...connection.searchParams.keys()].some(
          (key) => !["options", "sslmode", "connect_timeout", "application_name"].includes(key),
        )
      )
        return failed("rejected", "逻辑备份只读连接配置不合格");
      if (
        !config.recipients.length ||
        config.recipients.some((value) => !/^age1[0-9a-z]{58}$/.test(value)) ||
        !config.bucket ||
        !/^[a-zA-Z0-9_./-]+$/.test(prefix) ||
        prefix.split("/").includes("..") ||
        !Number.isSafeInteger(maxBytes) ||
        maxBytes <= 0 ||
        (input.previousSize !== undefined &&
          (!Number.isSafeInteger(input.previousSize) || input.previousSize < 0))
      )
        return failed("rejected", "逻辑备份配置不合格");
      const start = options.clock.now();
      const date = new Date(start.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const key = `${prefix}/daily/${date}.dump.age`;
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), 30 * 60 * 1000);
      deadline.unref();
      const forwardAbort = () => abort.abort();
      input.signal?.addEventListener("abort", forwardAbort, { once: true });
      if (input.signal?.aborted) abort.abort();
      const children: ChildProcessWithoutNullStreams[] = [];
      const stop = () => {
        for (const child of children) {
          child.stdin.destroy();
          child.stdout.destroy();
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGTERM");
            const force = setTimeout(() => child.kill("SIGKILL"), 1_000);
            force.unref();
            child.once("close", () => clearTimeout(force));
          }
        }
      };
      abort.signal.addEventListener("abort", stop);
      const runChild = (command: string, args: readonly string[], env: NodeJS.ProcessEnv = {}) => {
        abort.signal.throwIfAborted();
        const child = launch(command, args, { env: { PATH: process.env.PATH, ...env } });
        children.push(child);
        // 丢弃原始stderr，里面可能含连接串；仍持续消费，避免子进程阻塞。
        child.stderr.resume();
        const done = new Promise<void>((resolve, reject) => {
          child.once("error", () => reject(new Error("BackupChildFailed")));
          child.once("close", (code) =>
            code === 0 ? resolve() : reject(new Error("BackupChildFailed")),
          );
        });
        // 立即安装失败处理；任一子进程失败即终止管道和上传。
        void done.catch(() => abort.abort());
        return { child, done };
      };
      try {
        const version = runChild("pg_dump", ["--version"]);
        version.child.stdin.end();
        let pgDumpVersion = "";
        for await (const chunk of version.child.stdout) {
          pgDumpVersion += String(chunk);
          if (pgDumpVersion.length > 512) throw new Error("BackupVersionInvalid");
        }
        await version.done;
        pgDumpVersion = pgDumpVersion.trim();
        if (!/^pg_dump \(PostgreSQL\) 17\.\d+[^\r\n]*$/.test(pgDumpVersion))
          return failed("unsupported", "逻辑备份需要PostgreSQL17客户端");
        // libpq环境变量分别传值；PGDATABASE不展开URI。凭据不进入argv、日志或摘要。
        const dump = runChild("pg_dump", ["-Fc", "--no-owner", "--no-password"], {
          PGHOST: connection.hostname.replace(/^\[|\]$/g, ""),
          PGPORT: connection.port || "5432",
          PGUSER: decodeURIComponent(connection.username),
          PGPASSWORD: decodeURIComponent(connection.password),
          PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
          PGOPTIONS: connection.searchParams.get("options") ?? "",
          PGSSLMODE: connection.searchParams.get("sslmode") ?? "prefer",
          PGCONNECT_TIMEOUT: connection.searchParams.get("connect_timeout") ?? "10",
          PGAPPNAME: connection.searchParams.get("application_name") ?? "liyoxi-backup",
        });
        dump.child.stdin.end();
        const encrypted = runChild(
          "age",
          config.recipients.flatMap((recipient) => ["-r", recipient]),
        );
        const pipe = pipeline(dump.child.stdout, encrypted.child.stdin, { signal: abort.signal });
        void pipe.catch(() => abort.abort());
        // 未确认两个子进程成功退出之前不向Provider提交EOF，防止上传空/截断的对象。
        const ciphertext = {
          async *[Symbol.asyncIterator]() {
            for await (const chunk of encrypted.child.stdout) yield new Uint8Array(chunk as Buffer);
            await Promise.all([pipe, dump.done, encrypted.done]);
          },
        };
        const uploaded = await options.storage.backupPutStream({
          bucket: config.bucket,
          key,
          body: ciphertext,
          maxBytes,
          signal: abort.signal,
        });
        if (!uploaded.ok) {
          abort.abort();
          await Promise.allSettled([pipe, dump.done, encrypted.done]);
          return uploaded;
        }
        await Promise.all([pipe, dump.done, encrypted.done]);
        abort.signal.throwIfAborted();
        const head = await options.storage.backupHead({ bucket: config.bucket, key });
        if (!head.ok) return head;
        if (
          !head.value.exists ||
          !head.value.etag ||
          head.value.size <= 0 ||
          head.value.size !== uploaded.value.size ||
          (input.previousSize !== undefined && head.value.size < input.previousSize * 0.5)
        )
          return failed("rejected", "逻辑备份对象大小校验失败");
        let monthlyKey: string | undefined;
        if (date.endsWith("-01")) {
          monthlyKey = `${prefix}/monthly/${date}.dump.age`;
          const copied = await options.storage.backupCopy({
            src: { bucket: config.bucket, key },
            dst: { bucket: config.bucket, key: monthlyKey },
            ifMatchEtag: head.value.etag,
          });
          if (!copied.ok) return copied;
        }
        return ok({
          key,
          bytes: head.value.size,
          seconds: Math.max(0, (options.clock.now().getTime() - start.getTime()) / 1000),
          pgDumpVersion,
          etag: head.value.etag,
          ...(monthlyKey ? { monthlyKey } : {}),
        });
      } catch {
        abort.abort();
        logger.warn({ evt: "backup.pipeline_failed" }, "逻辑备份管道失败或已中止");
        return failed("unavailable", "逻辑备份管道失败或已中止");
      } finally {
        clearTimeout(deadline);
        input.signal?.removeEventListener("abort", forwardAbort);
        stop();
        abort.signal.removeEventListener("abort", stop);
      }
    },
  };
}
