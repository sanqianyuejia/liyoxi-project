import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectTestDatabase, useSeededDatabase, useTestRedis } from "../../testing/index.js";
import { createTxRunner, lockRows, sqlStateOf, TX_RETRIES } from "../../kernel/index.js";
import type { Tx, TxRunner } from "../../kernel/index.js";
import { createModelBudgetLedger } from "../index.js";
import { admitModel, readModelJob } from "./model-admission.js";
import {
  modelWorld,
  signal,
  structuredOutput,
  gate,
  SLOW,
} from "./__fixtures__/model-admission.js";
import type { ModelWorld } from "./__fixtures__/model-admission.js";

const db = useSeededDatabase("services", { max: 1 }),
  redis = useTestRedis();
let client: Awaited<ReturnType<typeof redis.raw>>, other: typeof client, h: ModelWorld;
let holder: Awaited<ReturnType<typeof connectTestDatabase>>, observer: typeof holder;
beforeAll(async () => {
  client = await redis.raw();
  other = await redis.raw();
  await db.prisma();
  holder = await connectTestDatabase(db.name);
  observer = await connectTestDatabase(db.name, { role: null });
}, SLOW);
beforeEach(async () => {
  h = await modelWorld(await db.prisma(), client, redis.prefix);
}, SLOW);
afterEach(async () => {
  try {
    await holder.query("ROLLBACK");
    await h?.close();
  } finally {
    vi.restoreAllMocks();
  }
}, SLOW);
afterAll(async () => {
  await Promise.all([holder?.end(), observer?.end()]);
}, SLOW);

async function heldFile(fileId: string) {
  await holder.query("BEGIN");
  await holder.query("SELECT id FROM file_object WHERE id=$1 FOR UPDATE", [fileId]);
  const row = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0];
  if (!row) throw new Error("没有真实holder PID");
  return row.pid;
}
async function waitBlocked(pid: number) {
  const until = Date.now() + 2000;
  while (Date.now() < until) {
    const rows = await observer.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND datname=current_database()",
      [pid],
    );
    if (rows.rows.length) return rows.rows[0]!.pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("未看到真实410等待，不放行竞态断言");
}

