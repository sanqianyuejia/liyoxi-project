import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as kernel from "../kernel/index.js";
import type { Env } from "../kernel/index.js";
import { createMedia } from "../media/index.js";
import type { ModelBudgetTransport } from "../media/index.js";
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
const asr: NonNullable<Env["ASR_TENCENT"]> = {
  secretId: "AKIDEXAMPLE",
  secretKey: "PUBLIC_WORKER_ASR",
};
const llm: NonNullable<Env["LLM_DOMESTIC"]> = {
  text: {
    primary: { vendor: "deepseek", model: "worker-text", apiKey: "PUBLIC_TEXT" },
    backup: { vendor: "ark", model: "worker-backup", apiKey: "PUBLIC_BACKUP" },
  },
  vision: {
    primary: { vendor: "ark", model: "worker-vision", apiKey: "PUBLIC_VISION" },
    backup: {
      vendor: "bailian",
      model: "worker-vision-backup",
      apiKey: "PUBLIC_VISION_BACKUP",
      workspaceId: "test-space",
    },
  },
};
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
const clock = createClock();
let prisma: Awaited<ReturnType<typeof db.prisma>>;
let client: Awaited<ReturnType<typeof redis.raw>>;
const owned: ReturnType<typeof buildWorkerServices>[] = [];
const lifecycles: Array<ReturnType<typeof lifecycle>> = [];
const harnesses: Awaited<ReturnType<typeof createMediaAssetsHarness>>[] = [];
const producers: ReturnType<typeof createMedia>[] = [];
const selections = ["none", "asr", "llm", "both"] as const;
function lifecycle() {
  const drivers: Array<() => Promise<void>> = [];
  let closing: Promise<void> | undefined;
  const registerClose = vi.fn((close: () => Promise<void>) => {
    drivers.push(close);
  });
  const close = () =>
    (closing ??= Promise.allSettled(drivers.map((one) => Promise.resolve().then(one))).then(
      (results) => {
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
      },
    ));
  return { registerClose, close, drivers };
}
function build(
  selection: (typeof selections)[number] = "both",
  overrides: Partial<WorkerServicesOptions> = {},
) {
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
    keys: {
      ...(["asr", "both"].includes(selection) ? { ASR_TENCENT: asr } : {}),
      ...(["llm", "both"].includes(selection) ? { LLM_DOMESTIC: llm } : {}),
    },
    ...overrides,
  });
  owned.push(services);
  return { services, models };
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
}, SLOW);
afterEach(async () => {
  try {
    for (const producer of producers.splice(0)) await producer.jobs.shutdown();
    for (const h of harnesses.splice(0)) await h.close();
    for (const services of owned.splice(0)) {
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
  } finally {
    await Promise.allSettled(lifecycles.splice(0).map((one) => one.close()));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
}, SLOW);
function response(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
function chat(content: unknown) {
  return response({
    choices: [
      { finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } },
    ],
  });
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("worker真实模型选择与生命周期", { timeout: SLOW }, () => {
  it.each(["local", "test", "stg", "prod"] as const)(
    "%s四种显式组合构造零模型HTTP，准确登记本实例驱动",
    async (appEnv) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal("fetch", fetch);
      const assembly = vi.spyOn(kernel, "assembleProviders");
      for (const selection of selections) {
        const { services, models } = build(selection, { appEnv });
        expect(services.providers.asr.status).toBe(
          ["asr", "both"].includes(selection) ? "tencent" : "unconfigured",
        );
        expect(services.providers.llm.status).toBe(
          ["llm", "both"].includes(selection) ? "domestic-llm" : "unconfigured",
        );
        expect(models.registerClose).toHaveBeenCalledTimes(
          selection === "both" ? 2 : selection === "none" ? 0 : 1,
        );
        const input = assembly.mock.calls.at(-1)![0];
        expect(input.settings?.asr).toEqual(["asr", "both"].includes(selection) ? asr : undefined);
        expect(input.settings?.llm).toEqual(["llm", "both"].includes(selection) ? llm : undefined);
        if (input.asr) expect(input.asr.now()).toEqual(clock.now());
        expect(input.asr?.fetch).toBeUndefined();
        expect(input.llm?.fetch).toBeUndefined();
        expect(input.asr?.timeoutMs).toBeUndefined();
        expect(input.llm?.totalTimeoutMs).toBeUndefined();
        expect(services.closeModelDrivers === undefined).toBe(selection === "none");
      }
      expect(assembly).toHaveBeenCalledTimes(4);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, { registerClose: () => undefined }, { close: async () => undefined }])(
    "不完整成对生命周期在工厂前拒绝：%s",
    (modelDrivers) => {
      const assembly = vi.spyOn(kernel, "assembleProviders");
      expect(() =>
        build("both", { modelDrivers: modelDrivers as WorkerServicesOptions["modelDrivers"] }),
      ).toThrow(/成对/);
      expect(assembly).not.toHaveBeenCalled();
    },
  );

  it("借用整套providers时忽略模型配置与生命周期，不创建或关闭借用驱动", async () => {
    const providers = createFakeProviders({ clock }),
      factory = vi.spyOn(kernel, "assembleProviders");
    const { services, models } = build("both", { providers });
    expect(services.providers).toBe(providers);
    expect(factory).not.toHaveBeenCalled();
    expect(models.registerClose).not.toHaveBeenCalled();
    expect(services.closeModelDrivers).toBeUndefined();
    await models.close();
    expect(
      await providers.asr.transcribe({ url: "https://example.invalid/menu.wav" }),
    ).toMatchObject({ ok: true });
  });

  it("ASR构造后LLM配置失败仍保留已登记实际close，不回退默认驱动", async () => {
    const models = lifecycle();
    lifecycles.push(models);
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    expect(() =>
      build("both", {
        modelDrivers: models,
        keys: {
          ASR_TENCENT: asr,
          LLM_DOMESTIC: {
            ...llm,
            text: { ...llm.text, primary: { ...llm.text.primary, model: "bad model" } },
          },
        },
      }),
    ).toThrow(/配置/);
    expect(models.registerClose).toHaveBeenCalledOnce();
    expect(models.close()).toBe(models.close());
    await models.close();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["submit", "query", "extractKeyPoints", "analyzeVision"] as const)(
    "%s保留真实KF-1事务守卫，非法事务零HTTP",
    async (method) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal("fetch", fetch);
      const { services } = build();
      const tx = kernel.createTxRunner({ prisma, appEnv: "test" });
      const call = () =>
        method === "submit"
          ? services.providers.asr.submit({ url: "https://example.invalid/menu.wav" })
          : method === "query"
            ? services.providers.asr.query({ taskId: "123" })
            : method === "extractKeyPoints"
              ? services.providers.llm.extractKeyPoints({ text: "公开虚构菜单", maxPoints: 6 })
              : services.providers.llm.analyzeVision({
                  imageUrls: ["https://example.invalid/menu.png"],
                });
      await expect(tx.run(async () => call())).rejects.toBeInstanceOf(kernel.KernelViolation);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("实际COS普通GET两小时签名独立验HMAC；视觉仍限一小时且签发零HTTP", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const { services } = build("none", { keys: { COS: cos } });
    const storage = services.providers.storage;
    const input = { bucket: "asset" as const, key: "assets/public-audio.wav" };
    const signed = await storage.presignGet({ ...input, expiresSec: 7200 });
    expect(signed.ok).toBe(true);
    if (!signed.ok) throw new Error("缺少实际COS签名");
    const url = new URL(signed.value.url);
    const start = Math.floor(clock.now().getTime() / 1000);
    const time = `${start};${start + 7200}`;
    const signKey = createHmac("sha1", cos.worker!.secretKey).update(time).digest("hex");
    const request = `get\n/${input.key}\n\nhost=${url.hostname}\n`;
    const signature = createHmac("sha1", signKey)
      .update(`sha1\n${time}\n${createHash("sha1").update(request).digest("hex")}\n`)
      .digest("hex");
    expect(signed.value.expiresAt).toEqual(new Date((start + 7200) * 1000));
    expect(url.hostname).toBe("asset-1250000000.cos.ap-beijing.myqcloud.com");
    expect(url.searchParams.get("q-key-time")).toBe(time);
    expect(url.searchParams.get("q-sign-time")).toBe(time);
    expect(url.searchParams.get("q-ak")).toBe(cos.worker!.secretId);
    expect(url.searchParams.get("q-signature")).toBe(signature);
    expect(await storage.presignGet({ ...input, expiresSec: 7201 })).toMatchObject({ ok: false });
    expect(
      await storage.presignVisionGet({ ...input, expiresSec: 3600, source: { kind: "image" } }),
    ).toMatchObject({ ok: true });
    expect(
      await storage.presignVisionGet({ ...input, expiresSec: 3601, source: { kind: "image" } }),
    ).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("真实驱动使用该实例clock与原主备；显式调用仅发受控HTTP", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) =>
      new Headers(init?.headers).get("x-tc-action")
        ? response({
            Response: { RequestId: "public-request", Data: { TaskId: "9007199254740993" } },
          })
        : chat({ points: ["虚构菜单"] }),
    );
    vi.stubGlobal("fetch", fetch);
    const { services } = build();
    expect(
      await services.providers.asr.submit({ url: "https://example.invalid/menu.wav" }),
    ).toMatchObject({ ok: true, value: { taskId: "9007199254740993" } });
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("x-tc-timestamp")).toBe(
      String(Math.floor(clock.now().getTime() / 1000)),
    );
    expect(
      await services.providers.llm.extractKeyPoints({ text: "公开虚构菜单", maxPoints: 6 }),
    ).toMatchObject({ ok: true, value: { points: ["虚构菜单"] } });
    expect(String(fetch.mock.calls[0]![0])).toBe("https://asr.tencentcloudapi.com/");
    expect(String(fetch.mock.calls[1]![0])).toBe("https://api.deepseek.com/chat/completions");
  });

  it("实际ASR和LLM在途close均取消并清监听；重入关闭不影响另一实例", async () => {
    const entered = gate();
    let listening = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const signal = init!.signal!;
      let abort!: () => void;
      try {
        return await new Promise<Response>((_yes, no) => {
          abort = () => no(new Error("公开虚构已取消"));
          listening++;
          signal.addEventListener("abort", abort, { once: true });
          if (listening === 2) entered.release();
        });
      } finally {
        signal.removeEventListener("abort", abort);
        listening--;
      }
    });
    vi.stubGlobal("fetch", fetch);
    const first = build(),
      second = build();
    const work = [
      first.services.providers.asr.submit({ url: "https://example.invalid/menu.wav" }),
      first.services.providers.llm.extractKeyPoints({ text: "公开虚构菜单", maxPoints: 6 }),
    ];
    try {
      await entered.promise;
      const closing = first.services.closeModelDrivers!();
      expect(first.services.closeModelDrivers!()).toBe(closing);
      await closing;
      expect(await Promise.all(work)).toEqual([
        expect.objectContaining({ ok: false }),
        expect.objectContaining({ ok: false }),
      ]);
      expect(listening).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(
        await first.services.providers.asr.submit({ url: "https://example.invalid/menu.wav" }),
      ).toMatchObject({ ok: false });
      expect(
        await first.services.providers.llm.extractKeyPoints({ text: "菜单", maxPoints: 6 }),
      ).toMatchObject({ ok: false });
      fetch.mockImplementation(async () => chat({ points: ["第二实例"] }));
      expect(
        await second.services.providers.llm.extractKeyPoints({ text: "菜单", maxPoints: 6 }),
      ).toMatchObject({ ok: true });
      expect(await prisma.$queryRaw`SELECT 1 AS alive`).toEqual([{ alive: 1 }]);
      expect(channel.enqueue).not.toHaveBeenCalled();
    } finally {
      await first.models.close();
      await Promise.allSettled(work);
    }
  });
});

