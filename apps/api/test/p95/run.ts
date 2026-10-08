// 薄装配：全部数据由 services/testing owned 前置创建；真实 TCP HTTP，正式处理器/鉴权/限流/幂等。
import { createServer } from "node:http";
import { availableParallelism, loadavg, platform } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { getRequestListener } from "@hono/node-server";
import { allRoutes } from "@liyoxi/contract";
import { createIdentityContext, security, uuidv7 } from "@liyoxi/services";
import { createP95Fixture } from "@liyoxi/services/testing";
import type { P95Result } from "../../../../infra/ci/p95.mjs";
import { settings, measure, reportPassed, P95_LIMIT_MS } from "../../../../infra/ci/p95.mjs";
import { createApp } from "../../src/app.js";
import { provideMerchantDeps, merchantServicesOf } from "../../src/merchant/services.js";
import { HANDLERS } from "../../src/routes/index.js";

const config = settings(process.argv.slice(2));
const started = performance.now();
let server: ReturnType<typeof createServer> | undefined;
const report: Record<string, unknown> = {
  schema: 1,
  mode:
    config.scale === 10 && config.concurrency === 20 && config.seed === 42 && config.samples === 100
      ? "baseline"
      : "smoke",
  config: {
    concurrency: config.concurrency,
    scale: config.scale,
    seed: config.seed,
    samples: config.samples,
    limitMs: P95_LIMIT_MS,
  },
  machine: {
    node: process.version,
    platform: platform(),
    cpus: availableParallelism(),
    loadStart: loadavg(),
  },
  routes: [],
  excluded: [],
};
let closeFixture: (() => Promise<void>) | undefined;