describe("真实短事务、竞争和不可退款边界", { timeout: SLOW }, () => {
  it.each([
    ["asr", 1],
    ["asr", 2],
    ["vision", 1],
    ["vision", 2],
    ["digest", 1],
    ["digest", 2],
  ] as const)("%s phase%d真实回调结束但事务未提交时零后续IO", async (kind, phase) => {
    const facts =
      kind === "asr"
        ? await h.readyAudio()
        : kind === "vision"
          ? await h.readyImage()
          : await h.readyText();
    const entered = gate(),
      release = gate(),
      permits = new WeakMap<Tx, number>();
    const original = h.budget.readPermit.getMockImplementation()!;
    let n = 0;
    h.budget.readPermit.mockImplementation(async (handle, input) => {
      permits.set(handle, ++n);
      return original(handle, input);
    });
    const run: TxRunner["run"] = (fn) =>
      h.tx.run(async (handle) => {
        const result = await fn(handle);
        if (permits.get(handle) === phase) {
          entered.release();
          await release.promise;
        }
        return result;
      });
    const d = h.deps({ tx: { run } });
    const strategy =
      kind === "asr"
        ? h.asrStrategy(d)
        : kind === "vision"
          ? h.visionStrategy(d)
          : h.digestStrategy(d);
    const pending = strategy.execute(facts.job, signal());
    try {
      await Promise.race([
        entered.promise,
        pending.then(() => {
          throw new Error("未进入目标真实提交门闩");
        }),
      ]);
      expect(h.budget.reserve).toHaveBeenCalledTimes(phase === 1 ? 0 : 1);
      expect(h.fake.asr.callsOf("submit")).toHaveLength(0);
      expect(h.vision).not.toHaveBeenCalled();
      expect(h.digest).not.toHaveBeenCalled();
      let finished = false;
      void pending.then(() => {
        finished = true;
      });
      await Promise.resolve();
      expect(finished).toBe(false);
    } finally {
      release.release();
      await pending;
    }
    const outcome = await pending;
    expect(outcome.state).toBe(kind === "asr" ? "submitted" : "succeeded");
    if (kind !== "asr") expect(structuredOutput(outcome).status).toBe("ok");
    expect(h.budget.reserve).toHaveBeenCalledTimes(1);
    expect(h.fake.asr.callsOf("submit")).toHaveLength(kind === "asr" ? 1 : 0);
    expect(h.vision).toHaveBeenCalledTimes(kind === "vision" ? 1 : 0);
    expect(h.digest).toHaveBeenCalledTimes(kind === "digest" ? 1 : 0);
  });

  it.each(["P1", "P2"])("%s完整410等待后的freshclock拒绝；仅P2保已付三槽", async (phase) => {
    const facts = await h.readyImage();
    let holderPid = 0;
    const signing = h.signing.getMockImplementation()!,
      reserve = h.budget.reserve.getMockImplementation()!;
    if (phase === "P1")
      h.signing.mockImplementation(async (input) => {
        const result = await signing(input);
        holderPid = await heldFile(facts.files[0]!.id);
        return result;
      });
    else
      h.budget.reserve.mockImplementation(async (permit, abort) => {
        const paid = await reserve(permit, abort);
        holderPid = await heldFile(facts.files[0]!.id);
        return paid;
      });
    const pending = h.visionStrategy().execute(facts.job, signal());
    try {
      const until = Date.now() + 2000;
      while (!holderPid && Date.now() < until)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(holderPid).toBeGreaterThan(0);
      expect(await waitBlocked(holderPid)).not.toBe(holderPid);
      expect(h.vision).not.toHaveBeenCalled();
      h.clock.advance(phase === "P1" ? 120000 : 250);
    } finally {
      await holder.query("COMMIT");
      await pending;
    }
    expect(await pending).toEqual({ state: "canceled" });
    expect(h.vision).not.toHaveBeenCalled();
    expect(h.budget.reserve).toHaveBeenCalledTimes(phase === "P1" ? 0 : 1);
    const ledger = await h.snapshot();
    expect(
      Object.entries(ledger)
        .filter(([key]) => key.startsWith("g:"))
        .map(([, value]) => value),
    ).toEqual(phase === "P1" ? [] : ["3"]);
    expect(ledger[`t:${facts.job.id}:1:vision`]).toBe(
      phase === "P1" ? undefined : String(facts.job.deadlineAt.getTime()),
    );
  });

  it.each(["source", "caps", "provider", "attempt", "lease", "graph", "deleted"])(
    "R后%s变化重锁复核失败保槽零模型",
    async (change) => {
      const facts = await h.readyImage(),
        extra = change === "graph" ? await h.stored() : undefined;
      const evaluate = h.evalCall.getMockImplementation()!;
      h.evalCall.mockImplementation((script, keys, argv) => {
        // 本组验已付许可之后的事实竞态，不量 CI 调度耗时；真实 Redis 与原预算逻辑，
        // 仅替换 TIME 读取为注入时钟。组外真实 TIME/250ms 边界用例不变。
        const now = h.clock.now().getTime();
        expect(script).toContain("redis.call('TIME')");
        return evaluate(
          script.replaceAll(
            "redis.call('TIME')",
            `{ '${Math.floor(now / 1000)}', '${(now % 1000) * 1000}' }`,
          ),
          keys,
          argv,
        );
      });
      const reserve = h.budget.reserve.getMockImplementation()!;
      h.budget.reserve.mockImplementationOnce(async (permit, abort) => {
        const paid = await reserve(permit, abort);
        expect(paid).toMatchObject({ status: "reserved", units: 3 });
        if (change === "caps") h.caps.dailyFileCap = 199;
        else
          await h.tx.run(async (tx) => {
            await lockRows(tx, "store_asset", [facts.assetId]);
            await lockRows(tx, "media_job", [facts.job.id]);
            if (change === "source") {
              await lockRows(tx, "file_object", [facts.files[0]!.id]);
              await tx.fileObject.update({
                where: { id: facts.files[0]!.id },
                data: { etag: "actual-winner-etag" },
              });
            }
            if (change === "provider")
              await tx.mediaJob.update({
                where: { id: facts.job.id },
                data: { provider: "unconfigured" },
              });
            if (change === "attempt")
              await tx.mediaJob.update({ where: { id: facts.job.id }, data: { attemptNo: 2 } });
            if (change === "lease")
              await tx.mediaJob.update({
                where: { id: facts.job.id },
                data: { leaseOwner: "other-worker" },
              });
            if (change === "deleted")
              await tx.storeAsset.update({
                where: { id: facts.assetId },
                data: { deletedAt: h.clock.now() },
              });
            if (change === "graph")
              await tx.storeAssetFile.create({
                data: {
                  storeAssetId: facts.assetId,
                  fileId: extra!.id,
                  position: 2,
                  createdAt: h.clock.now(),
                },
              });
          });
        return paid;
      });
      await h.refresh();
      expect(await h.visionStrategy().execute(facts.job, signal())).toEqual({ state: "canceled" });
      expect(h.vision).not.toHaveBeenCalled();
      expect(h.budget.reserve).toHaveBeenCalledTimes(1);
      expect((await h.snapshot())[`t:${facts.job.id}:1:vision`]).toBe(
        String(facts.job.deadlineAt.getTime()),
      );
    },
  );

  it("同Tx来源写入随后rollback仍不能把未提交来源发给模型", async () => {
    const facts = await h.readyText(),
      before = await h.prisma.storeAsset.findUniqueOrThrow({ where: { id: facts.assetId } });
    const real = h.budget.readPermit.getMockImplementation()!;
    h.budget.readPermit.mockImplementation(async (tx, facts) => {
      await tx.storeAsset.update({
        where: { id: before.id },
        data: { textBody: "必须回滚的正文" },
      });
      await real(tx, facts);
      throw new Error("同Tx失败");
    });
    expect(structuredOutput(await h.digestStrategy().execute(facts.job, signal())).reason).toBe(
      "budget_unavailable",
    );
    expect(await h.prisma.storeAsset.findUniqueOrThrow({ where: { id: before.id } })).toEqual(
      before,
    );
    expect(h.budget.reserve).not.toHaveBeenCalled();
    expect(h.digest).not.toHaveBeenCalled();
  });

  it.each([1, 2])("真实phase%d COMMIT 40001耗尽：callback成功不是许可成功", async (failedPhase) => {
    const facts = await h.readyText(),
      bizDate = new Date("2026-10-12");
    const mine = failedPhase === 1 ? "MA" : "MC",
      theirs = failedPhase === 1 ? "MB" : "MD";
    for (const prefix of [mine, theirs])
      await h.prisma.bizSequence.create({ data: { prefix, bizDate, nextVal: 1 } });
    const realTx = createTxRunner({ prisma: h.prisma, appEnv: "test" });
    let phase = 0,
      callbackEnds = 0;
    const commitErrors: unknown[] = [];
    const run: TxRunner["run"] = async (fn) => {
      if (++phase !== failedPhase) return realTx.run(fn);
      try {
        return await realTx.run(async (tx) => {
          await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
          await tx.$queryRaw`SELECT prefix,next_val FROM biz_sequence`;
          await tx.$executeRaw`UPDATE biz_sequence SET next_val=next_val+1 WHERE prefix=${mine}`;
          const result = await fn(tx);
          await holder.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
          await holder.query("SELECT prefix,next_val FROM biz_sequence");
          await holder.query("UPDATE biz_sequence SET next_val=next_val+1 WHERE prefix=$1", [
            theirs,
          ]);
          await holder.query("COMMIT");
          callbackEnds += 1;
          return result;
        });
      } catch (error) {
        commitErrors.push(error);
        throw error;
      }
    };
    const d = h.deps({ tx: { run } });
    const read = async (tx: Tx) => {
      const graph = await readModelJob(d, tx, facts.job, h.current("digest"));
      return graph
        ? {
            entityId: graph.asset.entityId,
            storeId: graph.asset.storeId,
            fileIds: [],
            expectedSourceHash: h.sourceHash(graph.asset.textBody!),
          }
        : null;
    };
    const outcome = await admitModel(d, facts.job, signal(), read);
    if (!("state" in outcome)) throw new Error("提交失败不能交付许可");
    expect(structuredOutput(outcome).reason).toBe("budget_unavailable");
    expect(callbackEnds).toBe(1 + TX_RETRIES);
    expect(commitErrors).toHaveLength(1);
    expect(commitErrors[0]).toMatchObject({ error: "BUSY", cause: { name: "DriverAdapterError" } });
    expect(sqlStateOf((commitErrors[0] as { cause: unknown }).cause)).toBe("40001");
    const rows = await h.prisma.bizSequence.findMany({
      where: { prefix: { in: [mine, theirs] }, bizDate },
      orderBy: { prefix: "asc" },
    });
    expect(rows.map((row) => row.nextVal)).toEqual([1, 1 + callbackEnds]);
    expect(h.budget.reserve).toHaveBeenCalledTimes(failedPhase === 1 ? 0 : 1);
    expect(
      Object.entries(await h.snapshot())
        .filter(([key]) => key.startsWith("g:"))
        .map(([, value]) => value),
    ).toEqual(failedPhase === 1 ? [] : ["3"]);
    expect(h.digest).not.toHaveBeenCalled();
  });

  it("两个Redis客户端/两个真实owner同时争最后三槽只有一个模型调用", async () => {
    const first = await h.readyImage(),
      second = await h.readyImage();
    h.caps.dailyCallCap = 3;
    const ledger = createModelBudgetLedger({
      clock: h.clock,
      prefix: h.key.slice(0, -"model_budget:v1".length),
      transport: {
        eval: async (script, keys, argv) => other.eval(script, keys.length, ...keys, ...argv),
      },
    });
    const d = h.deps();
    const otherReserve = vi.fn(ledger.reserve);
    const pair = h.visionStrategy({
      ...d,
      assets: {
        ...d.assets,
        modelBudget: { readPermit: h.budget.readPermit, reserve: otherReserve },
      },
    });
    await h.refresh();
    const results = await Promise.all([
      h.visionStrategy().execute(first.job, signal()),
      pair.execute(second.job, signal()),
    ]);
    const outputs = results.map(structuredOutput);
    expect(outputs.map((result) => result.status).sort()).toEqual(["ok", "skipped"]);
    expect(outputs.find((result) => result.status === "skipped")?.reason).toBe("budget_exhausted");
    expect(h.vision).toHaveBeenCalledTimes(1);
    expect(h.budget.reserve).toHaveBeenCalledTimes(1);
    expect(otherReserve).toHaveBeenCalledTimes(1);
    const all = await h.snapshot();
    expect(
      Object.entries(all)
        .filter(([key]) => key.startsWith("g:"))
        .map(([, value]) => value),
    ).toEqual(["3"]);
    expect(Object.keys(all).filter((key) => key.startsWith("t:"))).toHaveLength(1);
    expect(Object.keys(all).filter((key) => key.startsWith("f:"))).toHaveLength(1);
  });
});
