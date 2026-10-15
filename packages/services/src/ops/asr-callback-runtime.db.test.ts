import { createHmac } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertNotInTransaction, createIdentityContext, loadEnv, uuidv7 } from "../kernel/index.js";
import type { Env } from "../kernel/index.js";
import { createLogger } from "../logger.js";
import { createMedia } from "../media/index.js";
import type { ModelBudgetTransport } from "../media/index.js";
import { createRuntime } from "../runtime.js";
import {
  assembleForTest,
  createClock,
  createFakeProviders,
  createMediaAssetsHarness,
  useSeededDatabase,
  useTestRedis,
} from "../testing/index.js";
import { buildWorkerServices } from "./index.js";
import type { WorkerServicesOptions } from "./index.js";

const db = useSeededDatabase("services", { max: 1 }),
  redis = useTestRedis(),
  SLOW = 120000;
const clock = createClock();
const asr = Object.freeze({ secretId: "AKIDEXAMPLE", secretKey: "PUBLIC_CALLBACK_WORKER" });
const callback = Object.freeze({ origin: "https://callbacks.example.com", key: "界".repeat(11) });
const cos: NonNullable<Env["COS"]> = {
  region: "ap-beijing",
  buckets: {
    secure: "secure-1250000000",
    asset: "asset-1250000000",
    media: "media-1250000000",
    pub: "pub-1250000000",
  },
  worker: { secretId: "PUBLIC_COS_ID", secretKey: "PUBLIC_COS_KEY" },
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const channel = { enqueue: vi.fn(async () => undefined), downForMs: () => 0 };
const taskId = "9007199254740993";
const context = createIdentityContext({
  actor: { type: "system", job: "security.webhook_receive" },
});
let prisma: Awaited<ReturnType<typeof db.prisma>>;
let client: Awaited<ReturnType<typeof redis.raw>>;
const workers: ReturnType<typeof buildWorkerServices>[] = [];
const apis: ReturnType<typeof createRuntime>[] = [];
const lifecycles: ReturnType<typeof lifecycle>[] = [];
const harnesses: Awaited<ReturnType<typeof createMediaAssetsHarness>>[] = [];
const producers: ReturnType<typeof createMedia>[] = [];
function lifecycle() {
  const closers: Array<() => Promise<void>> = [];
  let closing: Promise<void> | undefined;
  return {
    registerClose: vi.fn((close: () => Promise<void>) => closers.push(close)),
    close: vi.fn(
      () => (closing ??= Promise.allSettled(closers.map((close) => close())).then(() => {})),
    ),
  };
}
function response(data: unknown) {
  return new Response(JSON.stringify({ Response: data }), {
    headers: { "content-type": "application/json" },
  });
}
function transport() {
  const key = `${redis.prefix}callback:model_budget:v1`;
  const evalCall = vi.fn<ModelBudgetTransport["eval"]>(async (script, keys, argv) => {
    assertNotInTransaction("回调测试预算Redis");
    expect(keys).toEqual(["lyx:test:model_budget:v1"]);
    return client.eval(script, 1, key, ...argv);
  });
  return { key, evalCall, port: { eval: evalCall } };
}
function build(overrides: Partial<WorkerServicesOptions> = {}) {
  const models = lifecycle();
  lifecycles.push(models);
  const services = buildWorkerServices({
    appEnv: "test",
    prisma,
    clock,
    logger,
    channel,
    assembly: assembleForTest({ entry: "worker" }),
    modelDrivers: models,
    keys: { ASR_TENCENT: asr, ASR_CALLBACK: callback, COS: cos },
    ...overrides,
  });
  workers.push(services);
  return { services, models };
}
async function api() {
  const models = lifecycle();
  lifecycles.push(models);
  const runtime = createRuntime({
    entry: "api",
    version: "callback-runtime",
    clock,
    modelDrivers: models,
    env: {
      ...loadEnv({
        APP_ENV: "test",
        DATABASE_URL: await db.url(),
        REDIS_URL: process.env.REDIS_URL,
      }),
      ASR_TENCENT: asr,
      ASR_CALLBACK: callback,
      COS: {
        ...cos,
        signer: { secretId: "PUBLIC_SIGNER", secretKey: "PUBLIC_SIGNER_KEY" },
        stsIssuer: { secretId: "PUBLIC_ISSUER", secretKey: "PUBLIC_ISSUER_KEY" },
      },
    },
    redisKeyPrefix: redis.prefix,
    logger: createLogger({
      svc: "api",
      env: "test",
      level: "error",
      version: "callback",
      destination: { write() {} },
    }),
  });
  apis.push(runtime);
  return runtime;
}
async function ready(services: ReturnType<typeof buildWorkerServices>) {
  const h = await createMediaAssetsHarness(prisma);
  harnesses.push(h);
  h.clock.set(clock.now());
  // 合法历史stored音频事实；仅公开虚构字节元数据，不宣称原生probe/真实云验真。
  const file = await h.make.fileObject({
    bucket: "asset",
    category: "store_asset",
    scopeType: "store",
    entityId: h.merchant.entity.id,
    storeId: h.merchant.store.id,
    uploadActorType: "merchant",
    uploadActorId: h.merchant.user.id,
    uploadClient: "weapp",
    ext: "wav",
    mime: "audio/wav",
    declaredMime: "audio/wav",
    etag: "public-asr-etag",
    crc64: "12345",
    sizeBytes: 48n,
    declaredSize: 48n,
  });
  const producer = createMedia({
    tx: h.tx,
    clock,
    assembly: h.assembly,
    events: h.events,
    storage: h.fake.storage,
    moderation: h.fake.media,
    assets: { ...h.assets, asr: services.providers.asr },
  });
  producers.push(producer);
  const asset = await producer.assets.create(h.owner, { type: "audio", fileIds: [file.id] });
  const probe = await prisma.mediaJob.findFirstOrThrow({
    where: { parentId: asset.storeAssetId, kind: "probe" },
  });
  await producer.jobs.run({ jobId: probe.id });
  const job = await prisma.mediaJob.findFirstOrThrow({
    where: { parentId: asset.storeAssetId, kind: "asr" },
  });
  expect(job).toMatchObject({ state: "queued", mode: "remote", provider: "tencent", attemptNo: 0 });
  return { h, file, asset, job, producer };
}
async function caps(
  h: Awaited<ReturnType<typeof createMediaAssetsHarness>>,
  value: number,
  at = clock.now(),
) {
  await prisma.paramValue.create({
    data: {
      id: uuidv7(),
      key: "media.model.daily_call_cap",
      value,
      effectiveAt: at,
      createdAt: clock.now(),
      createdByStaffId: h.staff.id,
      reason: "公开虚构回调组合测试额度",
    },
  });
}
async function warm(
  port: ReturnType<typeof transport>,
  h: Awaited<ReturnType<typeof createMediaAssetsHarness>>,
) {
  clock.set(new Date());
  const now = clock.now().getTime(),
    [seconds, micros] = await client.time();
  // 只给自有测试HASH准备合法历史；独立时钟水位，不提供生产初始化入口。
  await client.hset(port.key, {
    marker: "model_budget_v1",
    business: String(now - 1),
    redis: String(Number(seconds) * 1000 + Math.floor(Number(micros) / 1000) - 1),
    day: String(Math.floor((now + 28800000) / 86400000)),
    closed: "0",
    head: "1",
    next: "1",
    cursor: "1",
  });
  await caps(h, 100);
}
async function submit(services: ReturnType<typeof buildWorkerServices>, jobId: string) {
  const [seconds, micros] = await client.time();
  const baseline = Math.max(
    clock.now().getTime(),
    Number(seconds) * 1000 + Math.floor(Number(micros) / 1000),
  );
  const started = performance.now();
  const progressingNow = () => new Date(baseline + Math.floor(performance.now() - started));
  // Redis TIME 校准后持续走时；P1 前的准备不占用许可，真实 P1→P2 的 250ms 仍生效。
  const moving = vi.spyOn(clock, "now").mockImplementation(progressingNow);
  try {
    await services.promoteFile({ jobId });
  } finally {
    const frozen = progressingNow();
    moving.mockRestore();
    clock.set(frozen);
  }
}
async function receive(
  runtime: ReturnType<typeof createRuntime>,
  id: string,
  external = taskId,
  key = callback.key,
) {
  const prepared = await runtime.webhooks.prepare("asr", {
    method: "POST",
    operationId: "hooks.asr.mediaJob.wake",
    rawBody: new TextEncoder().encode(`requestId=${external}&text=untrusted&status=success`),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    params: { mediaJobId: id },
    query: { sig: createHmac("sha256", key).update(id).digest("base64url") },
  });
  if (prepared.kind === "reply") return prepared;
  return runtime.webhooks.accept(prepared, context);
}
function http() {
  const calls = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    assertNotInTransaction("真实腾讯驱动受控HTTP");
    expect(String(url)).toBe("https://asr.tencentcloudapi.com/");
    const headers = new Headers(init?.headers);
    expect(headers.get("host")).toBe("asr.tencentcloudapi.com");
    if (headers.get("x-tc-action") === "CreateRecTask")
      return response({ RequestId: "public-submit", Data: { TaskId: taskId } });
    expect(headers.get("x-tc-action")).toBe("DescribeTaskStatus");
    expect(String(init?.body)).toBe(`{"TaskId":${taskId}}`);
    return response({
      RequestId: "public-query",
      Data: {
        TaskId: taskId,
        Status: 2,
        StatusStr: "success",
        AudioDuration: 1,
        Result: "真正查询的公开虚构识别结果",
        ResultDetail: [{ StartMs: 0, EndMs: 1000, FinalSentence: "真正查询的公开虚构识别结果" }],
      },
    });
  });
  vi.stubGlobal("fetch", calls);
  return calls;
}
beforeAll(async () => {
  prisma = await db.prisma();
  client = await redis.raw();
}, SLOW);
beforeEach(async () => {
  await db.reset();
  await redis.flush();
  clock.set(new Date());
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("未授权测试HTTP");
    }),
  );
}, SLOW);
afterEach(async () => {
  try {
    for (const producer of producers.splice(0)) await producer.jobs.shutdown();
    for (const h of harnesses.splice(0)) await h.close();
    for (const runtime of apis.splice(0).reverse()) await runtime.close();
    for (const services of workers.splice(0)) {
      services.disableModelBudget?.();
      await services.shutdownMediaJobs?.();
      await Promise.allSettled([
        services.closeDocs(),
        services.closeNotify(),
        services.closeAnalytics?.(),
        services.closeBillingTimers?.(),
        services.closeOrder?.(),
        services.closePublish?.(),
        services.closeDelivery?.(),
        services.closeProfile?.(),
        services.closeInvitations?.(),
        services.closeApproval?.(),
        services.closeWebhooks?.(),
        services.closeMediaJobs?.(),
        services.closeStaff?.(),
        services.closeSmsHealth?.(),
        services.closeMediaDrivers?.(),
        services.closeStorageDrivers?.(),
        services.closeModelDrivers?.(),
      ]);
      await services.closeModelBudget?.();
      await services.closeAlertFacts?.();
    }
    await Promise.allSettled(lifecycles.splice(0).map((models) => models.close()));
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
}, SLOW);

describe("正式ASR回调发送与默认接收组合", { timeout: SLOW }, () => {
  it.each([false, true])("worker回调配置=%s仅实际job.id进入原CreateRecTask", async (enabled) => {
    const calls = http(),
      port = transport();
    const { services, models } = build({
      keys: { ASR_TENCENT: asr, COS: cos, ...(enabled ? { ASR_CALLBACK: callback } : {}) },
      modelBudgetTransport: port.port,
    });
    expect(calls).not.toHaveBeenCalled();
    expect(models.registerClose).toHaveBeenCalledOnce();
    const facts = await ready(services);
    await warm(port, facts.h);
    await submit(services, facts.job.id);
    const saved = await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } });
    expect(saved).toMatchObject({ state: "submitted", externalJobId: taskId, attemptNo: 1 });
    expect(calls).toHaveBeenCalledOnce();
    expect(port.evalCall).toHaveBeenCalledOnce();
    const body = JSON.parse(String(calls.mock.calls[0]![1]?.body)) as {
      Url: string;
      CallbackUrl?: string;
    };
    expect(
      new URL(body.Url).searchParams
        .get("q-key-time")!
        .split(";")
        .map(Number)
        .reduce((a, b) => b - a),
    ).toBe(7200);
    if (enabled) {
      const url = new URL(body.CallbackUrl!);
      expect(url.origin).toBe(callback.origin);
      expect(url.pathname).toBe(`/api/v1/hooks/asr/media-jobs/${facts.job.id}`);
      expect(url.searchParams.get("sig")).toBe(
        createHmac("sha256", callback.key).update(facts.job.id).digest("base64url"),
      );
      expect(url.pathname).not.toContain(facts.file.id);
      expect(url.pathname).not.toContain(facts.asset.storeAssetId);
    } else expect(Object.hasOwn(body, "CallbackUrl")).toBe(false);
    expect(models.close()).toBe(models.close());
    await models.close();
  });

  it.each(["zero-caps", "cold-ledger"] as const)(
    "真实API默认来源收件后%s也只查询原TaskId，不再次预留或提交",
    async (later) => {
      const calls = http(),
        port = transport(),
        { services } = build({ modelBudgetTransport: port.port });
      const facts = await ready(services);
      await warm(port, facts.h);
      await submit(services, facts.job.id);
      const submitted = await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } });
      expect(submitted).toMatchObject({ state: "submitted", externalJobId: taskId });
      const receiver = await api();
      clock.advance(1);
      if (later === "zero-caps") await caps(facts.h, 0);
      else await client.unlink(port.key); // 只移除本例自有历史fixture，生产不会初始化/恢复。
      const before = await prisma.storeAssetInsight.findMany();
      expect((await receive(receiver, facts.job.id)).status).toBe(200);
      expect(await prisma.storeAssetInsight.findMany()).toEqual(before);
      expect(await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } })).toEqual({
        ...submitted,
        nextRunAt: clock.now(),
        updatedAt: clock.now(),
      });
      const receipts = await prisma.webhookEvent.findMany();
      expect(receipts).toEqual([
        expect.objectContaining({
          processState: "processed",
          payload: null,
          eventId: `${facts.job.id}:${taskId}`,
        }),
      ]);
      expect((await receive(receiver, facts.job.id)).status).toBe(200);
      expect(await prisma.webhookEvent.findMany()).toEqual(receipts);
      expect(calls).toHaveBeenCalledOnce();
      expect(port.evalCall).toHaveBeenCalledOnce();
      await services.promoteFile({ jobId: facts.job.id });
      expect(
        await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } }),
      ).toMatchObject({ state: "succeeded", externalJobId: taskId });
      const transcript = await prisma.storeAssetInsight.findFirstOrThrow({
        where: { storeAssetId: facts.asset.storeAssetId, kind: "transcript" },
      });
      expect(transcript).toMatchObject({
        status: "ok",
        provider: "tencent",
        mediaJobId: facts.job.id,
        content: { text: "真正查询的公开虚构识别结果" },
      });
      expect(JSON.stringify(transcript.content)).not.toContain("untrusted");
      expect(calls).toHaveBeenCalledTimes(2);
      expect(port.evalCall).toHaveBeenCalledOnce();
      expect(new Headers(calls.mock.calls[1]![1]?.headers).get("x-tc-action")).toBe(
        "DescribeTaskStatus",
      );
      expect(String(calls.mock.calls[1]![1]?.body)).not.toContain("CallbackUrl");
      expect(
        await prisma.mediaJob.count({ where: { parentId: facts.asset.storeAssetId, kind: "asr" } }),
      ).toBe(1);
      const next = await facts.producer.assets.create(facts.h.owner, {
        type: "audio",
        fileIds: [facts.file.id],
      });
      const probe = await prisma.mediaJob.findFirstOrThrow({
        where: { parentId: next.storeAssetId, kind: "probe" },
      });
      await facts.producer.jobs.run({ jobId: probe.id });
      const cached = await prisma.mediaJob.findFirstOrThrow({
        where: { parentId: next.storeAssetId, kind: "asr" },
      });
      const signing = vi.spyOn(services.providers.storage, "presignGet");
      await services.promoteFile({ jobId: cached.id });
      expect(await prisma.mediaJob.findUniqueOrThrow({ where: { id: cached.id } })).toMatchObject({
        state: "succeeded",
        output: { status: "ok", reusedFromId: transcript.id },
      });
      expect(
        await prisma.storeAssetInsight.findFirstOrThrow({
          where: { storeAssetId: next.storeAssetId, kind: "transcript" },
        }),
      ).toMatchObject({
        reusedFromStoreAssetInsightId: transcript.id,
        content: transcript.content,
      });
      expect(signing).not.toHaveBeenCalled();
      expect(port.evalCall).toHaveBeenCalledOnce();
      expect(calls).toHaveBeenCalledTimes(2);
    },
  );

  it("真实早到回调只记ignored；原提交和轮询仍可正常推进", async () => {
    const calls = http(),
      port = transport(),
      { services } = build({ modelBudgetTransport: port.port });
    const facts = await ready(services),
      receiver = await api();
    expect((await receive(receiver, facts.job.id)).status).toBe(200);
    expect(await prisma.webhookEvent.findFirstOrThrow()).toMatchObject({
      processState: "ignored",
      payload: null,
    });
    expect(await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } })).toEqual(
      facts.job,
    );
    await warm(port, facts.h);
    await submit(services, facts.job.id);
    const submitted = await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } });
    clock.set(submitted.nextRunAt);
    await services.promoteFile({ jobId: facts.job.id });
    expect(await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } })).toMatchObject({
      state: "succeeded",
      externalJobId: taskId,
    });
    expect(calls).toHaveBeenCalledTimes(2);
    expect(port.evalCall).toHaveBeenCalledOnce();
  });

  it("真实submitted收件处理后抛错回滚receipt和nextRunAt，原任务仍可轮询", async () => {
    const calls = http(),
      port = transport();
    const { services } = build({ modelBudgetTransport: port.port });
    const facts = await ready(services);
    await warm(port, facts.h);
    await submit(services, facts.job.id);
    const receiver = await api();
    const before = await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } });
    clock.advance(1);
    const original = receiver.media.wakeAsrJob.bind(receiver.media);
    const handler = vi.spyOn(receiver.media, "wakeAsrJob").mockImplementation(async (tx, input) => {
      expect(await original(tx, input)).toBe("processed");
      expect(await tx.webhookEvent.count()).toBe(1);
      expect(await tx.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } })).toMatchObject({
        nextRunAt: clock.now(),
      });
      throw new Error("公开虚构真实wake后失败");
    });
    expect((await receive(receiver, facts.job.id)).status).toBe(500);
    expect(await prisma.webhookEvent.count()).toBe(0);
    expect(await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } })).toEqual(
      before,
    );
    handler.mockRestore();
    clock.set(before.nextRunAt);
    await services.promoteFile({ jobId: facts.job.id });
    expect(await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } })).toMatchObject({
      state: "succeeded",
      externalJobId: taskId,
    });
    expect(calls).toHaveBeenCalledTimes(2);
    expect(port.evalCall).toHaveBeenCalledOnce();
  });

  it.each(["task", "provider", "expired", "file"] as const)(
    "完整默认source仍拒绝%s已变化的原任务事实",
    async (changed) => {
      const calls = http(),
        port = transport(),
        { services } = build({ modelBudgetTransport: port.port });
      const facts = await ready(services);
      await warm(port, facts.h);
      await submit(services, facts.job.id);
      const receiver = await api();
      clock.advance(1);
      if (changed === "provider")
        await prisma.mediaJob.update({
          where: { id: facts.job.id },
          data: { provider: "unconfigured" },
        });
      if (changed === "expired")
        clock.set(
          (await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } })).deadlineAt,
        );
      if (changed === "file")
        await prisma.fileObject.update({
          where: { id: facts.file.id },
          data: { etag: "changed-public-etag" },
        });
      const before = await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } });
      expect(
        (await receive(receiver, facts.job.id, changed === "task" ? "123" : taskId)).status,
      ).toBe(200);
      expect(await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } })).toEqual(
        before,
      );
      expect(await prisma.webhookEvent.findFirstOrThrow()).toMatchObject({
        processState: "ignored",
        payload: null,
      });
      expect(calls).toHaveBeenCalledOnce();
      expect(port.evalCall).toHaveBeenCalledOnce();
    },
  );

  it("API无预算transport但有默认来源：误驱动新任务仍关闭且无CreateRecTask", async () => {
    const receiver = await api(),
      facts = await ready(build().services);
    await caps(facts.h, 100);
    const calls = http();
    await receiver.media.jobs.run({ jobId: facts.job.id });
    const saved = await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } });
    expect(saved).toMatchObject({
      state: "succeeded",
      output: { status: "skipped", reason: "budget_unavailable" },
    });
    expect(saved.externalJobId).toBeNull();
    expect(calls).not.toHaveBeenCalled();
    expect((await receive(receiver, facts.job.id)).status).toBe(200);
    expect(await prisma.webhookEvent.findFirstOrThrow()).toMatchObject({ processState: "ignored" });
    expect(calls).not.toHaveBeenCalled();
  });

  it("借用完整腾讯公开状态不会自动加入逐次callback上下文或登记close", async () => {
    const fake = createFakeProviders({ clock });
    const submitted = vi.fn<typeof fake.asr.submit>(async () => ({
      ok: true,
      value: { taskId, requestId: "public-borrowed" },
    }));
    const providers = {
      ...fake,
      asr: { ...fake.asr, status: "tencent" as const, submit: submitted },
    };
    const port = transport(),
      { services, models } = build({ providers, modelBudgetTransport: port.port });
    const facts = await ready(services);
    await warm(port, facts.h);
    await submit(services, facts.job.id);
    expect(await prisma.mediaJob.findUniqueOrThrow({ where: { id: facts.job.id } })).toMatchObject({
      state: "submitted",
      externalJobId: taskId,
    });
    expect(submitted).toHaveBeenCalledOnce();
    expect(submitted.mock.calls[0]![0]).not.toHaveProperty("callback");
    expect(models.registerClose).not.toHaveBeenCalled();
    expect(services.closeModelDrivers).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