async function ready(
  kind: "asr" | "vision" | "digest",
  services: ReturnType<typeof buildWorkerServices>,
) {
  const h = await createMediaAssetsHarness(prisma);
  harnesses.push(h);
  h.clock.set(clock.now());
  // 公开producer以实际worker Provider状态创建job；执行改由真实worker promoteFile完成。
  const producer = createMedia({
    tx: h.tx,
    clock,
    assembly: h.assembly,
    events: h.events,
    storage: h.fake.storage,
    moderation: h.fake.media,
    assets: { ...h.assets, asr: services.providers.asr, llm: services.providers.llm },
  });
  producers.push(producer);
  let fileId: string | undefined;
  if (kind === "vision") {
    const file = await h.stored();
    const root = await prisma.mediaJob.findUniqueOrThrow({
      where: { dedupeKey: `audit_image:${file.id}:v1` },
    });
    await h.media.jobs.run({ jobId: root.id });
    expect(
      (await prisma.fileObject.findUniqueOrThrow({ where: { id: file.id } })).moderationState,
    ).toBe("pass");
    fileId = file.id;
  } else if (kind === "asr") {
    // 合法历史stored音频元数据；不宣称替身字节是原生音频验真或probe执行。
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
      etag: "public-audio-etag",
      crc64: "12345",
      sizeBytes: 48n,
      declaredSize: 48n,
    });
    fileId = file.id;
  }
  const asset = await producer.assets.create(
    h.owner,
    kind === "digest"
      ? { type: "text", textBody: "公开虚构门店菜单" }
      : { type: kind === "asr" ? "audio" : "image", fileIds: [fileId!] },
  );
  const predecessor = await prisma.mediaJob.findFirstOrThrow({
    where: {
      parentId: asset.storeAssetId,
      kind: kind === "digest" ? "audit_text" : kind === "vision" ? "audit_image_wx" : "probe",
    },
  });
  await producer.jobs.run({ jobId: predecessor.id });
  const job = await prisma.mediaJob.findFirstOrThrow({
    where: { parentId: asset.storeAssetId, kind },
  });
  expect(job.provider).toBe(kind === "asr" ? "tencent" : "domestic-llm");
  return { h, asset, job };
}
describe("真实worker付费owner保守准入", { timeout: SLOW }, () => {
  it("仅测试合法warm历史账本：实际COS两小时签名经预算后进入实际ASR受控HTTP", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      kernel.assertNotInTransaction("worker-models.asr-http");
      expect(String(url)).toBe("https://asr.tencentcloudapi.com/");
      expect(new Headers(init?.headers).get("x-tc-action")).toBe("CreateRecTask");
      const body = JSON.parse(String(init?.body)) as { Url: string };
      const signed = new URL(body.Url);
      const time = signed.searchParams.get("q-key-time")!.split(";").map(Number);
      expect(signed.hostname).toBe("asset-1250000000.cos.ap-beijing.myqcloud.com");
      expect(time[1]! - time[0]!).toBe(7200);
      return response({
        Response: { RequestId: "public-warm-asr", Data: { TaskId: "9007199254740993" } },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const key = `${redis.prefix}worker-models:model_budget:v1`;
    const evalCall = vi.fn<ModelBudgetTransport["eval"]>(async (script, keys, argv) => {
      kernel.assertNotInTransaction("worker-models.warm-redis");
      expect(keys).toEqual(["lyx:test:model_budget:v1"]);
      return client.eval(script, 1, key, ...argv);
    });
    const { services } = build("both", {
      keys: { ASR_TENCENT: asr, LLM_DOMESTIC: llm, COS: cos },
      modelBudgetTransport: { eval: evalCall },
    });
    const { h, job } = await ready("asr", services);
    clock.set(new Date());
    const at = clock.now().getTime(),
      [seconds, micros] = await client.time();
    // 仅自有测试HASH的合法历史；两个水位分别来自对应时钟，不提供生产初始化。
    await client.hset(key, {
      marker: "model_budget_v1",
      business: String(at - 1),
      redis: String(Number(seconds) * 1000 + Math.floor(Number(micros) / 1000) - 1),
      day: String(Math.floor((at + 28800000) / 86400000)),
      closed: "0",
      head: "1",
      next: "1",
      cursor: "1",
    });
    await prisma.paramValue.create({
      data: {
        id: kernel.uuidv7(),
        key: "media.model.daily_call_cap",
        value: 100,
        effectiveAt: clock.now(),
        createdByStaffId: h.staff.id,
        createdAt: clock.now(),
        reason: "仅受控HTTP测试正额度",
      },
    });
    const [submitSeconds, submitMicros] = await client.time();
    const baseline = Math.max(
      clock.now().getTime(),
      Number(submitSeconds) * 1000 + Math.floor(Number(submitMicros) / 1000),
    );
    const started = performance.now();
    const progressingNow = () => new Date(baseline + Math.floor(performance.now() - started));
    // 前置准备不占用短许可；提交时跟随真实时间，P1→P2 的 250ms 守卫仍生效。
    const moving = vi.spyOn(clock, "now").mockImplementation(progressingNow);
    try {
      await services.promoteFile({ jobId: job.id });
    } finally {
      const frozen = progressingNow();
      moving.mockRestore();
      clock.set(frozen);
    }
    expect(await prisma.mediaJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      state: "submitted",
      externalJobId: "9007199254740993",
    });
    expect(evalCall).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(await client.exists(key)).toBe(1);
    expect(await prisma.alertEvent.count()).toBe(0);
  });

  it.each(["asr", "vision", "digest"] as const)(
    "默认2000/0：%s拒绝模型HTTP且不触Redis",
    async (kind) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal("fetch", fetch);
      const evalCall = vi.fn<ModelBudgetTransport["eval"]>();
      const { services } = build("both", {
        keys: { ASR_TENCENT: asr, LLM_DOMESTIC: llm, COS: cos },
        modelBudgetTransport: { eval: evalCall },
      });
      const { job } = await ready(kind, services);
      await services.promoteFile({ jobId: job.id });
      const saved = await prisma.mediaJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(saved).toMatchObject({
        state: "succeeded",
        output: { status: "skipped", reason: "budget_unconfigured" },
      });
      expect(evalCall).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(await prisma.paramValue.count()).toBe(0);
    },
  );
  it.each(["asr", "vision", "digest"] as const)(
    "显式正额度但冷HASH：%s真实Redis拒绝且不自动初始化",
    async (kind) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal("fetch", fetch);
      const key = `${redis.prefix}worker-models:model_budget:v1`;
      const evalCall = vi.fn<ModelBudgetTransport["eval"]>(async (script, keys, argv) => {
        kernel.assertNotInTransaction("worker-models.redis");
        expect(keys).toEqual(["lyx:test:model_budget:v1"]);
        // 仅测试transport重定向exact固定key至自有prefix，不提供生产namespace覆盖口。
        return client.eval(script, 1, key, ...argv);
      });
      const { services } = build("both", {
        keys: { ASR_TENCENT: asr, LLM_DOMESTIC: llm, COS: cos },
        modelBudgetTransport: { eval: evalCall },
      });
      const { h, job } = await ready(kind, services);
      await prisma.paramValue.create({
        data: {
          id: kernel.uuidv7(),
          key: "media.model.daily_call_cap",
          value: 100,
          effectiveAt: clock.now(),
          createdByStaffId: h.staff.id,
          createdAt: clock.now(),
          reason: "公开虚构正额度",
        },
      });
      await services.promoteFile({ jobId: job.id });
      const saved = await prisma.mediaJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(saved).toMatchObject({
        state: "succeeded",
        output: { status: "skipped", reason: "budget_unavailable" },
      });
      expect(evalCall).toHaveBeenCalledOnce();
      expect(await client.exists(key)).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
      expect(await prisma.alertEvent.findMany()).toMatchObject([
        { rule: "media.model_budget_unavailable" },
      ]);
    },
  );
});
