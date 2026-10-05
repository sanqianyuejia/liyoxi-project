// 探活 5 条（约定 C1；h01 第 2.5、3.11–3.15 节）。根路径，不在四组之内：不套信封、不走幂等与校验、
// 不进 OpenAPI，响应头带 Cache-Control: no-store。路径取契约里“只登记”的条目；取数在 services 的 ops 模块。
//   /healthz                   进程能应答即 200
//   /readyz                    启动完成且未在排空才 200，否则 503；之后不看数据库与 Redis
//   /health                    聚合状态；degraded 回 503，响应体不变
//   /internal/health/finance   只有框架（留桩，M4 回补）：各指标为 null，回 503
//   /internal/health/flow      只有框架（留桩，M7 回补）：同上
// 契约里登记了而这里没有处理器的条目，建应用时即报错。
import { allRegistryOnly } from "@liyoxi/contract";
import type { Runtime } from "@liyoxi/services";
import type { Context, Hono } from "hono";

import type { ApiEnv } from "./context.js";
import { MountError } from "./routing/mount.js";

/** 进程的就绪状态：启动完成之前是 starting；收到退出信号后是 draining */
export interface Readiness {
  state: "starting" | "ready" | "draining";
}

interface ProbeDeps {
  readonly runtime: Runtime;
  readonly readiness: Readiness;
}

interface Probe {
  /** 只有框架、还没有真实取数的：不进已挂载清单 */
  readonly frame?: true;
  handle(c: Context<ApiEnv>, deps: ProbeDeps): Response | Promise<Response>;
}

const reply = (c: Context<ApiEnv>, body: { status: string }, healthy: boolean): Response =>
  c.json(body, healthy ? 200 : 503, { "Cache-Control": "no-store" });

/** 登记键 → 处理器 */
const PROBES: Readonly<Record<string, Probe>> = {
  "hooks.healthz.get": {
    handle: (c) => reply(c, { status: "ok" }, true),
  },
  "hooks.readyz.get": {
    handle: (c, { readiness }) =>
      reply(c, { status: readiness.state }, readiness.state === "ready"),
  },
  "hooks.health.get": {
    handle: async (c, { runtime }) => {
      const summary = await runtime.health.summary();
      return reply(c, summary, summary.status === "ok");
    },
  },
  "hooks.internalHealth.finance.get": {
    frame: true,
    handle: (c, { runtime }) => reply(c, runtime.health.finance(), false),
  },
  "hooks.internalHealth.flow.get": {
    frame: true,
    handle: (c, { runtime }) => reply(c, runtime.health.flow(), false),
  },
};

/** 把探活挂到根应用上。返回已挂载真实处理器的登记键（只有框架的不算） */
export function mountProbes(app: Hono<ApiEnv>, deps: ProbeDeps): string[] {
  const missing = allRegistryOnly.filter((entry) => PROBES[entry.registryKey] === undefined);
  if (missing.length > 0) {
    throw new MountError(
      missing.map((entry) => `${entry.registryKey}（${entry.path}）：契约里登记了，没有处理器`),
    );
  }
  const landed: string[] = [];
  for (const entry of allRegistryOnly) {
    const probe = PROBES[entry.registryKey] as Probe;
    app.get(entry.path, (c) => probe.handle(c, deps));
    if (probe.frame !== true) landed.push(entry.registryKey);
  }
  return landed;
}
