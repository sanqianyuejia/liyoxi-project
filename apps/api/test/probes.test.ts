// 探活 5 条的接口层用例（任务书 W0-22 第 7 节第 4、6 条；h01 第 2.5、3.11–3.15 节），另导出已挂载清单。
// 登记键以字符串字面量写在这里：“已落地”的判定按它认“有接口层测试”。
//   落地 3 条："hooks.healthz.get"、"hooks.readyz.get"、"hooks.health.get"
//   只有框架 2 条（留桩）："hooks.internalHealth.finance.get"、"hooks.internalHealth.flow.get"
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { allRegistryOnly } from "@liyoxi/contract";
import { describe, expect, it } from "vitest";

import { useTestApi } from "../src/testing/index.js";

const testApi = useTestApi();
const TIMEOUT = { timeout: 60_000 };

describe("探活", () => {
  it("/healthz：进程能应答即 200，不套信封，不缓存", TIMEOUT, async () => {
    const { request } = await testApi.start();
    const response = await request("/healthz");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("/readyz：启动中 503、就绪 200、排空中 503", TIMEOUT, async () => {
    const { request, api } = await testApi.start();
    api.readiness.state = "starting";
    const starting = await request("/readyz");
    expect(starting.status).toBe(503);
    expect(await starting.json()).toEqual({ status: "starting" });

    api.readiness.state = "ready";
    const ready = await request("/readyz");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
    expect(ready.headers.get("Cache-Control")).toBe("no-store");

    api.readiness.state = "draining";
    const draining = await request("/readyz");
    expect(draining.status).toBe(503);
    expect(await draining.json()).toEqual({ status: "draining" });
    // 排空中照常处理别的请求
    expect((await request("/healthz")).status).toBe(200);
  });

  it("/health：没有租约行时 503、worker 为 down；租约与探针新鲜时 200", TIMEOUT, async () => {
    const { request } = await testApi.start();
    const prisma = await testApi.db.prisma();

    const degraded = await request("/health");
    expect(degraded.status).toBe(503);
    expect(degraded.headers.get("Cache-Control")).toBe("no-store");
    expect(await degraded.json()).toMatchObject({
      status: "degraded",
      version: "test",
      db: "ok",
      redis: "ok",
      worker: "down",
      probeAgeSec: null,
      flow: "ok",
    });

    await prisma.$executeRaw`
      INSERT INTO worker_lease (name, holder, holder_version, acquired_at, heartbeat_at, probe_at)
      VALUES ('primary', 'node-a:test', 'test', clock_timestamp(), clock_timestamp(), clock_timestamp())`;
    const healthy = await request("/health");
    expect(healthy.status).toBe(200);
    const body = (await healthy.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", db: "ok", redis: "ok", worker: "ok", flow: "ok" });
    expect(Object.keys(body).sort()).toEqual(
      ["db", "flow", "probeAgeSec", "redis", "status", "time", "version", "worker"].sort(),
    );
  });

  it("两条内网探活只有框架：503，各指标为 null 且都在 breaches 里", TIMEOUT, async () => {
    const { request } = await testApi.start();
    const finance = await request("/internal/health/finance");
    expect(finance.status).toBe(503);
    expect(finance.headers.get("Cache-Control")).toBe("no-store");
    const financeBody = (await finance.json()) as { breaches: string[] };
    expect(financeBody).toMatchObject({ status: "degraded", unappliedReceipt: null });
    expect(financeBody.breaches).toHaveLength(10);

    const flow = await request("/internal/health/flow");
    expect(flow.status).toBe(503);
    const flowBody = (await flow.json()) as { breaches: string[] };
    expect(flowBody).toMatchObject({ status: "degraded", warnings: [], timerLagSec: null });
    expect(flowBody.breaches).toHaveLength(7);
  });

  it("探活不看 Idempotency-Key，也不要登录", TIMEOUT, async () => {
    const { request } = await testApi.start();
    expect(
      (await request("/healthz", { headers: { "Idempotency-Key": "not a valid key" } })).status,
    ).toBe(200);
  });
});

describe("已挂载清单", () => {
  it(
    "契约里只登记的 5 条都挂上了；清单里探活是落地的 3 条，写到 dist/mounted-operations.json",
    TIMEOUT,
    async () => {
      const { api, request } = await testApi.start();
      for (const entry of allRegistryOnly) {
        expect((await request(entry.path)).status, entry.path).not.toBe(404);
      }
      // 探活落地的 3 条都在；其余是各域陆续挂上的业务路由（各域的接口层用例各管各的），清单已排序
      expect(api.mountedOperations).toEqual(
        expect.arrayContaining(["hooks.health.get", "hooks.healthz.get", "hooks.readyz.get"]),
      );
      expect(api.mountedOperations.filter((id) => id.startsWith("hooks."))).toHaveLength(3);
      expect(api.mountedOperations).toEqual([...api.mountedOperations].sort());
      // “已落地”的判定（node infra/ci/landed.mjs）读这份文件：JSON 字符串数组，取生产的处理器清单
      const dist = fileURLToPath(new URL("../dist/", import.meta.url));
      mkdirSync(dist, { recursive: true });
      // 先写临时文件再改名：两轮测试同时跑时，读的一方看不到写了一半的文件
      const draft = `${dist}mounted-operations.${process.pid}.tmp`;
      writeFileSync(draft, `${JSON.stringify(api.mountedOperations, null, 2)}\n`);
      renameSync(draft, `${dist}mounted-operations.json`);
    },
  );
});