try {
  const fixture = await createP95Fixture({
    ...config,
    dataset: (value) => {
      report["dataset"] = value;
    },
    progress: (message) => process.stderr.write(`${message}\n`),
  });
  closeFixture = fixture.close;
  report["ownedScope"] = {
    runId: fixture.support.runId,
    databaseName: fixture.support.databaseName,
    redisPrefix: fixture.support.redisPrefix,
  };
  process.stderr.write(`P95隔离范围:${JSON.stringify(report["ownedScope"])}\n`);
  const { runtime, providers } = fixture.support;
  provideMerchantDeps(runtime, {
    keyring: security.loadKeyring(runtime.env),
    appid: "wxlyxp95test0001",
  });
  const api = createApp({ runtime, handlers: HANDLERS });
  api.readiness.state = "ready";
  server = createServer(getRequestListener(api.app.fetch));
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("P95监听失败");
  const base = `http://127.0.0.1:${address.port}`;
  let requestNo = 0;
  async function call(
    operationId: string,
    headers: Record<string, string> = {},
    body?: unknown,
    params: Record<string, string> = {},
    query = "",
  ) {
    const route = allRoutes.find((r) => r.operationId === operationId);
    if (!route) throw new Error("UNKNOWN_ROUTE");
    const path = route.path.replace(/\{([^}]+)\}/g, (_m, key: string) =>
      encodeURIComponent(params[key]!),
    );
    const n = ++requestNo;
    const response = await fetch(`${base}${path}${query}`, {
      method: route.method.toUpperCase(),
      headers: {
        host: path.startsWith("/api/v1/admin/") ? "admin.localhost" : "api.localhost",
        "x-forwarded-for": `198.18.${Math.floor(n / 250) % 250}.${(n % 250) + 1}`,
        ...headers,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(route["x-idempotent"] === "required" ? { "Idempotency-Key": uuidv7() } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw: unknown = await response.json();
    if (response.status !== 200) {
      const symbol =
        raw !== null && typeof raw === "object" && "error" in raw
          ? String(raw.error)
          : "HTTP_ERROR";
      throw new Error(symbol);
    }
    const def = route.responses[200],
      media = def && "content" in def ? def.content?.["application/json"] : undefined,
      schema = media && "schema" in media ? media.schema : undefined;
    if (!schema || !("parse" in schema) || typeof schema.parse !== "function")
      throw new Error("MISSING_SCHEMA");
    const parsed = schema.parse(raw) as { data: Record<string, unknown> };
    return parsed.data;
  }
  await fixture.loginAgreements();
  const agreements = await call("m.agreement.list", {}, undefined, {}, "?scene=login");
  const consents = (
    agreements["items"] as Array<{
      agreementKey: string;
      currentVersion: { agreementVersionId: string } | null;
    }>
  )
    .filter((a) => a.currentVersion)
    .map((a) => ({
      agreementKey: a.agreementKey,
      agreementVersionId: a.currentVersion!.agreementVersionId,
    }));
  async function login(phone: string, index: number) {
    const loginCode = `p95-login-${index}`,
      phoneCode = `p95-phone-${index}`;
    providers.wechat.sessions.set(loginCode, { openid: `oP95_${index}` });
    providers.wechat.phones.set(phoneCode, phone);
    const signed = await call("m.session.phoneLogin", {}, { loginCode, phoneCode, consents });
    return {
      token: String(signed["token"]),
      merchantUserId: (signed["me"] as { user: { merchantUserId: string } }).user.merchantUserId,
    };
  }
  const owner = await login("13610000000", 0);
  const scope = await merchantServicesOf(runtime).tenant.createEntity(
    createIdentityContext({
      actor: { type: "merchant", id: owner.merchantUserId, client: "weapp" },
    }),
  );
  const seeded = await fixture.seed({
    ...scope,
    merchantUserId: owner.merchantUserId,
    phone: "13610000000",
  });

  const actors: Array<{ headers: Record<string, string>; scope: (typeof seeded.scopes)[number] }> =
    [];
  for (let n = 0; n < Math.min(config.samples, seeded.scopes.length); n++) {
    const current = seeded.scopes[n]!,
      signed = n === 0 ? owner : await login(current.phone, n);
    if (signed.merchantUserId !== current.merchantUserId) throw new Error("P95身份归属失败");
    actors.push({
      scope: current,
      headers: { authorization: `Bearer ${signed.token}`, "x-store-id": current.storeId },
    });
  }
  const admin = await fixture.adminSession(),
    adminHeaders = { ...admin.headers };
  const actor = (n: number) => actors[n % actors.length]!;
  const mounted = new Set(HANDLERS.map((h) => h.route.operationId));
  const work: Array<{ operationId: string; run: (n: number) => Promise<unknown> }> = [
    { operationId: "m.bootstrap.get", run: (n) => call("m.bootstrap.get", actor(n).headers) },
    { operationId: "m.me.get", run: (n) => call("m.me.get", actor(n).headers) },
    { operationId: "m.home.get", run: (n) => call("m.home.get", actor(n).headers) },
    { operationId: "m.drama.list", run: (n) => call("m.drama.list", actor(n).headers) },
    {
      operationId: "m.drama.get",
      run: (n) =>
        call("m.drama.get", actor(n).headers, undefined, { dramaId: seeded.spareDramaId }),
    },
    {
      operationId: "m.order.quote",
      run: (n) =>
        call("m.order.quote", actor(n).headers, {
          dramaIds: [seeded.spareDramaId],
          channelAccountIds: [actor(n).scope.channelAccountId],
          isTopModel: false,
        }),
    },
    { operationId: "m.order.list", run: (n) => call("m.order.list", actor(n).headers) },
    {
      operationId: "m.order.get",
      run: (n) =>
        call("m.order.get", actor(n).headers, undefined, {
          orderId: actor(n).scope.orderIds[n % 4]!,
        }),
    },
    { operationId: "admin.order.list", run: () => call("admin.order.list", adminHeaders) },
    { operationId: "admin.approval.list", run: () => call("admin.approval.list", adminHeaders) },
  ];
  // 每个写样本使用不同门店；低规模仅供 smoke 时明确不测无足够前置的写接口。
  if (actors.length >= config.samples) {
    const orderInputs = await Promise.all(
      actors.map(async (a) => {
        const quote = await call("m.order.quote", a.headers, {
          dramaIds: [seeded.spareDramaId],
          channelAccountIds: [a.scope.channelAccountId],
          isTopModel: false,
        });
        return {
          dramaIds: [seeded.spareDramaId],
          channelAccountIds: [a.scope.channelAccountId],
          focusCodes: ["W115F"],
          isTopModel: false,
          agreementVersionId: (quote["agreement"] as { agreementVersionId: string })
            .agreementVersionId,
          expect: quote["expect"],
        };
      }),
    );
    work.push({
      operationId: "m.order.create",
      run: (n) => call("m.order.create", actor(n).headers, orderInputs[n]),
    });
    const buyers: Array<{ headers: Record<string, string> }> = [];
    for (let n = 0; n < config.samples; n++) {
      const signed = await login(
        `136${String(20_000_000 + n).padStart(8, "0")}`,
        config.samples + n,
      );
      const buyerScope = await merchantServicesOf(runtime).tenant.createEntity(
        createIdentityContext({
          actor: { type: "merchant", id: signed.merchantUserId, client: "weapp" },
        }),
      );
      await fixture.prepareBuyer({
        ...buyerScope,
        merchantUserId: signed.merchantUserId,
        phone: `136${String(20_000_000 + n).padStart(8, "0")}`,
      });
      buyers.push({
        headers: { authorization: `Bearer ${signed.token}`, "x-store-id": buyerScope.storeId },
      });
    }
    report["measurementPreparation"] = {
      newPurchaseStores: buyers.length,
      paymentChannel: "bank_transfer",
      reason: "实际付款创建目前只支持新开通，主样本保留active套餐/完整账本",
    };
    const plans = await call("m.plan.list", buyers[0]!.headers),
      pro = (plans["items"] as Array<{ code: string; planId: string }>).find(
        (p) => p.code === "pro",
      )!;
    const quote = await call("m.plan.quote", buyers[0]!.headers, { planId: pro.planId, months: 1 });
    const terms = await call(
      "m.agreement.list",
      buyers[0]!.headers,
      undefined,
      {},
      "?scene=plan_purchase",
    );
    const payment = {
      planId: pro.planId,
      months: 1,
      channel: "bank_transfer",
      expectAmountFen: quote["payFen"],
      agreementVersionIds: (
        terms["items"] as Array<{ currentVersion: { agreementVersionId: string } | null }>
      )
        .filter((a) => a.currentVersion)
        .map((a) => a.currentVersion!.agreementVersionId),
    };
    work.push({
      operationId: "m.paymentOrder.create",
      run: (n) => call("m.paymentOrder.create", buyers[n]!.headers, payment),
    });
  } else report["smokeExcluded"] = ["m.order.create", "m.paymentOrder.create"];
  const measurementDataset = await fixture.validatePrepared();
  report["measurementDataset"] = measurementDataset;
  report["measurementAdditionalCounts"] = Object.fromEntries(
    Object.entries(measurementDataset.counts).map(([table, count]) => [
      table,
      count - (seeded.counts[table] ?? 0),
    ]),
  );
  process.stderr.write(
    `P95实际HTTP采样开始: routes=${work.length}/c=${config.concurrency}/samples=${config.samples}\n`,
  );
  const routes: Array<P95Result & { operationId: string }> = [];
  for (const item of work) {
    if (!mounted.has(item.operationId)) throw new Error(`P95必测actual未挂载:${item.operationId}`);
    const result = await measure(item.run, config);
    routes.push({ operationId: item.operationId, ...result });
    process.stderr.write(
      `P95 ${item.operationId}: ${result.p95Ms.toFixed(1)}ms, errors=${result.failures}/${result.samples}\n`,
    );
  }
  report["routes"] = routes;
  report["afterActualWrites"] = await fixture.validatePrepared();
  report["excluded"] = [
    { operationId: "admin.workbench.alert.get", owner: "G7-B/M7 工作台读侧包（尚未拆编号）" },
    { operationId: "admin.workbench.feed.list", owner: "G7-B/M7 工作台读侧包（尚未拆编号）" },
    { operationId: "admin.workbench.today.get", owner: "G7-B/M7 工作台读侧包（尚未拆编号）" },
    { operationId: "admin.workbench.todo.get", owner: "G7-B/M7 工作台读侧包（尚未拆编号）" },
  ]
    .filter((r) => !mounted.has(r.operationId))
    .map((r) => ({ ...r, reason: "actual未落地，无样本" }));
  report["passed"] = reportPassed({ routes });
  process.exitCode = report["passed"] ? 0 : 1;
} catch (error) {
  report["passed"] = false;
  report["failure"] =
    error instanceof Error
      ? {
          name: error.name,
          code: "code" in error ? String(error.code) : "P95_FAILED",
          constraint: error.message.match(/(?:constraint|relation) "([a-z_0-9]+)"/)?.[1],
          reason:
            /^[A-Z_0-9]+$/.test(error.message) || /^P95/.test(error.message)
              ? error.message.slice(0, 240)
              : "数据前置或HTTP测量失败",
        }
      : { code: "P95_FAILED" };
  process.exitCode = 1;
} finally {
  report["durationMs"] = performance.now() - started;
  report["loadEnd"] = loadavg();
  try {
    const output = resolve(process.cwd(), "../..", config.out);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`P95报告:${config.out} passed=${report["passed"] === true}\n`);
  } finally {
    try {
      await new Promise<void>((done) => {
        if (server === undefined) done();
        else server.close(() => done());
      });
    } finally {
      await closeFixture?.();
    }
  }
}
