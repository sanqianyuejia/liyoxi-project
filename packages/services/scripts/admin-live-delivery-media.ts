// 仅核本轮已上传文件的归属与实际字节；技术结论由统一 Runtime 的真实 handler 产生。
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseOutputBatchLiveManifest } from "../src/testing/index.js";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  FILE_OBJECT_STATUS,
  MEDIA_CHECK_GATE,
  MEDIA_JOB_KIND,
  MEDIA_JOB_STATE,
  PLAYABLE_ASSET_STATE,
  PRODUCTION_RECORD_PIPELINE_STATE,
} from "@liyoxi/contract/enums";
import { createRuntime } from "../src/runtime.js";
import { createLogger } from "../src/logger.js";
import { fakeKeyEnv } from "../src/testing/staff.js";
import {
  ArtifactSchema,
  DeliveryLiveScopeSchema,
  assertDeliveryScope,
  cleanupDeliveryFile,
  prepareDeliveryKnownMedia,
  waitForDeliveryProduction,
} from "../src/testing/admin-live/delivery-known-media.js";
import type { KnownMediaInput } from "../src/testing/admin-live/delivery-known-media.js";
const root = fileURLToPath(new URL("../../../apps/admin/dist/tmp/", import.meta.url));
let phase = "environment";
let facts: Awaited<ReturnType<typeof readEvidence>> | undefined;
const enumValue = (values: readonly string[], value: unknown) => values.find((v) => v === value);
async function readEvidence(runtime: ReturnType<typeof createRuntime>, input: KnownMediaInput) {
  return runtime.tx.run(async (tx) => {
    const file = await tx.fileObject.findFirst({
      where: {
        id: input.fileId,
        originalName: `${input.scope.runId}-${input.artifact}.mp4`,
        scopeType: "store",
        entityId: input.scope.entityId,
        storeId: input.scope.storeId,
        createdAt: { gte: new Date(input.scope.startedAt) },
      },
      select: {
        status: true,
        productionRecord: { select: { pipelineState: true } },
      },
    });
    if (!file) return undefined;
    const check = await tx.mediaCheck.findUnique({
      where: { fileId: input.fileId },
      select: { gate: true },
    });
    const playables = await tx.playableAsset.findMany({
      where: {
        sourceFileId: input.fileId,
        ownerType: "order_item",
        ownerId: input.scope.itemId,
        kind: "sample",
      },
      orderBy: { id: "desc" },
      take: 20,
      select: { id: true, state: true },
    });
    const jobs = await tx.mediaJob.findMany({
      where: {
        OR: [
          { subjectType: "file_object", subjectId: input.fileId },
          { parentType: "playable_asset", parentId: { in: playables.map((p) => p.id) } },
        ],
        createdAt: { gte: new Date(input.scope.startedAt) },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      select: { kind: true, state: true },
    });
    return {
      fileStatus: enumValue(FILE_OBJECT_STATUS.values, file.status),
      pipelineState: enumValue(
        PRODUCTION_RECORD_PIPELINE_STATE.values,
        file.productionRecord?.pipelineState,
      ),
      checkGate: enumValue(MEDIA_CHECK_GATE.values, check?.gate),
      jobs: jobs.map((job) => ({
        kind: enumValue(MEDIA_JOB_KIND.values, job.kind),
        state: enumValue(MEDIA_JOB_STATE.values, job.state),
      })),
      playables: playables.map((p) => enumValue(PLAYABLE_ASSET_STATE.values, p.state)),
    };
  });
}
async function main() {
  if (
    process.env.APP_ENV !== "test" ||
    Object.keys(process.env).some((key) => key.endsWith("_FILE"))
  )
    throw new Error("只接受无密钥文件的显式 test 环境");
  phase = "context";
  const { values } = parseArgs({
    options: {
      context: { type: "string" },
      "file-id": { type: "string" },
      "client-token": { type: "string" },
      artifact: { type: "string" },
      cleanup: { type: "boolean", default: false },
    },
  });
  if (!values.context) throw new Error("需要本轮 context");
  const file = await realpath(values.context);
  const context = JSON.parse(await readFile(file, "utf8")) as {
    fixtures?: { fixtures?: Record<string, { scope?: unknown }> };
  };
  const scope = DeliveryLiveScopeSchema.parse(
    context.fixtures?.fixtures?.["zz-delivery-flow"]?.scope,
  );
  if (
    file !== resolve(root, `admin-live-${scope.runId}`, "context.json") ||
    scope.name !== `lyx_test_admin_live_${scope.runId}` ||
    scope.prefix !== `lyx:test:admin_live_${scope.runId}:`
  )
    throw new Error("只接受本检出本轮 context");
  const artifact = ArtifactSchema.parse(values.artifact),
    fileId = z.string().uuid().parse(values["file-id"]),
    clientToken = z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .parse(values["client-token"]);
  const env = {
    APP_ENV: "test" as const,
    LOG_LEVEL: "error" as const,
    DATABASE_URL: `postgresql://liyoxi:lyx-local-dev@127.0.0.1:5442/${scope.name}?options=-c%20role%3Dlyx_app`,
    REDIS_URL: "redis://127.0.0.1:6389/0",
    ...fakeKeyEnv(),
  };
  assertDeliveryScope(env, scope);
  phase = "runtime";
  const runtime = createRuntime({
    entry: "api",
    env,
    version: "lyxtest.w119b_media",
    redisKeyPrefix: scope.prefix,
    logger: createLogger({
      svc: "api",
      env: "test",
      level: "error",
      version: "lyxtest.w119b_media",
      destination: process.stderr,
    }),
  });
  try {
    phase = "input";
    const { inputs: manifest } = parseOutputBatchLiveManifest(
      JSON.parse(
        await readFile(resolve(root, `admin-live-${scope.runId}`, "media-input.json"), "utf8"),
      ),
    );
    if (JSON.stringify(manifest.legacy) !== JSON.stringify(scope))
      throw new Error("真实视频输入与本轮交付 scope 不同");
    const path = await realpath(manifest.video.path);
    if (path !== resolve(root, `admin-live-${scope.runId}`, "video.mp4"))
      throw new Error("视频不属于本轮自有目录");
    const bytes = await readFile(path);
    if (
      bytes.length !== manifest.video.size ||
      createHash("sha256").update(bytes).digest("hex") !== manifest.video.sha256
    )
      throw new Error("本轮视频实际字节与输入证明不一致");
    const video = {
      size: bytes.length,
      sha256: manifest.video.sha256,
      md5: createHash("md5").update(bytes).digest("hex"),
    };
    const input = { scope, artifact, fileId, clientToken, video };
    try {
      phase = "observe";
      if (!values.cleanup) await waitForDeliveryProduction(runtime, input);
      phase = values.cleanup ? "cleanup" : "verify";
      const result = values.cleanup
        ? await cleanupDeliveryFile(runtime, input)
        : await prepareDeliveryKnownMedia(runtime, input);
      phase = "output";
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      // 诊断只读已核本轮文件；查询失败仍保留原失败，不回显 SQL 或原始错误。
      facts = await readEvidence(runtime, input).catch(() => undefined);
      throw error;
    }
  } finally {
    await runtime.close();
  }
}
main().catch((error: unknown) => {
  const category =
    error instanceof Error && error.message === "本轮真实生产体检或样片水印尚未完成"
      ? "observation_timeout"
      : error instanceof Error && error.message === "W119B 本轮文件归属或已知事实不一致"
        ? "guard_rejected"
        : "error";
  process.stderr.write(
    `${JSON.stringify({ evt: "w119.bridge.failed", phase, category, facts })}\n`,
  );
  process.stderr.write("W119B 窄桥拒绝或文件入库未完成\n");
  process.exitCode = 1;
});
