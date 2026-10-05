// api 进程的入口（W0-22）。构建产物是 dist/server.js：node apps/api/dist/server.js [--port 3000] [--host 0.0.0.0]
//   [--trusted-proxy-hops 1] [--trusted-proxy-cidrs 10.0.0.0/8,192.168.0.0/16]
//
// 启动：读环境变量 → 建运行时（参数缺定义、模块登记不对即失败）→ 建应用（路由漏挂中间件即失败）
// → 启动自检（要成功连上一次数据库）→ 监听 → 就绪。任何一步失败：打一条日志，退出码 1。
// 退出：收到 SIGTERM、SIGINT 即进入排空（/readyz 回 503），不再接新连接，在途请求处理完后断开数据库与 Redis，退出码 0。
// 监听端口走命令行参数，不是环境变量；镜像标签在构建时写进产物（任务书 第 10 节第 4 项）。
// 可信代理的跳数与网段同样走命令行参数（取客户端 IP 用，http/client-ip.ts）：不给即 1 跳、回环与私有网段。
import { parseArgs } from "node:util";

import { serve } from "@hono/node-server";
import { createRuntime, loadEnv, runStartupChecks } from "@liyoxi/services";
import type { Runtime } from "@liyoxi/services";

import { createApp } from "./app.js";
import { DEFAULT_TRUSTED_PROXY } from "./http/client-ip.js";
import { HANDLERS } from "./routes/index.js";
import { VERSION } from "./version.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "3000" },
    host: { type: "string", default: "0.0.0.0" },
    "trusted-proxy-hops": { type: "string" },
    "trusted-proxy-cidrs": { type: "string" },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  console.error(`--port 要是 0 到 65535 之间的整数`);
  process.exit(1);
}

let runtime: Runtime | undefined;
try {
  runtime = createRuntime({ entry: "api", env: loadEnv(), version: VERSION });
  // 跳数、网段写错了在 createApp 里抛错，走下面的启动失败
  const trustedProxy = {
    hops:
      values["trusted-proxy-hops"] === undefined
        ? DEFAULT_TRUSTED_PROXY.hops
        : Number(values["trusted-proxy-hops"]),
    cidrs:
      values["trusted-proxy-cidrs"] === undefined
        ? DEFAULT_TRUSTED_PROXY.cidrs
        : values["trusted-proxy-cidrs"].split(",").filter((cidr) => cidr.trim() !== ""),
  };
  const api = createApp({ runtime, handlers: HANDLERS, trustedProxy });
  await runStartupChecks(runtime.startupChecks);

  const { logger } = runtime;
  const server = serve({ fetch: api.app.fetch, port, hostname: values.host }, (address) => {
    api.readiness.state = "ready";
    logger.info(
      { evt: "api.listening", port: address.port, routes: api.mounted.length },
      "api 已就绪",
    );
  });

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    api.readiness.state = "draining";
    logger.info({ evt: "api.draining", signal }, "收到退出信号，开始排空");
    server.close(() => {
      void runtime
        ?.close()
        .catch((error: unknown) => logger.error({ evt: "api.close", err: error }, "断开连接出错"))
        .finally(() => {
          logger.info({ evt: "api.stopped" }, "api 已退出");
          process.exit(0);
        });
    });
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
} catch (error) {
  // 环境变量、参数定义、模块登记、路由挂载、启动自检的报错都不带配置值，可以原样打出来
  const message = error instanceof Error ? error.message : String(error);
  if (runtime) runtime.logger.fatal({ evt: "api.start_failed" }, message);
  else console.error(`api 启动失败：${message}`);
  await runtime?.close().catch(() => undefined);
  process.exit(1);
}
