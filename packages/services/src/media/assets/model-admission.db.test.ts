import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSeededDatabase, useTestRedis } from "../../testing/index.js";
import { lockRows } from "../../kernel/index.js";
import { AssetJobOutputSchema } from "./pipeline.js";
import {
  modelWorld,
  png,
  signal,
  structuredOutput,
  json,
  SLOW,
} from "./__fixtures__/model-admission.js";
import type { ModelWorld } from "./__fixtures__/model-admission.js";

const db = useSeededDatabase("services"),
  redis = useTestRedis();
let client: Awaited<ReturnType<typeof redis.raw>>, h: ModelWorld;
beforeAll(async () => {
  client = await redis.raw();
}, SLOW);
beforeEach(async () => {
  h = await modelWorld(await db.prisma(), client, redis.prefix);
}, SLOW);
afterEach(async () => {
  try {
    await h?.close();
  } finally {
    vi.restoreAllMocks();
  }
}, SLOW);
const spent = async () => {
  const all = await h.snapshot();
  return Object.entries(all)
    .filter(([key]) => key.startsWith("g:"))
    .reduce((n, [, value]) => n + Number(value), 0);
};

describe("三owner真实PG与Redis预算", () => {
  it.each(["asr", "vision", "digest"] as const)(
    "%s真实许可读两次、预留一次且计原文件/槽",
    async (kind) => {
      const facts =
        kind === "asr"
          ? await h.readyAudio()
          : kind === "vision"
            ? await h.readyImage()
            : await h.readyText();
      const execute =
        kind === "asr"
          ? h.asrStrategy().execute
          : kind === "vision"
            ? h.visionStrategy().execute
            : h.digestStrategy().execute;
      const result = await execute(facts.job, signal());
      expect(result.state).toBe(kind === "asr" ? "submitted" : "succeeded");
      if (kind !== "asr") expect(structuredOutput(result).status).toBe("ok");
      expect(h.budget.readPermit).toHaveBeenCalledTimes(2);
      expect(h.budget.reserve).toHaveBeenCalledTimes(1);
      expect(h.evalCall).toHaveBeenCalledTimes(1);
      const permit = h.budget.reserve.mock.calls[0]![0];
      expect(permit).toMatchObject({
        entityId: h.merchant.entity.id,
        storeId: h.merchant.store.id,
        jobId: facts.job.id,
        kind,
        attemptNo: 1,
        fileIds: facts.files.map((file) => file.id).sort(),
        dailyFileCap: 200,
        dailyCallCap: 10000,
        originalDeadlineMs: facts.job.deadlineAt.getTime(),
      });
      expect(permit.admitUntilMs).toBe(permit.readAtMs + 250);
      expect(await spent()).toBe(kind === "asr" ? 1 : 3);
      const all = await h.snapshot();
      expect(all[`t:${facts.job.id}:1:${kind}`]).toBe(String(facts.job.deadlineAt.getTime()));
      expect(Object.keys(all).filter((key) => key.startsWith("f:"))).toHaveLength(
        facts.files.length,
      );
      expect(h.fake.asr.callsOf("submit")).toHaveLength(kind === "asr" ? 1 : 0);
      expect(h.vision).toHaveBeenCalledTimes(kind === "vision" ? 1 : 0);
      expect(h.digest).toHaveBeenCalledTimes(kind === "digest" ? 1 : 0);
    },
  );

  it("视频六帧只占一个原文件与三槽", async () => {
    const facts = await h.readyVideo();
    expect(structuredOutput(await h.visionStrategy().execute(facts.job, signal())).status).toBe(
      "ok",
    );
    expect(h.signing).toHaveBeenCalledTimes(6);
    expect(h.vision.mock.calls[0]![0].imageUrls).toHaveLength(6);
    expect(h.budget.reserve.mock.calls[0]![0].fileIds).toEqual([facts.files[0]!.id]);
    expect(await spent()).toBe(3);
    expect(Object.keys(await h.snapshot()).filter((key) => key.startsWith("f:"))).toHaveLength(1);
  });

  it.each(["missing", "disabled", "throws", "unknown"])(
    "成对端口%s关闭且不借legacy真值",
    async (mode) => {
      const facts = await h.readyText(),
        d = h.deps();
      const legacy = vi.fn(async () => true);
      const assets = { ...d.assets, allowModelCall: legacy };
      if (mode === "missing")
        assets.modelBudget = { readPermit: h.budget.readPermit } as typeof h.budget;
      if (mode === "disabled") h.budget.readPermit.mockResolvedValue(null);
      if (mode === "throws") h.budget.readPermit.mockRejectedValue(new Error("配置读取失败"));
      if (mode === "unknown") h.budget.readPermit.mockResolvedValue(undefined as never);
      const result = structuredOutput(
        await h.digestStrategy({ ...d, assets }).execute(facts.job, signal()),
      );
      expect(result).toMatchObject({
        status: "skipped",
        reason: mode === "disabled" ? "budget_unconfigured" : "budget_unavailable",
      });
      expect(legacy).not.toHaveBeenCalled();
      expect(h.budget.reserve).not.toHaveBeenCalled();
      expect(h.digest).not.toHaveBeenCalled();
      expect(await spent()).toBe(0);
    },
  );

  it("签发不合法纯输入在Redis之前拒绝", async () => {
    const facts = await h.readyImage();
    h.signing.mockResolvedValue({
      ok: true,
      value: {
        url: "http://localhost/private",
        expiresAt: new Date(h.clock.now().getTime() + 900000),
      },
    });
    expect(structuredOutput(await h.visionStrategy().execute(facts.job, signal()))).toMatchObject({
      status: "skipped",
      reason: "vision_signing_unavailable",
    });
    expect(h.budget.readPermit).not.toHaveBeenCalled();
    expect(h.budget.reserve).not.toHaveBeenCalled();
    expect(h.vision).not.toHaveBeenCalled();
    expect(await spent()).toBe(0);
  });

  it.each(["asr", "vision", "digest"] as const)(
    "%s成对属性存在但缺装配时权威关闭",
    async (kind) => {
      const facts =
        kind === "asr"
          ? await h.readyAudio()
          : kind === "vision"
            ? await h.readyImage()
            : await h.readyText();
      const d = h.deps(),
        legacy = vi.fn(async () => true);
      const readsBefore = h.fake.storage.callsOf("presignGet").length;
      const assets = { ...d.assets, modelBudget: undefined, allowModelCall: legacy };
      const strategy =
        kind === "asr"
          ? h.asrStrategy({ ...d, assets })
          : kind === "vision"
            ? h.visionStrategy({ ...d, assets })
            : h.digestStrategy({ ...d, assets });
      expect(structuredOutput(await strategy.execute(facts.job, signal())).reason).toBe(
        "budget_unavailable",
      );
      expect(legacy).not.toHaveBeenCalled();
      expect(h.budget.readPermit).not.toHaveBeenCalled();
      expect(h.budget.reserve).not.toHaveBeenCalled();
      expect(h.signing).not.toHaveBeenCalled();
      expect(h.fake.storage.callsOf("presignGet")).toHaveLength(readsBefore);
      expect(h.fake.asr.callsOf("submit")).toHaveLength(0);
      expect(h.vision).not.toHaveBeenCalled();
      expect(h.digest).not.toHaveBeenCalled();
    },
  );

  it("ASR无效签名输入不花预算，不调用新许可/提交", async () => {
    const facts = await h.readyAudio();
    vi.spyOn(h.fake.storage, "presignGet").mockResolvedValue({
      ok: true,
      value: {
        url: "https://user:private@public.invalid/a.wav",
        expiresAt: new Date(h.clock.now().getTime() + 7200000),
      },
    });
    expect(structuredOutput(await h.asrStrategy().execute(facts.job, signal())).reason).toBe(
      "asr_source_unavailable",
    );
    expect(h.budget.readPermit).not.toHaveBeenCalled();
    expect(h.budget.reserve).not.toHaveBeenCalled();
    expect(h.fake.asr.callsOf("submit")).toHaveLength(0);
    expect(await spent()).toBe(0);
  });

  it("真实视觉缓存命中零旧新授权、签发、预算和模型", async () => {
    const body = png(),
      first = await h.readyImage(body, false);
    await h.refresh();
    await h.media.jobs.run({ jobId: first.job.id });
    const result = await h.prisma.mediaJob.findUniqueOrThrow({ where: { id: first.job.id } });
    expect(AssetJobOutputSchema.parse(result.output).status).toBe("ok");
    const next = await h.readyImage(body),
      before = await h.snapshot();
    h.budget.readPermit.mockClear();
    h.budget.reserve.mockClear();
    h.evalCall.mockClear();
    h.signing.mockClear();
    h.vision.mockClear();
    const legacy = vi.fn(async () => {
        throw new Error("缓存不可授权");
      }),
      d = h.deps();
    const output = structuredOutput(
      await h
        .visionStrategy({ ...d, assets: { ...d.assets, allowModelCall: legacy } })
        .execute(next.job, signal()),
    );
    expect(output).toMatchObject({ status: "ok", reusedFromId: expect.any(String) });
    expect(h.budget.readPermit).not.toHaveBeenCalled();
    expect(h.budget.reserve).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
    expect(h.signing).not.toHaveBeenCalled();
    expect(h.vision).not.toHaveBeenCalled();
    expect(h.evalCall).not.toHaveBeenCalled();
    expect(await h.snapshot()).toEqual(before);
  });

  it.each(["zero", "lost", "exhausted"])(
    "原TaskId的ASR查询在%s预算下零新授权/签发/提交",
    async (mode) => {
      const facts = await h.readyAudio(),
        submitted = await h.asrStrategy().execute(facts.job, signal());
      if (submitted.state !== "submitted") throw new Error("ASR未提交");
      const job = await h.prisma.mediaJob.update({
        where: { id: facts.job.id },
        data: { externalJobId: submitted.externalJobId },
      });
      if (mode === "zero") h.caps.dailyCallCap = 0;
      if (mode === "lost") await client.unlink(h.key);
      if (mode === "exhausted") h.caps.dailyCallCap = 1;
      h.budget.readPermit.mockClear();
      h.budget.reserve.mockClear();
      h.evalCall.mockClear();
      h.fake.storage.resetCalls();
      h.fake.asr.resetCalls();
      const before = await h.snapshot();
      expect(await h.asrStrategy().poll(job, signal())).toEqual({ state: "pending" });
      expect(await h.asrStrategy().recover(job, signal())).toEqual({ state: "pending" });
      expect(h.fake.asr.callsOf("query").map((call) => call.input)).toEqual([
        { taskId: submitted.externalJobId, signal: expect.any(AbortSignal) },
        { taskId: submitted.externalJobId, signal: expect.any(AbortSignal) },
      ]);
      expect(h.budget.readPermit).not.toHaveBeenCalled();
      expect(h.budget.reserve).not.toHaveBeenCalled();
      expect(h.evalCall).not.toHaveBeenCalled();
      expect(h.fake.storage.callsOf("presignGet")).toHaveLength(0);
      expect(h.fake.asr.callsOf("submit")).toHaveLength(0);
      expect(await h.snapshot()).toEqual(before);
    },
  );

  it("ASR缓存真实完成历史命中，默认legacy false仍零授权/签发/预算/模型", async () => {
    const first = await h.readyAudio(false);
    h.permitControlledModel(true);
    await h.refresh();
    await h.media.jobs.run({ jobId: first.job.id });
    const submitted = await h.prisma.mediaJob.findUniqueOrThrow({ where: { id: first.job.id } });
    expect(submitted.state).toBe("submitted");
    expect(submitted.externalJobId).toEqual(expect.stringMatching(/^(?:0|[1-9][0-9]{0,19})$/));
    if (!submitted.externalJobId) throw new Error("没有原TaskId");
    h.fake.asr.tasks.set(submitted.externalJobId, {
      taskId: submitted.externalJobId,
      requestId: "fake-asr",
      state: "succeeded",
      text: "公开虚构语音",
      durationSec: 1,
      segments: [{ text: "公开虚构语音", startMs: 0, endMs: 1000 }],
    });
    h.clock.set(submitted.nextRunAt);
    await h.media.jobs.run({ jobId: first.job.id });
    expect(
      AssetJobOutputSchema.parse(
        (await h.prisma.mediaJob.findUniqueOrThrow({ where: { id: first.job.id } })).output,
      ).status,
    ).toBe("ok");
    const next = await h.readyAudio(false),
      before = await h.snapshot();
    h.permitControlledModel(false);
    h.budget.readPermit.mockClear();
    h.budget.reserve.mockClear();
    h.evalCall.mockClear();
    h.fake.storage.resetCalls();
    h.fake.asr.resetCalls();
    await h.media.jobs.run({ jobId: next.job.id });
    expect(
      AssetJobOutputSchema.parse(
        (await h.prisma.mediaJob.findUniqueOrThrow({ where: { id: next.job.id } })).output,
      ),
    ).toMatchObject({ status: "ok", reusedFromId: expect.any(String) });
    expect(h.budget.readPermit).not.toHaveBeenCalled();
    expect(h.budget.reserve).not.toHaveBeenCalled();
    expect(h.evalCall).not.toHaveBeenCalled();
    expect(h.fake.storage.callsOf("presignGet")).toHaveLength(0);
    expect(h.fake.asr.callsOf("submit")).toHaveLength(0);
    expect(h.fake.asr.callsOf("query")).toHaveLength(0);
    expect(h.fake.asr.callsOf("transcribe")).toHaveLength(0);
    expect(await h.snapshot()).toEqual(before);
  });

  it("合法跨北京日已接收TaskId查询不依赖当天账本状态", async () => {
    const facts = await h.readyAudio();
    const day = Math.floor((h.clock.now().getTime() + 28800000) / 86400000);
    const midnight = day * 86400000 - 28800000;
    // 合法历史已接收任务，原deadline仍30分钟；不是新提交/修改预算代次。
    const taskId = "9007199254740993";
    const job = await h.prisma.mediaJob.update({
      where: { id: facts.job.id },
      data: {
        externalJobId: taskId,
        createdAt: new Date(midnight - 60000),
        startedAt: new Date(midnight - 59000),
        deadlineAt: new Date(midnight + 1740000),
        nextRunAt: new Date(midnight + 180000),
      },
    });
    h.clock.set(new Date(midnight + 60000));
    h.fake.asr.tasks.set(taskId, { taskId, requestId: "fake-asr", state: "doing" });
    await client.unlink(h.key);
    expect(await h.asrStrategy().recover(job, signal())).toEqual({ state: "pending" });
    expect(h.fake.asr.callsOf("query")[0]!.input).toMatchObject({ taskId });
    expect(h.budget.readPermit).not.toHaveBeenCalled();
    expect(h.budget.reserve).not.toHaveBeenCalled();
    expect(h.fake.asr.callsOf("submit")).toHaveLength(0);
    expect(h.evalCall).not.toHaveBeenCalled();
  });

  it.each(["false", "throws", "true"])("ASR查询显式legacy %s保持一次原语义", async (mode) => {
    const facts = await h.readyAudio(),
      submitted = await h.asrStrategy().execute(facts.job, signal());
    if (submitted.state !== "submitted") throw new Error("ASR未提交");
    const job = await h.prisma.mediaJob.update({
      where: { id: facts.job.id },
      data: { externalJobId: submitted.externalJobId },
    });
    const legacy = vi.fn(async () => {
      if (mode === "throws") throw new Error("原守卫错误");
      return mode === "true";
    });
    const d = h.deps();
    h.budget.readPermit.mockClear();
    h.budget.reserve.mockClear();
    h.fake.asr.resetCalls();
    const result = await h
      .asrStrategy({ ...d, assets: { ...d.assets, allowModelCall: legacy } })
      .poll(job, signal());
    expect(legacy).toHaveBeenCalledTimes(1);
    if (mode === "false") expect(structuredOutput(result).reason).toBe("budget_unconfigured");
    else expect(result).toEqual({ state: "pending" });
    expect(h.fake.asr.callsOf("query")).toHaveLength(mode === "true" ? 1 : 0);
    expect(h.budget.readPermit).not.toHaveBeenCalled();
    expect(h.budget.reserve).not.toHaveBeenCalled();
  });

  it("人工retry同job/attempt/kind保守冲突，不新造代次或重复模型IO", async () => {
    const facts = await h.readyText();
    expect(structuredOutput(await h.digestStrategy().execute(facts.job, signal())).status).toBe(
      "ok",
    );
    const before = await h.snapshot();
    await h.refresh();
    expect(await h.digestStrategy().execute(facts.job, signal())).toEqual({ state: "canceled" });
    expect(h.digest).toHaveBeenCalledTimes(1);
    expect(h.budget.reserve).toHaveBeenCalledTimes(2);
    expect(await spent()).toBe(3);
    const after = await h.snapshot();
    for (const [key, value] of Object.entries(before).filter(([key]) => /^[gsftq]:/.test(key)))
      expect(after[key]).toBe(value);
  });

  describe("摘要Unicode来源准备", () => {
    let facts: Awaited<ReturnType<ModelWorld["readyDigestSources"]>>, next: typeof facts;
    beforeEach(async () => {
      // 九个文件仍全部实际注册、提升及审核；造数沿用 setup 预算，正文执行仍限默认5秒。
      facts = await h.readyDigestSources(
        "说明",
        Array.from({ length: 9 }, () => "😀" + "文".repeat(1998)),
      );
      next = await h.readyDigestSources(
        "说明",
        Array.from({ length: 9 }, () => "文".repeat(2000)),
        facts.files,
      );
    }, SLOW);
    it("摘要Unicode实际16000码点贡献只计留存正文，所有丢弃后缀仍绑定hash", async () => {
      // 每段2000 UTF16/1999码点，说明/前缀/换行仍占原布局；第九个文件完全被截掉。
      expect(structuredOutput(await h.digestStrategy().execute(facts.job, signal())).status).toBe(
        "ok",
      );
      const input = h.digest.mock.calls[0]![0];
      expect(Array.from(input.text)).toHaveLength(16000);
      expect(h.budget.reserve.mock.calls[0]![0].fileIds).toEqual(
        facts.files
          .slice(0, 8)
          .map((file) => file.id)
          .sort(),
      );
      expect(await spent()).toBe(3);
      const original = h.budget.reserve.getMockImplementation()!;
      h.budget.reserve.mockImplementationOnce(async (context, abort) => {
        const paid = await original(context, abort),
          last = next.sources[8]!;
        await h.tx.run(async (tx) => {
          await lockRows(tx, "store_asset", [next.assetId]);
          const content = { description: "文".repeat(1999) + "改", tags: [] };
          const old = AssetJobOutputSchema.parse(last.origin.output);
          await tx.mediaJob.update({
            where: { id: last.origin.id },
            data: { output: json({ ...old, content }) },
          });
          await tx.storeAssetInsight.update({
            where: { id: last.insight.id },
            data: { content: json(content) },
          });
        });
        return paid;
      });
      expect(await h.digestStrategy().execute(next.job, signal())).toEqual({ state: "canceled" });
      expect(h.digest).toHaveBeenCalledTimes(1);
      expect(await spent()).toBe(6);
    });
  });
});
