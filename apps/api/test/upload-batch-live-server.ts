// Task-private entry: real production handlers/middleware, no production server switch.
import { readFile, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { createRuntime, loadEnv, runStartupChecks } from "@liyoxi/services";
import {
  AdminFileCreateBodySchema,
  AdminFileViewSchema,
  FileRegistrationSchema,
  StaffMeSchema,
} from "@liyoxi/contract";
import type { Env, RuntimeOptions } from "@liyoxi/services";
import {
  createProviderHarness,
  createOutputBatchToolsForTest,
  OutputBatchLiveInputSchema,
  findOutputBatchLiveJobIds,
  consumeOutputBatchLiveChecked,
  prepareOutputBatchLiveMasters,
  parseOutputBatchLiveManifest,
  assertContentAdminLiveScope,
  assertContentAdminLiveTargets,
  findContentAdminLiveJobIds,
  findAgreementLiveUploadJobIds,
  finishW120LiveFixture,
} from "@liyoxi/services/testing";
import type { ContentAdminLiveScope, OutputBatchLiveInput } from "@liyoxi/services/testing";
import { createApp } from "../src/app.js";
import type { Api } from "../src/app.js";
import { HANDLERS } from "../src/routes/index.js";
import { createOutputBatchCosStorage } from "./upload-batch-live-cos.js";
import { createOutputBatchMediaToolRelay } from "./upload-batch-live-mediatool.js";
import { attachOutputBatchLiveCloud } from "./upload-batch-live-cloud.js";

function assertScope(env: Env, prefix: string) {
  const database = new URL(env.DATABASE_URL),
    redis = new URL(env.REDIS_URL);
  const runId = /^lyx_test_admin_live_([a-f0-9]{16})$/.exec(database.pathname.slice(1))?.[1];
  if (
    env.APP_ENV !== "test" ||
    !runId ||
    prefix !== `lyx:test:admin_live_${runId}:` ||
    ![database, redis].every((url) => ["127.0.0.1", "localhost"].includes(url.hostname)) ||
    database.searchParams.get("options") !== "-c role=lyx_app"
  )
    throw new Error("W302 live requires the exact owned local test database and Redis prefix");
  return runId;
}

export { parseOutputBatchLiveManifest } from "@liyoxi/services/testing";
export async function startOutputBatchLiveServer(options: {
  env: Env;
  prefix: string;
  inputs: OutputBatchLiveInput;
  w312?: ContentAdminLiveScope;
  image: string;
  version?: string;
  documentWorkerUrl?: URL;
  signal?: AbortSignal;
}) {
  const runId = assertScope(options.env, options.prefix);
  const inputs = OutputBatchLiveInputSchema.parse(options.inputs);
  const w312 =
    options.w312 === undefined
      ? undefined
      : assertContentAdminLiveScope({ env: options.env }, options.w312);
  const contentFiles = new Set<string>();
  if (inputs.current.runId !== runId || inputs.legacy.runId !== runId)
    throw new Error("W302 input scope differs from the exact database");
  const { MEDIA_PRODUCTION: ignoredProduction, ...legacyEnv } = options.env;
  void ignoredProduction;
  const base: RuntimeOptions = {
    entry: "api",
    env: legacyEnv,
    version: options.version ?? "w302-private-live",
    redisKeyPrefix: options.prefix,
    documentWorkerUrl: options.documentWorkerUrl,
  };
  const realOwner = createRuntime(base),
    harness = createProviderHarness();
  const cos = createOutputBatchCosStorage({
    real: realOwner.providers.storage,
    fake: harness.providers.storage,
    now: () => realOwner.clock.now(),
  });
  const borrowed = { ...base, providers: { ...harness.providers, storage: cos.storage } };
  const runtimes: ReturnType<typeof createRuntime>[] = [];
  const apis: Api[] = [];
  const renderedPng = new Map<string, { sha256: string; size: number }>();
  let apiServer: ReturnType<typeof serve> | undefined,
    cosServer: ReturnType<typeof serve> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined, pending: Promise<void> | undefined;
  let masters: Awaited<ReturnType<typeof prepareOutputBatchLiveMasters>> | undefined;
  let relay: Awaited<ReturnType<typeof createOutputBatchMediaToolRelay>> | undefined;
  let cloud: ReturnType<typeof attachOutputBatchLiveCloud> | undefined;
  const agreementFiles = new Map<string, string>();
  const agreementPending = new Set<Promise<void>>();
  let closing = false;
  let stopped: Promise<void> | undefined;
  let startupCancellation: Promise<PromiseSettledResult<void>[]> | undefined;
  const cancelStartup = () => {
    closing = true;
    startupCancellation ??= Promise.allSettled(
      runtimes.map((runtime) => runtime.media.jobs.pause()),
    );
  };
  options.signal?.addEventListener("abort", cancelStartup, { once: true });
  const stop = () =>
    (stopped ??= (async () => {
      closing = true;
      for (const api of apis) api.readiness.state = "draining";
      if (interval) clearInterval(interval);
      // Cancel executor IO before waiting for a pump which may itself be awaiting that IO.
      const jobResults = await Promise.allSettled(
        runtimes.map((runtime) => runtime.media.jobs.shutdown()),
      );
      const pumpResults = await Promise.allSettled([pending]);
      const agreementResults = await Promise.allSettled([...agreementPending]);
      agreementFiles.clear();
      contentFiles.clear();
      const servers = [apiServer, cosServer].filter((server) => server !== undefined);
      const serverResults = await Promise.allSettled(
        servers.map(async (server) => {
          if ("closeAllConnections" in server) server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }),
      );
      const inputResults = await Promise.allSettled([masters?.cleanup()]);
      const pngResults = await Promise.allSettled(
        [...renderedPng.keys()].map(async (slot) => {
          if (!slot.startsWith("media/ci-out/")) throw new Error("Rendered PNG ownership mismatch");
          const result = await cos.storage.delete({ bucket: "media", key: slot.slice(6) });
          if (!result.ok) throw new Error("Rendered PNG cleanup failed");
        }),
      );
      const transportResults = await Promise.allSettled([
        Promise.resolve().then(() => cloud?.close()),
        Promise.resolve().then(() => cos.close()),
      ]);
      renderedPng.clear();
      const runtimeResults: PromiseSettledResult<void>[] = [];
      // Reverse construction order preserves the previously bound live scope until it closes.
      for (const runtime of [...[...runtimes].reverse(), realOwner])
        runtimeResults.push(...(await Promise.allSettled([runtime.close()])));
      const relayResults = await Promise.allSettled([relay?.close()]);
      if (
        [
          ...jobResults,
          ...pumpResults,
          ...agreementResults,
          ...serverResults,
          ...inputResults,
          ...pngResults,
          ...transportResults,
          ...runtimeResults,
          ...relayResults,
        ].some((r) => r.status === "rejected")
      )
        throw new Error("W302 live resources did not fully close");
    })());
  try {
    options.signal?.throwIfAborted();
    relay = await createOutputBatchMediaToolRelay({ runId, image: options.image });
    options.signal?.throwIfAborted();
    const tools = createOutputBatchToolsForTest({
      socketPath: relay.socketPath,
      workDir: relay.workDir,
      storage: cos.storage,
      rememberDerived: cos.rememberDerived,
      rememberRenderedPng: (ref, proof) => renderedPng.set(`${ref.bucket}/${ref.key}`, proof),
      releaseDirectory: relay.releaseDirectory,
      bindAttempt: relay.bindAttempt,
    });
    const batchEnv: Env = {
      ...legacyEnv,
      MEDIA_PRODUCTION: {
        workDir: relay.workDir,
        socketPath: relay.socketPath,
        aigc: {
          Label: "1",
          ContentProducer: "fictional-w302-test",
          ReservedCode1: "",
          ContentPropagator: "fictional-w302-test",
          ReservedCode2: "",
        },
        templates: {
          normalize: "test_normalize",
          sd: "test_sd",
          hd: "test_hd",
          sample: "test_sample",
          brand: "test_brand",
          ai: "test_ai",
        },
      },
    };
    cloud = attachOutputBatchLiveCloud({
      media: harness.providers.media,
      storage: cos.storage,
      tools,
      relay,
      storeIds: [
        inputs.current.storeId,
        inputs.legacy.storeId,
        ...(inputs.w120?.items.map((p) => p.scope.storeId) ?? []),
      ],
      pngProof: (ref) => renderedPng.get(`${ref.bucket}/${ref.key}`),
    });
    const batch = createRuntime({ ...borrowed, env: batchEnv, mediaProductionTools: tools });
    runtimes.push(batch);
    if (w312) await assertContentAdminLiveTargets(batch, w312);
    masters = await prepareOutputBatchLiveMasters(batch, inputs);
    options.signal?.throwIfAborted();
    const w120 = inputs.w120
      ? await finishW120LiveFixture(batch, inputs.w120, inputs.video, options.signal)
      : undefined;
    options.signal?.throwIfAborted();
    const batchApi = createApp({ runtime: batch, handlers: HANDLERS });
    apis.push(batchApi);
    await runStartupChecks(batch.startupChecks);
    options.signal?.throwIfAborted();
    const readAgreementData = async (request: Request, path: string) => {
      const headers = new Headers(request.headers);
      for (const key of ["content-length", "content-type", "transfer-encoding"])
        headers.delete(key);
      const response = await batchApi.app.fetch(
        new Request(new URL(path, request.url), { headers }),
      );
      if (!response.ok) throw new Error("本轮协议上传身份或文件读取失败");
      return ((await response.json()) as { data: unknown }).data;
    };
    const agreementFetch = async (
      request: Request,
      env?: Parameters<typeof batchApi.app.fetch>[1],
    ) => {
      const path = new URL(request.url).pathname;
      const registering = request.method === "POST" && path === "/api/v1/admin/files";
      const completing =
        request.method === "POST"
          ? /^\/api\/v1\/admin\/files\/([0-9a-f-]{36})\/complete$/.exec(path)?.[1]
          : undefined;
      const response = await batchApi.app.fetch(request, env);
      if (!response.ok || closing || (!registering && !completing)) return response;
      if (registering) {
        const body = (await response.clone().json()) as { data: unknown };
        const registration = FileRegistrationSchema.parse(body.data);
        const file = AdminFileViewSchema.parse(
          await readAgreementData(request, `/api/v1/admin/files/${registration.fileId}`),
        );
        if (
          file.category !== "legal_doc" ||
          file.scopeType !== "platform" ||
          file.entityId !== null ||
          file.storeId !== null ||
          file.uploader.actorType !== "staff" ||
          file.uploader.client !== "admin" ||
          !["docx", "pdf"].includes(file.ext)
        )
          return response;
        const me = StaffMeSchema.parse(await readAgreementData(request, "/api/v1/admin/auth/me"));
        if (file.uploader.actorId !== me.staff.staffId) throw new Error("本轮协议上传归属不符");
        if (agreementFiles.size >= 8 && !agreementFiles.has(registration.fileId))
          throw new Error("本轮协议上传执行范围已满");
        if (!closing) agreementFiles.set(registration.fileId, me.staff.staffId);
      } else if (completing && agreementFiles.has(completing)) {
        const expectedStaffId = agreementFiles.get(completing)!;
        const work = (async () => {
          const me = StaffMeSchema.parse(await readAgreementData(request, "/api/v1/admin/auth/me"));
          if (me.staff.staffId !== expectedStaffId) throw new Error("本轮协议上传完成归属不符");
          const ids = await findAgreementLiveUploadJobIds(batch, {
            staffId: expectedStaffId,
            fileIds: [completing],
          });
          for (const jobId of ids) {
            if (closing) break;
            await batch.media.promote({ jobId });
          }
          if (!closing) {
            const file = AdminFileViewSchema.parse(
              await readAgreementData(request, `/api/v1/admin/files/${completing}`),
            );
            if (["stored", "rejected", "expired", "deleting", "deleted"].includes(file.status))
              agreementFiles.delete(completing);
          }
        })();
        agreementPending.add(work);
        try {
          await work;
        } finally {
          agreementPending.delete(work);
        }
      }
      return response;
    };
    const apiOrigin = await new Promise<string>((resolve) => {
      apiServer = serve(
        {
          hostname: "127.0.0.1",
          port: 0,
          fetch: async (request, env) => {
            const path = new URL(request.url).pathname;
            let contentRegistration = false;
            if (w312 && request.method === "POST" && path === "/api/v1/admin/files") {
              const body = AdminFileCreateBodySchema.safeParse(
                await request
                  .clone()
                  .json()
                  .catch(() => undefined),
              );
              contentRegistration =
                body.success &&
                ["poster", "banner", "trailer_src", "drama_license_doc"].includes(
                  body.data.category,
                );
              if (contentRegistration && contentFiles.size >= 100)
                throw new Error("W312 observed file registrations exceeded the exact bound");
            }
            const response = await agreementFetch(request, env);
            if (contentRegistration && response.ok && !closing) {
              const value: unknown = await response.clone().json();
              const parsed = FileRegistrationSchema.safeParse(
                typeof value === "object" && value !== null && "data" in value
                  ? value.data
                  : undefined,
              );
              if (!parsed.success)
                throw new Error("W312 registration response is not a real file registration");
              contentFiles.add(parsed.data.fileId);
            }
            return response;
          },
        },
        ({ port }) => resolve(`http://127.0.0.1:${port}`),
      );
    });
    options.signal?.throwIfAborted();
    const cosOrigin = await new Promise<string>((resolve) => {
      cosServer = serve(
        { fetch: (request) => cos.fetch(request), hostname: "127.0.0.1", port: 0 },
        ({ port }) => resolve(`http://127.0.0.1:${port}`),
      );
    });
    options.signal?.throwIfAborted();
    for (const api of apis) api.readiness.state = "ready";
    // Original 15s cadence; exact owned IDs, never the all-database scanPromote.
    interval = setInterval(() => {
      if (pending) return;
      pending = Promise.all([
        findOutputBatchLiveJobIds(batch, inputs),
        w312 ? findContentAdminLiveJobIds(batch, w312, [...contentFiles]) : Promise.resolve([]),
      ])
        .then(async (groups) => {
          const ids = [...new Set(groups.flat())];
          for (let at = 0; at < ids.length; at += 2)
            await Promise.all(ids.slice(at, at + 2).map((jobId) => batch.media.promote({ jobId })));
          await consumeOutputBatchLiveChecked(batch, inputs);
        })
        .catch((error: unknown) =>
          batch.logger.error(
            { evt: "w302.media.pump", errorType: error instanceof Error ? error.name : "unknown" },
            "本轮批次任务执行失败",
          ),
        )
        .finally(() => {
          pending = undefined;
        });
    }, 15_000);
    return {
      apiOrigin,
      cosOrigin,
      runtime: batch,
      batchRuntime: batch,
      harness,
      cos,
      stop,
      toolResources: relay.resources,
      w120,
    };
  } catch (error) {
    // The current startup await settles before cleanup, including relay creation before assignment.
    try {
      await startupCancellation;
    } finally {
      await stop();
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancelStartup);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      "test-redis-prefix": { type: "string" },
      "input-manifest": { type: "string" },
      "mediatool-image": { type: "string" },
    },
  });
  if (!values["test-redis-prefix"] || !values["input-manifest"] || !values["mediatool-image"])
    throw new Error("Missing owned Redis prefix, input manifest or pinned image");
  const path = await realpath(values["input-manifest"]);
  const env = loadEnv(),
    runId = assertScope(env, values["test-redis-prefix"]);
  if (!path.includes(`/admin-live-${runId}/`) || !path.endsWith("/media-input.json"))
    throw new Error("Input manifest must be the exact owned temporary file");
  const manifest = parseOutputBatchLiveManifest(JSON.parse(await readFile(path, "utf8")));
  const controller = new AbortController();
  let server: Awaited<ReturnType<typeof startOutputBatchLiveServer>> | undefined;
  const cancel = () => {
    controller.abort();
    if (server)
      void server.stop().then(
        () => process.exit(0),
        () => process.exit(1),
      );
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, cancel);
  try {
    server = await startOutputBatchLiveServer({
      env,
      prefix: values["test-redis-prefix"],
      inputs: manifest.inputs,
      w312: manifest.w312,
      image: values["mediatool-image"],
      version: process.env.LYX_BUILD ?? "w302-private-live",
      documentWorkerUrl: new URL("./document-converter.js", import.meta.url),
      signal: controller.signal,
    });
    process.stdout.write(
      `${JSON.stringify({
        evt: "w302.live.listening",
        apiOrigin: server.apiOrigin,
        cosOrigin: server.cosOrigin,
        toolResources: server.toolResources,
        w120: server.w120,
      })}\n`,
    );
  } catch (error) {
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.removeListener(signal, cancel);
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch(() => {
    process.stderr.write("W302 private live server failed\n");
    process.exitCode = 1;
  });
