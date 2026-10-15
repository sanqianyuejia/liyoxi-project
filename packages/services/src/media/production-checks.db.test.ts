import { createHash } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@liyoxi/db";
import { createMedia } from "./runtime.js";
import { createEvents } from "../events/index.js";
import { assertNotInTransaction, createTxRunner, uuidv7, lockRows } from "../kernel/index.js";
import {
  assembleForTest,
  createClock,
  createFactories,
  createFakeProviders,
  useSeededDatabase,
} from "../testing/index.js";
import { declareManualProduction } from "./production-stub.js";
import type { MediaProductionDeps } from "./production-types.js";
import type {
  AigcLabel,
  ProbeReport,
  MediaToolClient,
  MediaWorkspace,
} from "../providers/types.js";
import { ok, failed } from "../providers/types.js";
const handle = useSeededDatabase("services"),
  clock = createClock();
let db: PrismaClient;
const owned: ReturnType<typeof createMedia>[] = [];
beforeAll(async () => {
  db = await handle.prisma();
});
afterEach(async () => {
  await Promise.all(owned.splice(0).map((one) => one.jobs.shutdown()));
  vi.restoreAllMocks();
});
const body = new Uint8Array([1, 2, 3]),
  digest = createHash("sha256").update(body).digest("hex");
const upstream: AigcLabel = {
  Label: "1",
  ContentProducer: "PUBLIC-UPSTREAM",
  ProduceID: "upstream-public-id",
  ReservedCode1: "keep-one",
  ContentPropagator: "PUBLIC-PROPAGATOR",
  PropagateID: "propagated-id",
  ReservedCode2: "keep-two",
};
function report(label: string | null = null, width = 1080, height = 1920): ProbeReport {
  const stream = {
    index: 0,
    codecType: "video",
    codecName: "h264",
    profile: "High",
    pixFmt: "yuv420p",
    bitsPerRawSample: 8,
    width,
    height,
    rotation: 0,
    displayWidth: width,
    displayHeight: height,
    sampleAspectRatio: "1:1",
    rFrameRate: "30/1",
    avgFrameRate: "30/1",
    nbFrames: 1800,
    startTimeMs: 0,
    durationMs: 60000,
    bitRate: 6000000,
    sampleRate: null,
    channels: null,
    attachedPic: false,
  };
  return {
    demuxer: "mov",
    format: {
      formatName: "mov,mp4,m4a",
      majorBrand: "isom",
      durationMs: 60000,
      sizeBytes: body.length,
      bitRate: 6000000,
      tags: { title: "private source comment must never persist" },
    },
    streams: [
      stream,
      {
        ...stream,
        index: 1,
        codecType: "audio",
        codecName: "aac",
        profile: null,
        pixFmt: null,
        width: null,
        height: null,
        displayWidth: null,
        displayHeight: null,
        sampleRate: 48000,
        channels: 2,
      },
    ],
    boxes: ["ftyp", "moov", "mdat"],
    moovBeforeMdat: true,
    aigc: label,
  };
}
async function fixture(
  input: { ai?: boolean; upstream?: boolean; missingContext?: boolean; sample?: boolean } = {},
) {
  const make = createFactories({ db, clock }),
    fake = createFakeProviders({ clock }),
    assembly = assembleForTest({ entry: "api" });
  const tx = createTxRunner({ prisma: db, appEnv: "test" }),
    events = createEvents({ tx, clock, assembly });
  const user = await make.merchantUser(),
    entity = await make.entity({ createdByUserId: user.id }),
    store = await make.store({ entityId: entity.id }),
    staff = await make.staff();
  const drama = await make.drama(),
    original = await make.fileObject({
      category: "drama_master",
      bucket: "media",
      ext: "mp4",
      declaredMime: "video/mp4",
      mime: "video/mp4",
    });
  const master = await db.dramaEpisodeMaster.create({
    data: {
      id: uuidv7(),
      dramaId: drama.id,
      episodeNo: 1,
      revNo: 1,
      fileId: original.id,
      state: "ready",
      isCurrent: true,
      durationMs: 60000,
      createdByStaffId: staff.id,
      activatedAt: clock.now(),
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
  });
  const file = await make.fileObject({
    category: input.sample ? "sample_video" : "final_episode",
    scopeType: "store",
    entityId: entity.id,
    storeId: store.id,
    bucket: "media",
    ext: "mp4",
    declaredMime: "video/mp4",
    mime: "video/mp4",
    declaredSize: body.length,
    sizeBytes: body.length,
    etag: '"source"',
  });
  await tx.run((t) =>
    declareManualProduction(t, clock, {
      fileId: file.id,
      kind: input.sample ? "sample" : "final",
      orderItemId: uuidv7(),
      episodeNo: 1,
      entityId: entity.id,
      storeId: store.id,
      productionTier: "standard",
      uploadedByStaffId: staff.id,
      forcedByDrama: false,
      dramaEpisodeMasterId: input.missingContext ? undefined : master.id,
      aiUsage: { used: !!input.ai, tools: [] },
    }),
  );
  let label = input.upstream ? JSON.stringify(upstream) : null;
  const probe = vi.fn(async (_request: Parameters<MediaToolClient["probe"]>[0]) => {
    assertNotInTransaction("production-probe");
    return ok(report(label));
  });
  const stamp = vi.fn(async (request: Parameters<MediaToolClient["stampAigc"]>[0]) => {
    assertNotInTransaction("production-stamp");
    label = request.aigcJson;
    return ok({ report: report(label), inputSizeBytes: body.length, outputSizeBytes: body.length });
  });
  const tool: MediaToolClient = {
    probe,
    stampAigc: stamp,
    poster: async () =>
      ok({ bytes: body, sizeBytes: body.length, width: 720, height: 1280, atMs: 1000 }),
    health: async () => ok({ ffmpeg: "fake", ffprobe: "fake" }),
  };
  const workspace: MediaWorkspace = {
    close: async () => {},
    run: async (job, signal, action) => {
      assertNotInTransaction("production-workspace");
      return action({
        path: (name) => `${job.id}/${name}`,
        download: async () =>
          signal.aborted
            ? failed("unavailable", "canceled")
            : ok({ size: body.length, sha256: digest }),
        publish: async (request) => {
          assertNotInTransaction("production-publish");
          const etag = fake.storage.put(
            request.dst,
            body,
            request.name === "poster.jpg" ? "image/jpeg" : "video/mp4",
          );
          return ok({ size: body.length, sha256: digest, etag });
        },
      });
    },
  };
  const production: MediaProductionDeps = {
    tool,
    workspace,
    cloud: fake.media,
    config: {
      aigc: {
        Label: "1",
        ContentProducer: "PUBLIC-SYSTEM",
        ReservedCode1: "",
        ContentPropagator: "",
        ReservedCode2: "",
      },
      templates: {
        normalize: "normalize",
        sample: "sample",
        sd: "sd",
        hd: "hd",
        brand: "brand",
        ai: "ai",
      },
    },
    parameters: async () => ({
      finalMaxMb: 200,
      softDurationMs: 180000,
      ruleVersion: 1,
      specVersion: 1,
    }),
    readStoreFacts: async () => ({ name: "十字商家名称完整店铺" }),
    readMasterFacts: async (t, id) => {
      const row = await t.dramaEpisodeMaster.findUnique({ where: { id } });
      return row
        ? {
            id: row.id,
            durationMs: 60000,
            displayWidth: 1080,
            displayHeight: 1920,
            isCurrent: row.isCurrent,
          }
        : null;
    },
  };
  const media = createMedia({ tx, clock, assembly, events, storage: fake.storage, production });
  owned.push(media);
  return {
    file,
    tx,
    media,
    production,
    probe,
    stamp,
    fake,
    make,
    staff,
    drama,
    setLabel: (next: string | null) => {
      label = next;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function remoteFixtures(h: Fixture) {
  const original = h.fake.media.transcode;
  h.fake.media.transcode = async (input) => {
    assertNotInTransaction("cloud-transcode");
    h.fake.storage.put(input.dst, body, "video/mp4");
    return original(input);
  };
  h.production.tool.watermarkPng = async () =>
    ok({ sizeBytes: body.length, width: 720, height: 96, sha256: digest });
  h.probe.mockImplementation(async (request: Parameters<MediaToolClient["probe"]>[0]) => {
    assertNotInTransaction("remote-readback");
    const job = await db.mediaJob.findUniqueOrThrow({ where: { id: request.path.split("/")[0]! } });
    const quality = (job.input as { quality?: string }).quality;
    return ok(
      report(
        null,
        job.kind === "normalize" ? 1080 : quality === "sd" ? 480 : 720,
        job.kind === "normalize" ? 1920 : quality === "sd" ? 854 : 1280,
      ),
    );
  });
}
async function trailerFixture(h: Fixture) {
  const source = await h.make.fileObject({
    category: "trailer_src",
    scopeType: "platform",
    bucket: "media",
    ext: "mp4",
    declaredMime: "video/mp4",
    mime: "video/mp4",
    declaredSize: body.length,
    sizeBytes: body.length,
    etag: '"source"',
  });
  // 与本文件的外部 probe 替身保持一致，补齐已通过源检查对应的技术前置。
  await db.mediaInfo.create({
    data: {
      fileId: source.id,
      kind: "video",
      container: "mp4",
      durationMs: report().format.durationMs,
      probeVersion: 1,
      raw: { fixture: "trailer codec source" },
      probedAt: clock.now(),
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
  });
  await db.mediaCheck.create({
    data: {
      fileId: source.id,
      profile: "trailer_src",
      ruleVersion: 1,
      gate: "pass",
      hard: [],
      soft: [],
      checkedAt: clock.now(),
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
  });
  const ports: Pick<
    MediaProductionDeps,
    "readTrailerFacts" | "setTrailerTarget" | "installTrailerCurrent"
  > = {
    readTrailerFacts: async (t, id) => {
      const drama = await t.drama.findUnique({ where: { id } }),
        pointer = await t.dramaTrailer.findUnique({ where: { dramaId: id } });
      return drama
        ? {
            dramaId: id,
            isAiGenerated: false,
            posterFileId: null,
            targetPlayableAssetId: pointer?.targetPlayableAssetId ?? null,
            currentPlayableAssetId: pointer?.currentPlayableAssetId ?? null,
          }
        : null;
    },
    setTrailerTarget: async (t, input) => {
      await t.dramaTrailer.upsert({
        where: { dramaId: input.dramaId },
        create: {
          dramaId: input.dramaId,
          targetPlayableAssetId: input.playableAssetId,
          setByStaffId: input.staffId,
          setAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
        update: {
          targetPlayableAssetId: input.playableAssetId,
          setByStaffId: input.staffId,
          setAt: input.now,
          updatedAt: input.now,
        },
      });
    },
    installTrailerCurrent: async (t, input) => {
      const pointer = await t.dramaTrailer.findUnique({ where: { dramaId: input.dramaId } });
      const changed = await t.dramaTrailer.updateMany({
        where: { dramaId: input.dramaId, targetPlayableAssetId: input.playableAssetId },
        data: { currentPlayableAssetId: input.playableAssetId, updatedAt: input.now },
      });
      return {
        changed: changed.count === 1,
        oldCurrentPlayableAssetId: pointer?.currentPlayableAssetId ?? null,
      };
    },
  };
  Object.assign(h.production, ports);
  remoteFixtures(h);
  return {
    source,
    ids: await h.tx.run((t) =>
      h.media.enqueueTrailer(t, { dramaId: h.drama.id, fileId: source.id, staffId: h.staff.id }),
    ),
  };
}
describe("真实制作事实与派生", { timeout: 30000 }, () => {
  it("递增业务clock的真实runner收尾共用已写完成时间，严格制作事实仍可ready", async () => {
    const h = await fixture();
    await db.fileObject.update({ where: { id: h.file.id }, data: { sha256: null } });
    const id = await h.tx.run((t) => h.media.enqueueProbe(t, h.file.id));
    let tick = clock.now().getTime();
    vi.spyOn(clock, "now").mockImplementation(() => new Date(++tick));
    await h.media.jobs.run({ jobId: id });
    const job = await db.mediaJob.findUniqueOrThrow({ where: { id } });
    const check = await db.mediaCheck.findUniqueOrThrow({ where: { fileId: h.file.id } });
    const info = await db.mediaInfo.findUniqueOrThrow({ where: { fileId: h.file.id } });
    expect(job.state).toBe("succeeded");
    expect(job.finishedAt).not.toBeNull();
    const times = {
      jobCheckSame: job.finishedAt!.getTime() === check.checkedAt.getTime(),
      infoCheckSame: info.probedAt.getTime() === check.checkedAt.getTime(),
      jobInfoSame: job.finishedAt!.getTime() === info.probedAt.getTime(),
    };
    const facts = await h.tx.run((tx) => h.media.deliveryProductionFacts(tx, h.file.id));
    process.stdout.write(
      `${JSON.stringify({
        evt: "probe.canonical_time",
        ...times,
        valid: facts.valid,
        ready: facts.ready,
      })}\n`,
    );
    expect({ ...times, valid: facts.valid, ready: facts.ready }).toEqual({
      jobCheckSame: true,
      infoCheckSame: true,
      jobInfoSame: true,
      valid: true,
      ready: true,
    });
  });
  it("actual probe写技术/七字段上下文，封面有live引用且raw没有用户标签", async () => {
    const h = await fixture(),
      id = await h.tx.run((t) => h.media.enqueueProbe(t, h.file.id));
    await h.media.jobs.run({ jobId: id });
    const check = await db.mediaCheck.findUniqueOrThrow({ where: { fileId: h.file.id } });
    expect(check.gate).toBe("pass");
    expect(Object.keys(check.contextSnapshot as object).sort()).toEqual(
      [
        "masterId",
        "masterDurationMs",
        "masterDisplayWidth",
        "masterDisplayHeight",
        "headAdMs",
        "tailAdMs",
        "aiUsed",
      ].sort(),
    );
    const info = await db.mediaInfo.findUniqueOrThrow({ where: { fileId: h.file.id } });
    expect(info).toMatchObject({
      displayWidth: 1080,
      displayHeight: 1920,
      durationMs: 60000,
      vcodec: "h264",
      acodec: "aac",
      isFaststart: true,
    });
    expect(JSON.stringify(info.raw)).not.toContain("private source");
    expect(
      await db.fileRef.findMany({
        where: { refId: h.file.id, refType: "media_info", state: "live" },
      }),
    ).toHaveLength(1);
    expect(
      (await db.productionRecord.findUniqueOrThrow({ where: { fileId: h.file.id } })).pipelineState,
    ).toBe("ready");
    expect(
      await db.outboxEvent.count({
        where: { eventType: "media.production.checked", aggregateId: h.file.id },
      }),
    ).toBe(1);
  });
  it("probe摘要只取真实download结果，空SHA在收尾写入且和job输出一致", async () => {
    const h = await fixture();
    await db.fileObject.update({ where: { id: h.file.id }, data: { sha256: null } });
    const id = await h.tx.run((t) => h.media.enqueueProbe(t, h.file.id));
    await h.media.jobs.run({ jobId: id });
    expect((await db.fileObject.findUniqueOrThrow({ where: { id: h.file.id } })).sha256).toBe(
      digest,
    );
    expect((await db.mediaJob.findUniqueOrThrow({ where: { id } })).output).toMatchObject({
      sourceSha256: digest,
    });
    expect((await h.tx.run((t) => h.media.deliveryProductionFacts(t, h.file.id))).ready).toBe(true);
  });
  it("已存SHA和download真实字节摘要不同则零体检写入且保留原摘要", async () => {
    const h = await fixture(),
      original = "a".repeat(64);
    await db.fileObject.update({ where: { id: h.file.id }, data: { sha256: original } });
    const id = await h.tx.run((t) => h.media.enqueueProbe(t, h.file.id));
    await h.media.jobs.run({ jobId: id });
    expect(await db.mediaInfo.findUnique({ where: { fileId: h.file.id } })).toBeNull();
    expect(await db.mediaCheck.findUnique({ where: { fileId: h.file.id } })).toBeNull();
    expect((await db.fileObject.findUniqueOrThrow({ where: { id: h.file.id } })).sha256).toBe(
      original,
    );
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id } })).toMatchObject({
      state: "failed",
      errorCode: "MEDIA_SOURCE_CHANGED",
    });
  });
  it("缺真实原片上下文只能reject，不伪尺寸/AI已通过", async () => {
    const h = await fixture({ missingContext: true }),
      id = await h.tx.run((t) => h.media.enqueueProbe(t, h.file.id));
    await h.media.jobs.run({ jobId: id });
    expect(await db.mediaCheck.findUniqueOrThrow({ where: { fileId: h.file.id } })).toMatchObject({
      gate: "reject",
      contextSnapshot: null,
    });
    expect(
      (await db.productionRecord.findUniqueOrThrow({ where: { fileId: h.file.id } })).pipelineState,
    ).toBe("rejected");
  });
  it("原片batch没有productionRecord仍在实际probe收尾同TX回调，不伪造制作记录", async () => {
    const h = await fixture(),
      now = clock.now(),
      batchId = uuidv7();
    await db.uploadBatch.create({
      data: {
        id: batchId,
        purpose: "drama_master",
        targetId: h.drama.id,
        variant: "common",
        createdByStaffId: h.staff.id,
        state: "verifying",
        expectedCount: 1,
        scope: "full",
        replaceReason: "other",
        note: "测试原片回调",
        idempotencyKey: uuidv7(),
        expiresAt: new Date(now.getTime() + 72 * 3600000),
        createdAt: now,
        updatedAt: now,
      },
    });
    const file = await h.make.fileObject({
      category: "drama_master",
      scopeType: "platform",
      bucket: "media",
      ext: "mp4",
      declaredMime: "video/mp4",
      mime: "video/mp4",
      uploadBatchId: batchId,
      declaredSize: body.length,
      sizeBytes: body.length,
      etag: '"source"',
    });
    const itemId = uuidv7();
    await db.uploadBatchItem.create({
      data: {
        id: itemId,
        uploadBatchId: batchId,
        fileId: file.id,
        originalName: "01.mp4",
        episodeNo: 1,
        matchMethod: "manual",
        state: "uploaded",
        createdAt: now,
        updatedAt: now,
      },
    });
    const checked = vi.fn(
      async (
        t: Parameters<NonNullable<MediaProductionDeps["productionChecked"]>>[0],
        input: Parameters<NonNullable<MediaProductionDeps["productionChecked"]>>[1],
      ) => {
        expect(await t.mediaCheck.findUnique({ where: { fileId: file.id } })).toMatchObject({
          gate: "pass",
        });
        expect(input).toEqual({ fileId: file.id, gate: "pass", derivedFromFileId: null });
        await t.uploadBatchItem.update({
          where: { id: itemId },
          data: { state: "checked", updatedAt: now },
        });
      },
    );
    Object.assign(h.production, {
      productionChecked: checked,
      batchLockSiblings: async (t: Parameters<MediaProductionDeps["parameters"]>[0], id: string) =>
        lockRows(t, "upload_batch", [id]),
      batchNeedsJob: async () => true,
      batchConverge: async () => {},
    });
    const id = await h.tx.run((t) => h.media.enqueueProbe(t, file.id, { parentBatchId: batchId }));
    await h.media.jobs.run({ jobId: id });
    expect((await db.mediaJob.findUniqueOrThrow({ where: { id } })).state).toBe("succeeded");
    expect(checked).toHaveBeenCalledOnce();
    expect((await db.uploadBatchItem.findUniqueOrThrow({ where: { id: itemId } })).state).toBe(
      "checked",
    );
    expect(await db.productionRecord.findUnique({ where: { fileId: file.id } })).toBeNull();
  });
  it("同一file/context/version并发入队同ID，重复执行只写一次技术收尾", async () => {
    const h = await fixture(),
      ids = await Promise.all([
        h.tx.run((t) => h.media.enqueueProbe(t, h.file.id)),
        h.tx.run((t) => h.media.enqueueProbe(t, h.file.id)),
      ]);
    expect(ids[0]).toBe(ids[1]);
    await Promise.all(ids.map((jobId) => h.media.jobs.run({ jobId })));
    expect(h.probe).toHaveBeenCalledOnce();
    expect(
      await db.outboxEvent.count({
        where: { eventType: "media.production.checked", aggregateId: h.file.id },
      }),
    ).toBe(1);
  });
  it("AI缺标在实际probe reject后生成restamp事实，不改used=false", async () => {
    const h = await fixture({ ai: true }),
      id = await h.tx.run((t) => h.media.enqueueProbe(t, h.file.id));
    await h.media.jobs.run({ jobId: id });
    expect(
      (await db.productionRecord.findUniqueOrThrow({ where: { fileId: h.file.id } })).aiUsage,
    ).toMatchObject({ used: true });
    expect(
      await db.mediaJob.findMany({ where: { subjectId: h.file.id, kind: "restamp" } }),
    ).toHaveLength(1);
    expect(
      await db.playableAsset.count({ where: { sourceFileId: h.file.id, state: "ready" } }),
    ).toBe(0);
  });
  it("补标写新UUID/固定key，独立probe回读，保留完整上下文与source30d引用", async () => {
    const h = await fixture({ ai: true }),
      before = await db.productionRecord.findUniqueOrThrow({ where: { fileId: h.file.id } });
    const id = await h.tx.run((t) => h.media.restamp(t, h.file.id));
    await h.media.jobs.run({ jobId: id });
    const result = await db.mediaJob.findUniqueOrThrow({ where: { id } });
    expect(result.state).toBe("succeeded");
    expect(h.stamp).toHaveBeenCalledOnce();
    expect(h.probe).toHaveBeenCalledTimes(2);
    const derived = await db.productionRecord.findUniqueOrThrow({
      where: { fileId: (result.output as { fileId: string }).fileId },
    });
    expect(derived).toMatchObject({
      kind: before.kind,
      orderItemId: before.orderItemId,
      episodeNo: before.episodeNo,
      variant: before.variant,
      productionTier: before.productionTier,
      dramaEpisodeMasterId: before.dramaEpisodeMasterId,
      masterSource: before.masterSource,
      aiUsage: before.aiUsage,
      headAdVersionId: before.headAdVersionId,
      tailAdVersionId: before.tailAdVersionId,
      source: "restamped",
      derivedFromFileId: h.file.id,
      pipelineState: "checking",
    });
    expect(await db.productionRecord.findUniqueOrThrow({ where: { fileId: h.file.id } })).toEqual(
      before,
    );
    expect(
      await db.fileRef.findMany({
        where: {
          refType: "production_record",
          refId: derived.fileId,
          fileId: h.file.id,
          state: "live",
        },
      }),
    ).toHaveLength(1);
    expect(await db.mediaJob.count({ where: { kind: "probe", subjectId: derived.fileId } })).toBe(
      1,
    );
  });
  it("上游有效七字段逐字保留，绝不调用覆盖式stamp", async () => {
    const h = await fixture({ ai: true, upstream: true }),
      id = await h.tx.run((t) => h.media.restamp(t, h.file.id));
    await h.media.jobs.run({ jobId: id });
    expect(h.stamp).not.toHaveBeenCalled();
    const one = await db.mediaJob.findUniqueOrThrow({ where: { id } });
    expect(one.state).toBe("succeeded");
    expect(
      (
        await db.mediaInfo.findUniqueOrThrow({
          where: { fileId: (one.output as { fileId: string }).fileId },
        })
      ).aigcMeta,
    ).toEqual(upstream);
  });
  it("规范化尚无mediaInfo时先读真实源七字段，云丢标后补回原值而非系统新值", async () => {
    const h = await fixture({ ai: true, upstream: true });
    remoteFixtures(h);
    let probes = 0;
    h.probe.mockImplementation(async () => {
      assertNotInTransaction("normalize-actual-readback");
      probes++;
      return ok(report(probes === 2 ? null : JSON.stringify(upstream)));
    });
    const id = await h.tx.run((t) => h.media.normalize(t, h.file.id));
    await h.media.jobs.run({ jobId: id });
    clock.advance(5000);
    await h.media.jobs.run({ jobId: id });
    const job = await db.mediaJob.findUniqueOrThrow({ where: { id } });
    expect(job.state).toBe("succeeded");
    expect(h.probe).toHaveBeenCalledTimes(3);
    expect(h.stamp).toHaveBeenCalledOnce();
    expect(JSON.parse(h.stamp.mock.calls[0]![0].aigcJson)).toEqual(upstream);
    const fileId = (job.output as { fileId: string }).fileId;
    expect((await db.mediaInfo.findUniqueOrThrow({ where: { fileId } })).aigcMeta).toEqual(
      upstream,
    );
    expect((await db.productionRecord.findUniqueOrThrow({ where: { fileId } })).aigcOrigin).toBe(
      "upstream",
    );
  });
  it("补标独立回读不一致为failed，零派生context/零ready事件", async () => {
    const h = await fixture({ ai: true });
    h.stamp.mockImplementation(async () => {
      h.setLabel(JSON.stringify(upstream));
      return ok({
        report: report(JSON.stringify(upstream)),
        inputSizeBytes: 3,
        outputSizeBytes: 3,
      });
    });
    const id = await h.tx.run((t) => h.media.restamp(t, h.file.id));
    await h.media.jobs.run({ jobId: id });
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id } })).toMatchObject({
      state: "failed",
      errorCode: "MEDIA_AIGC_READBACK_MISMATCH",
    });
    expect(await db.productionRecord.count({ where: { derivedFromFileId: h.file.id } })).toBe(0);
    expect(
      await db.outboxEvent.count({
        where: { eventType: "media.production.derived", aggregateId: h.file.id },
      }),
    ).toBe(0);
  });
  it("真实在途父context变更后旧结果取消，技术副作用零且artifact无live引用", async () => {
    const h = await fixture(),
      id = await h.tx.run((t) => h.media.enqueueProbe(t, h.file.id));
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => {
        entered = r;
      }),
      held = new Promise<void>((r) => {
        release = r;
      });
    h.probe.mockImplementation(async () => {
      entered();
      await held;
      return ok(report());
    });
    const running = h.media.jobs.run({ jobId: id });
    try {
      await Promise.race([
        ready,
        running.then(() => {
          throw new Error("真实probe尚未进入");
        }),
      ]);
      await db.productionRecord.update({
        where: { fileId: h.file.id },
        data: {
          aiUsage: {
            used: true,
            tools: [],
            declaredBy: uuidv7(),
            declaredAt: clock.now().toISOString(),
            forcedByDrama: false,
          },
        },
      });
      const winner = await db.productionRecord.findUniqueOrThrow({ where: { fileId: h.file.id } });
      release();
      await running;
      expect((await db.mediaJob.findUniqueOrThrow({ where: { id } })).state).toBe("canceled");
      expect(await db.mediaInfo.count({ where: { fileId: h.file.id } })).toBe(0);
      expect(await db.productionRecord.findUniqueOrThrow({ where: { fileId: h.file.id } })).toEqual(
        winner,
      );
      const job = await db.mediaJob.findUniqueOrThrow({ where: { id } }),
        coverId = (job.input as { coverFileId: string }).coverFileId;
      expect((await db.fileObject.findUniqueOrThrow({ where: { id: coverId } })).status).toBe(
        "stored",
      );
      expect(await db.fileRef.count({ where: { fileId: coverId, state: "live" } })).toBe(0);
    } finally {
      release();
      await running.catch(() => {});
    }
  });
  it("事实端口只投影有界技术结果，不泄漏filename/token/AI工具声明", async () => {
    const h = await fixture(),
      facts = await h.tx.run((t) => h.media.productionFacts(t, [h.file.id]));
    expect(facts).toHaveLength(1);
    expect(Object.keys(facts[0]!.file!).sort()).toEqual(
      ["id", "status", "moderationState", "category", "uploadBatchId"].sort(),
    );
    expect(JSON.stringify(facts)).not.toContain("declaredBy");
    await expect(
      h.tx.run((t) =>
        h.media.productionFacts(
          t,
          Array.from({ length: 101 }, () => h.file.id),
        ),
      ),
    ).rejects.toMatchObject({ error: "VALIDATION_FAILED" });
  });
  it("旧M1 raw playable先预锁350，两probe并发只生成一个水印任务，实际新档替换空尺寸", async () => {
    const h = await fixture({ sample: true }),
      record = await db.productionRecord.findUniqueOrThrow({ where: { fileId: h.file.id } });
    const old = await db.playableAsset.create({
      data: {
        id: uuidv7(),
        kind: "sample",
        sourceFileId: h.file.id,
        entityId: h.file.entityId,
        storeId: h.file.storeId,
        ownerType: "order_item",
        ownerId: record.orderItemId!,
        state: "ready",
        specVersion: 1,
        renditions: [
          { quality: "source", fileId: h.file.id, width: null, height: null, bitrateKbps: null },
        ],
        readyAt: clock.now(),
        createdAt: clock.now(),
        updatedAt: clock.now(),
      },
    });
    await h.tx.run(async (t) => {
      await lockRows(t, "playable_asset", [old.id]);
      await lockRows(t, "file_object", [h.file.id]);
      for (const role of ["source", "rendition"])
        await h.media.link(t, {
          fileId: h.file.id,
          entityId: h.file.entityId,
          storeId: h.file.storeId,
          refType: "playable_asset",
          refId: old.id,
          role,
        });
    });
    const ids = await Promise.all([
      h.tx.run((t) => h.media.enqueueProbe(t, h.file.id)),
      h.tx.run((t) => h.media.enqueueProbe(t, h.file.id)),
    ]);
    await Promise.all(ids.map((jobId) => h.media.jobs.run({ jobId })));
    expect(h.probe).toHaveBeenCalledOnce();
    const jobs = await db.mediaJob.findMany({
      where: { kind: "watermark_sample", parentId: old.id },
    });
    expect(jobs).toHaveLength(1);
    expect(
      (await h.tx.run((t) => h.media.productionFacts(t, [h.file.id])))[0]!.watermarkReady,
    ).toBe(false);
    remoteFixtures(h);
    await h.media.jobs.run({ jobId: jobs[0]!.id });
    clock.advance(5000);
    await h.media.jobs.run({ jobId: jobs[0]!.id });
    const asset = await db.playableAsset.findUniqueOrThrow({ where: { id: old.id } });
    expect(asset).toMatchObject({ state: "ready", width: 720, height: 1280 });
    expect(asset.watermark).toMatchObject({
      text: expect.stringMatching(/^样片 · 仅供「十字商家名称完整店铺」确认 · \d{2}-\d{2}$/),
    });
    expect((asset.renditions as Array<{ fileId: string }>)[0]!.fileId).not.toBe(h.file.id);
    const oldRef = await db.fileRef.findUniqueOrThrow({
      where: {
        fileId_refType_refId_role: {
          fileId: h.file.id,
          refType: "playable_asset",
          refId: old.id,
          role: "rendition",
        },
      },
    });
    expect(oldRef.state).toBe("released");
    expect(oldRef.keepUntil!.getTime()).toBeGreaterThanOrEqual(
      clock.now().getTime() + 30 * 86_400_000,
    );
    expect(
      await db.outboxEvent.count({
        where: { eventType: "media.playable.ready", aggregateId: old.id },
      }),
    ).toBe(1);
  });
  it("真实双档独立提交，只有两档齐才能安装current，重复执行事件不重发", async () => {
    const h = await fixture(),
      trailer = await trailerFixture(h);
    const parent = (await db.mediaJob.findUniqueOrThrow({ where: { id: trailer.ids[0]! } }))
      .parentId!;
    await Promise.all(trailer.ids.map((jobId) => h.media.jobs.run({ jobId })));
    clock.advance(5000);
    await h.media.jobs.run({ jobId: trailer.ids[0]! });
    expect((await db.playableAsset.findUniqueOrThrow({ where: { id: parent } })).state).toBe(
      "processing",
    );
    expect(
      (await db.dramaTrailer.findUniqueOrThrow({ where: { dramaId: h.drama.id } }))
        .currentPlayableAssetId,
    ).toBeNull();
    await h.media.jobs.run({ jobId: trailer.ids[1]! });
    await h.media.jobs.run({ jobId: trailer.ids[1]! });
    const asset = await db.playableAsset.findUniqueOrThrow({ where: { id: parent } });
    expect(asset.state).toBe("ready");
    expect(asset.renditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ quality: "sd", width: 480, height: 854 }),
        expect.objectContaining({ quality: "hd", width: 720, height: 1280 }),
      ]),
    );
    expect(
      (await db.dramaTrailer.findUniqueOrThrow({ where: { dramaId: h.drama.id } }))
        .currentPlayableAssetId,
    ).toBe(parent);
    expect(
      await db.outboxEvent.count({
        where: { eventType: "drama.trailer_ready", aggregateId: h.drama.id },
      }),
    ).toBe(1);
  });
  it("在途预告片target切换后晚产物retired，无ready/live引用，不覆盖赢家指针", async () => {
    const h = await fixture(),
      trailer = await trailerFixture(h),
      first = trailer.ids[0]!;
    await h.media.jobs.run({ jobId: first });
    clock.advance(5000);
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => {
        entered = r;
      }),
      held = new Promise<void>((r) => {
        release = r;
      });
    h.probe.mockImplementation(async () => {
      entered();
      await held;
      return ok(report(null, 480, 854));
    });
    const running = h.media.jobs.run({ jobId: first });
    try {
      await Promise.race([
        ready,
        running.then(() => {
          throw new Error("真实预告片回读尚未进入");
        }),
      ]);
      const oldId = (await db.mediaJob.findUniqueOrThrow({ where: { id: first } })).parentId!;
      const winner = await db.playableAsset.create({
        data: {
          id: uuidv7(),
          kind: "trailer",
          sourceFileId: trailer.source.id,
          ownerType: "drama",
          ownerId: h.drama.id,
          state: "processing",
          specVersion: 2,
          createdAt: clock.now(),
          updatedAt: clock.now(),
        },
      });
      await h.tx.run(async (t) => {
        await lockRows(t, "playable_asset", [oldId, winner.id]);
        await t.dramaTrailer.update({
          where: { dramaId: h.drama.id },
          data: { targetPlayableAssetId: winner.id, updatedAt: clock.now() },
        });
      });
      const pointer = await db.dramaTrailer.findUniqueOrThrow({ where: { dramaId: h.drama.id } });
      release();
      await running;
      expect((await db.playableAsset.findUniqueOrThrow({ where: { id: oldId } })).state).toBe(
        "retired",
      );
      expect(await db.dramaTrailer.findUniqueOrThrow({ where: { dramaId: h.drama.id } })).toEqual(
        pointer,
      );
      expect(
        await db.fileRef.count({
          where: { refType: "playable_asset", refId: oldId, state: "live" },
        }),
      ).toBe(0);
      expect(
        await db.outboxEvent.count({
          where: { eventType: "media.playable.ready", aggregateId: oldId },
        }),
      ).toBe(0);
      expect((await db.mediaJob.findUniqueOrThrow({ where: { id: first } })).state).toBe(
        "canceled",
      );
    } finally {
      release();
      await running.catch(() => {});
    }
  });
  it("版权即时释放专属引用并取消在途，返回CDN pending而非宣称旧URL停止播放", async () => {
    const h = await fixture(),
      trailer = await trailerFixture(h),
      first = trailer.ids[0]!;
    await h.media.jobs.run({ jobId: first });
    clock.advance(5000);
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => {
        entered = r;
      }),
      held = new Promise<void>((r) => {
        release = r;
      });
    h.probe.mockImplementation(async () => {
      entered();
      await held;
      return ok(report(null, 480, 854));
    });
    const running = h.media.jobs.run({ jobId: first });
    try {
      await Promise.race([
        ready,
        running.then(() => {
          throw new Error("真实版权回收在途回读尚未进入");
        }),
      ]);
      const result = await h.tx.run((t) =>
        h.media.retireDramaMedia(t, h.drama.id, { scope: "trailer", immediate: true }),
      );
      expect(result).toEqual({
        objectRefs: [{ bucket: trailer.source.bucket, key: trailer.source.objectKey }],
        cdnPending: true,
      });
      const parent = (await db.mediaJob.findUniqueOrThrow({ where: { id: first } })).parentId!;
      expect(await db.fileRef.findMany({ where: { refId: parent } })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ state: "released", keepUntil: clock.now() }),
        ]),
      );
      release();
      await running;
      expect((await db.playableAsset.findUniqueOrThrow({ where: { id: parent } })).state).toBe(
        "retired",
      );
      expect(
        await db.outboxEvent.count({
          where: { eventType: "media.playable.ready", aggregateId: parent },
        }),
      ).toBe(0);
    } finally {
      release();
      await running.catch(() => {});
    }
  });
});
