import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma, MediaJob } from "@liyoxi/db";
import { createTxRunner, lockRows, uuidv7, assertNotInTransaction } from "../../kernel/index.js";
import { createClock, createFactories, useSeededDatabase } from "../../testing/index.js";
import { createMediaJobs } from "./runner.js";
import type { MediaJobs } from "./runner.js";
import type { MediaJobHandler, JobOutcome } from "./types.js";
import { findI10Violations, findI11Violations } from "./invariants.js";
import { registration } from "../register.js";
const handle = useSeededDatabase("services");
const clock = createClock();
let db: Awaited<ReturnType<typeof handle.prisma>>;
let tx: ReturnType<typeof createTxRunner>;
let fileId: string;
const owned: MediaJobs[] = [];
const ids: string[] = [];
const parents: string[] = [];
beforeAll(async () => {
  db = await handle.prisma();
  tx = createTxRunner({ prisma: db, appEnv: "test" });
  fileId = (await createFactories({ db, clock }).fileObject()).id;
});
afterEach(async () => {
  await Promise.all(owned.splice(0).map((jobs) => jobs.shutdown()));
  await db.mediaJob.deleteMany({ where: { id: { in: ids.splice(0) } } });
  await db.playableAsset.deleteMany({ where: { id: { in: parents.splice(0) } } });
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const success = (): JobOutcome => ({ state: "succeeded", output: { done: true } });
function handler(overrides: Partial<MediaJobHandler> = {}): MediaJobHandler {
  return {
    kind: "digest",
    mode: "local",
    provider: "local",
    validInput: (input) => JSON.stringify(input) === '{"v":1}',
    validOutput: (output) => JSON.stringify(output) === '{"done":true}',
    current: async (t, job) => {
      await lockRows(t, "file_object", [job.subjectId]);
      return true;
    },
    execute: async () => {
      assertNotInTransaction("media-test-call");
      return success();
    },
    ...overrides,
  };
}
function runner(one: MediaJobHandler, extra: Partial<Parameters<typeof createMediaJobs>[0]> = {}) {
  const jobs = createMediaJobs({ tx, clock, ownerId: uuidv7(), handlers: [one], ...extra });
  owned.push(jobs);
  return jobs;
}
async function job(
  overrides: Partial<Prisma.MediaJobUncheckedCreateInput> = {},
): Promise<MediaJob> {
  const id = uuidv7();
  ids.push(id);
  return db.mediaJob.create({
    data: {
      id,
      kind: "digest",
      provider: "local",
      mode: "local",
      subjectType: "file_object",
      subjectId: fileId,
      dedupeKey: `w303runner:${id}`,
      state: "queued",
      input: { v: 1 },
      nextRunAt: clock.now(),
      deadlineAt: new Date(clock.now().getTime() + 15 * 60_000),
      createdAt: clock.now(),
      updatedAt: clock.now(),
      ...overrides,
    },
  });
}
async function parent() {
  const id = uuidv7();
  parents.push(id);
  return db.playableAsset.create({
    data: {
      id,
      kind: "trailer",
      sourceFileId: fileId,
      ownerType: "drama",
      ownerId: uuidv7(),
      state: "processing",
      specVersion: 1,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
  });
}
describe("统一媒体事实执行器", { timeout: 30_000 }, () => {
  it("双worker同时认领同一事实只外呼/收尾一次", async () => {
    const row = await job();
    const execute = vi.fn(async () => {
      assertNotInTransaction("media-test-call");
      return success();
    });
    const finish = vi.fn(async () => {});
    const a = runner(handler({ execute, finish })),
      b = runner(handler({ execute, finish }));
    await Promise.all([a.run({ jobId: row.id }), b.run({ jobId: row.id })]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "succeeded",
      attemptNo: 1,
      leaseOwner: null,
    });
  });
  it("Redis丢失唤醒时scan仍从事实表直接执行，原20行上限保留", async () => {
    const rows = await Promise.all(Array.from({ length: 21 }, () => job()));
    const execute = vi.fn(async () => success());
    const enqueue = vi.fn(async () => {
      throw new Error("fake redis down");
    });
    const jobs = runner(handler({ execute }), { channel: { enqueue } });
    expect(await jobs.scan()).toBe(20);
    expect(enqueue).toHaveBeenCalledTimes(20);
    // Local gate is two, so queue loss must not masquerade as completion for the remaining candidates.
    await vi.waitFor(async () =>
      expect(
        await db.mediaJob.count({
          where: { id: { in: rows.map((row) => row.id) }, state: "succeeded" },
        }),
      ).toBeGreaterThan(0),
    );
    await jobs.scan();
    expect(execute.mock.calls.length).toBeLessThanOrEqual(21);
  });
  it("扫描只等真实认领，长IO由同一owned集合持有；关停等待它完成", async () => {
    const row = await job();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false,
      scanned = false,
      stopped = false;
    const jobs = runner(
      handler({
        execute: async () => {
          started = true;
          await held;
          return success();
        },
      }),
    );
    const beat = vi.fn();
    const scanning = jobs.scan(beat).then((count) => {
      scanned = true;
      return count;
    });
    try {
      await vi.waitFor(() => expect(scanned).toBe(true));
      expect(await scanning).toBe(1);
      expect(beat).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(started).toBe(true));
      expect((await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).state).toBe(
        "running",
      );
      const stop = jobs.shutdown().then(() => {
        stopped = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stopped).toBe(false);
      release();
      await stop;
      expect((await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).state).toBe(
        "succeeded",
      );
    } finally {
      release();
      await scanning;
      await jobs.shutdown();
    }
  });
  it("同job扫描与队列双入口并发仅一个owned IO，close持有赢家直到清理", async () => {
    const row = await job();
    function latch() {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    }
    const scanRead = latch(),
      releaseScan = latch(),
      claimRead = latch(),
      releaseClaim = latch();
    let transaction = 0;
    const controlledTx: typeof tx = {
      run(fn, options) {
        const phase = ++transaction;
        return tx.run(async (current) => {
          const result = await fn(current);
          // 保持扫描的真实 SELECT 事务，再让队列入口完成模式读取及真实认领。
          if (phase === 1) {
            scanRead.release();
            await releaseScan.promise;
          } else if (phase === 3) {
            // 认领提交前仍在 owned 集合中，确定重放扫描随后进入去重的交错。
            claimRead.release();
            await releaseClaim.promise;
          }
          return result;
        }, options);
      },
    };
    let entered = 0,
      release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const jobs = runner(
      handler({
        execute: async () => {
          entered++;
          await held;
          return success();
        },
      }),
      { tx: controlledTx },
    );
    const scanning = jobs.scan();
    let queued: Promise<void> | undefined;
    let closed = false;
    try {
      await scanRead.promise;
      queued = jobs.run({ jobId: row.id });
      await claimRead.promise;
      releaseScan.release();
      await scanning;
      releaseClaim.release();
      await vi.waitFor(() => expect(entered).toBe(1));
      const closing = jobs.shutdown().then(() => {
        closed = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      expect((await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).attemptNo).toBe(1);
      release();
      await queued;
      await closing;
      expect(entered).toBe(1);
      expect(closed).toBe(true);
      expect((await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).state).toBe(
        "succeeded",
      );
    } finally {
      releaseScan.release();
      releaseClaim.release();
      release();
      await Promise.allSettled([queued, scanning]);
      await jobs.shutdown();
    }
  });
  it("本机90秒硬超时真实取消IO并清理，保留一分钟退避事实", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const scheduled = vi.spyOn(globalThis, "setTimeout"),
      cleared = vi.spyOn(globalThis, "clearTimeout");
    const row = await job();
    let started = false,
      cleaned = false;
    const jobs = runner(
      handler({
        execute: async (_job, _context, signal) => {
          started = true;
          await new Promise<void>((resolve) =>
            signal.addEventListener(
              "abort",
              () => {
                cleaned = true;
                resolve();
              },
              { once: true },
            ),
          );
          return { state: "failed", failure: { code: "ABORTED", retryable: true } };
        },
      }),
    );
    const call = jobs.run({ jobId: row.id });
    await vi.waitFor(() => expect(started).toBe(true));
    clock.advance(90_000);
    await vi.advanceTimersByTimeAsync(90_000);
    await call;
    expect(cleaned).toBe(true);
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "queued",
      attemptNo: 1,
      errorCode: "MEDIA_JOB_TIMEOUT",
      leaseOwner: null,
      nextRunAt: new Date(clock.now().getTime() + 60_000),
    });
    const own = scheduled.mock.calls.flatMap((call, index) =>
      call[1] === 90_000 ? [scheduled.mock.results[index]!.value] : [],
    );
    expect(own).toHaveLength(1);
    for (const timer of own) expect(cleared).toHaveBeenCalledWith(timer);
  });
  it("SIGTERM先等45秒再取消自己的IO，条件退queued且attempt仅减一次", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const scheduled = vi.spyOn(globalThis, "setTimeout"),
      cleared = vi.spyOn(globalThis, "clearTimeout");
    const row = await job();
    let started = false,
      cleaned = false,
      stopped = false;
    const jobs = runner(
      handler({
        execute: async (_job, _context, signal) => {
          started = true;
          await new Promise<void>((resolve) =>
            signal.addEventListener(
              "abort",
              () => {
                cleaned = true;
                resolve();
              },
              { once: true },
            ),
          );
          return { state: "failed", failure: { code: "ABORTED", retryable: true } };
        },
      }),
    );
    const call = jobs.run({ jobId: row.id });
    await vi.waitFor(() => expect(started).toBe(true));
    const stop = jobs.shutdown().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(44_999);
    expect(cleaned).toBe(false);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stop;
    await call;
    expect(cleaned).toBe(true);
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "queued",
      attemptNo: 0,
      leaseOwner: null,
      nextRunAt: clock.now(),
    });
    await jobs.shutdown();
    await jobs.run({ jobId: row.id });
    expect((await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).attemptNo).toBe(0);
    const own = scheduled.mock.calls.flatMap((call, index) =>
      [90_000, 45_000].includes(Number(call[1])) ? [scheduled.mock.results[index]!.value] : [],
    );
    expect(own).toHaveLength(2);
    for (const timer of own) expect(cleared).toHaveBeenCalledWith(timer);
  });
  it.each([
    ["local", "digest", 2],
    ["remote", "transcode_mp4", 8],
  ] as const)("%s/%s 同时外呼上限为 %i（实际屏障）", async (mode, kind, limit) => {
    let active = 0,
      maximum = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const one = handler({
      kind,
      mode,
      execute: async () => {
        active++;
        maximum = Math.max(maximum, active);
        try {
          await held;
          return success();
        } finally {
          active--;
        }
      },
    });
    const jobs = runner(one);
    const rows = await Promise.all(Array.from({ length: limit + 1 }, () => job({ mode, kind })));
    const calls = rows.map((row) => jobs.run({ jobId: row.id }));
    try {
      await vi.waitFor(() => expect(active).toBe(limit));
      expect(maximum).toBe(limit);
      expect(
        await db.mediaJob.count({
          where: { id: { in: rows.map((row) => row.id) }, state: "queued" },
        }),
      ).toBe(1);
    } finally {
      release();
      await Promise.all(calls);
    }
    expect(active).toBe(0);
  });
  it("租约过期另一实例获新attempt后，旧响应不改赢家整行", async () => {
    const row = await job();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let called = 0;
    const execute = async () => {
      if (++called === 1) await held;
      return success();
    };
    const a = runner(handler({ execute })),
      b = runner(handler({ execute }));
    const old = a.run({ jobId: row.id });
    try {
      await vi.waitFor(() => expect(called).toBe(1));
      clock.advance(120_001);
      await b.run({ jobId: row.id });
      const winner = await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } });
      expect(winner).toMatchObject({ state: "succeeded", attemptNo: 2 });
      release();
      await old;
      expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toEqual(winner);
    } finally {
      release();
      await old;
    }
  });
  it("失败按一分钟再五分钟退避，maxAttempts用尽后终态", async () => {
    const row = await job();
    const jobs = runner(
      handler({
        execute: async () => ({
          state: "failed",
          failure: { code: "FIXTURE_RETRY", retryable: true },
        }),
      }),
    );
    const start = clock.now().getTime();
    await jobs.run({ jobId: row.id });
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "queued",
      attemptNo: 1,
      nextRunAt: new Date(start + 60_000),
    });
    clock.advance(60_000);
    await jobs.run({ jobId: row.id });
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "queued",
      attemptNo: 2,
      nextRunAt: new Date(start + 360_000),
    });
    clock.advance(300_000);
    await jobs.run({ jobId: row.id });
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "failed",
      attemptNo: 3,
      leaseOwner: null,
    });
  });
  it("非法输入/未接kind/processed假输出不会外呼或成功，错误只留固定码", async () => {
    const execute = vi.fn(async () => success());
    const jobs = runner(handler({ execute }));
    for (const row of [
      await job({ input: { v: 1, openid: "fixture-sensitive" } }),
      await job({ kind: "vision" }),
    ]) {
      await jobs.run({ jobId: row.id });
      expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        state: "failed",
        errorCode: "MEDIA_HANDLER_UNSUPPORTED",
      });
    }
    expect(execute).not.toHaveBeenCalled();
    const invalid = await job();
    const bad = runner(
      handler({
        execute: async () => ({ state: "succeeded", output: { raw: "fixture-sensitive" } }),
      }),
    );
    await bad.run({ jobId: invalid.id });
    const result = await db.mediaJob.findUniqueOrThrow({ where: { id: invalid.id } });
    expect(result.state).toBe("failed");
    expect(result.output).toBeNull();
    expect(JSON.stringify(result)).not.toContain('"raw"');
  });
  it("正常收尾父锁先于job/file且同TX纯汇合；父退役后晚响应被取消", async () => {
    const p = await parent(),
      row = await job({ parentType: "playable_asset", parentId: p.id });
    const converge = vi.fn(
      async (t: Parameters<MediaJobHandler["current"]>[0], id: string, now: Date) => {
        const facts = await t.mediaJob.findMany({
          where: { parentId: id },
          select: { state: true },
        });
        if (facts.every((one) => one.state === "succeeded"))
          await t.playableAsset.updateMany({
            where: { id, state: "processing" },
            data: { state: "ready", updatedAt: now, readyAt: now },
          });
      },
    );
    const one = handler({
      current: async (t, j) => {
        await lockRows(t, "playable_asset", [p.id]);
        await lockRows(t, "media_job", [j.id]);
        await lockRows(t, "file_object", [fileId]);
        return (
          (await t.playableAsset.findUniqueOrThrow({ where: { id: p.id } })).state === "processing"
        );
      },
    });
    const jobs = runner(one, {
      convergenceHandlers: [{ parentType: "playable_asset", needed: async () => true, converge }],
    });
    await jobs.run({ jobId: row.id });
    expect((await db.playableAsset.findUniqueOrThrow({ where: { id: p.id } })).state).toBe("ready");
    expect(converge).toHaveBeenCalledTimes(1);
    const late = await job({ parentType: "playable_asset", parentId: p.id });
    await jobs.run({ jobId: late.id });
    expect((await db.mediaJob.findUniqueOrThrow({ where: { id: late.id } })).state).toBe(
      "canceled",
    );
  });
  it("收尾业务故障整体回滚，可由旧租约恢复，不伪成功", async () => {
    const row = await job();
    const jobs = runner(
      handler({
        finish: async () => {
          throw new Error("fixture-fault");
        },
      }),
    );
    await expect(jobs.run({ jobId: row.id })).rejects.toThrow("fixture-fault");
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "running",
      attemptNo: 1,
    });
  });
  it("I10按截止而非since发现旧行，同TX自愈且回滚不丢任务", async () => {
    const row = await job({
      deadlineAt: new Date(clock.now().getTime() - 1),
      nextRunAt: new Date(clock.now().getTime() + 600_000),
    });
    const jobs = runner(handler());
    await expect(
      tx.run(async (t) => {
        await findI10Violations(t, { since: clock.now() }, clock.now(), jobs);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect((await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).state).toBe("queued");
    const result = await tx.run((t) => findI10Violations(t, {}, clock.now(), jobs));
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("healed");
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "failed",
      errorCode: "MEDIA_JOB_DEADLINE",
    });
  });
  it("真实登记先查询空集；有截止或停滞候选但未绑定执行器仍报错且不写业务", async () => {
    const deadline = registration.invariants.find((one) => one.code === "media.I10")!;
    const stale = registration.invariants.find((one) => one.code === "media.I11")!;
    for (const check of [deadline, stale])
      expect(await tx.run((t) => check.run!(t, {}, { now: clock.now() }))).toEqual([]);
    const row = await job({ deadlineAt: new Date(clock.now().getTime() - 1) });
    await expect(tx.run((t) => deadline.run!(t, {}, { now: clock.now() }))).rejects.toThrow(
      "媒体执行器未绑定实际运行时",
    );
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    const p = await parent();
    const old = new Date(clock.now().getTime() - 15 * 60_000);
    const before = await db.playableAsset.update({ where: { id: p.id }, data: { updatedAt: old } });
    await expect(tx.run((t) => stale.run!(t, {}, { now: clock.now() }))).rejects.toThrow(
      "媒体执行器未绑定实际运行时",
    );
    expect(await db.playableAsset.findUniqueOrThrow({ where: { id: p.id } })).toEqual(before);
  });
  it("I11未接业务留未自愈事实，接入同纯函数后幂等汇合；15分钟界限不缩短", async () => {
    const p = await parent();
    const old = new Date(clock.now().getTime() - 15 * 60_000);
    await db.playableAsset.update({ where: { id: p.id }, data: { updatedAt: old } });
    const jobs = runner(handler());
    const violations = await tx.run((t) => findI11Violations(t, {}, clock.now(), jobs));
    expect(violations).toHaveLength(1);
    expect(violations[0]).not.toHaveProperty("healed");
    expect((await db.playableAsset.findUniqueOrThrow({ where: { id: p.id } })).state).toBe(
      "processing",
    );
    const healed = runner(handler(), {
      convergenceHandlers: [
        {
          parentType: "playable_asset",
          needed: async () => true,
          converge: async (t, id, now) => {
            await t.playableAsset.update({
              where: { id },
              data: { state: "failed", updatedAt: now },
            });
          },
        },
      ],
    });
    expect((await tx.run((t) => findI11Violations(t, {}, clock.now(), healed)))[0]).toHaveProperty(
      "healed",
    );
    expect(await tx.run((t) => findI11Violations(t, {}, clock.now(), healed))).toEqual([]);
  });
  it("主租约丢失只取消自己IO并退回自己的local一次，恢复后可重领", async () => {
    const row = await job();
    let started = false,
      cleaned = false;
    const jobs = runner(
      handler({
        execute: async (_j, _c, signal) => {
          started = true;
          if (signal.aborted) {
            cleaned = true;
            return { state: "failed", failure: { code: "ABORT", retryable: true } };
          }
          await new Promise<void>((resolve) =>
            signal.addEventListener(
              "abort",
              () => {
                cleaned = true;
                resolve();
              },
              { once: true },
            ),
          );
          return { state: "failed", failure: { code: "ABORT", retryable: true } };
        },
      }),
    );
    const call = jobs.run({ jobId: row.id });
    await vi.waitFor(() => expect(started).toBe(true));
    await jobs.pause();
    await call;
    expect(cleaned).toBe(true);
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "queued",
      attemptNo: 0,
      leaseOwner: null,
    });
    await jobs.run({ jobId: row.id });
    expect((await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).attemptNo).toBe(0);
    jobs.resume();
    const resumed = jobs.run({ jobId: row.id });
    await vi.waitFor(async () =>
      expect((await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).attemptNo).toBe(1),
    );
    await jobs.pause();
    await resumed;
  });
  it("在途父needed失效但handler.current仍true时取消且不覆盖父赢家", async () => {
    const p = await parent(),
      row = await job({ parentType: "playable_asset", parentId: p.id });
    let release!: () => void,
      entered = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const successFinish = vi.fn();
    const jobs = runner(
      handler({
        execute: async () => {
          entered = true;
          await held;
          return success();
        },
        finish: async (_t, _job, outcome) => {
          if (outcome.state === "succeeded") successFinish();
        },
      }),
      {
        convergenceHandlers: [
          {
            parentType: "playable_asset",
            needed: async (t, j) =>
              (await t.playableAsset.findUniqueOrThrow({ where: { id: j.parentId! } })).state ===
              "processing",
            converge: async () => {},
          },
        ],
      },
    );
    const call = jobs.run({ jobId: row.id });
    try {
      await vi.waitFor(() => expect(entered).toBe(true));
      expect((await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).state).toBe(
        "running",
      );
      const winner = await db.playableAsset.update({
        where: { id: p.id },
        data: { state: "ready", readyAt: clock.now(), updatedAt: clock.now() },
      });
      release();
      await call;
      expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        state: "canceled",
        output: null,
        leaseOwner: null,
      });
      expect(successFinish).not.toHaveBeenCalled();
      expect(await db.playableAsset.findUniqueOrThrow({ where: { id: p.id } })).toEqual(winner);
    } finally {
      release();
      await call;
    }
  });
  it("deadline过期父needed已失效而current仍true时取消而非失败副作用", async () => {
    const p = await parent();
    const row = await job({
      parentType: "playable_asset",
      parentId: p.id,
      deadlineAt: new Date(clock.now().getTime() - 1),
    });
    const failedFinish = vi.fn();
    const jobs = runner(
      handler({
        finish: async (_t, _j, outcome) => {
          if (outcome.state === "failed") failedFinish();
        },
      }),
      {
        convergenceHandlers: [
          {
            parentType: "playable_asset",
            needed: async (t, j) =>
              (await t.playableAsset.findUniqueOrThrow({ where: { id: j.parentId! } })).state ===
              "processing",
            converge: async () => {},
          },
        ],
      },
    );
    const winner = await db.playableAsset.update({
      where: { id: p.id },
      data: { state: "ready", readyAt: clock.now(), updatedAt: clock.now() },
    });
    expect(await tx.run((t) => jobs.expire(t, row.id, clock.now()))).toBe(true);
    expect(await db.mediaJob.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "canceled",
      errorCode: null,
      leaseOwner: null,
    });
    expect(failedFinish).not.toHaveBeenCalled();
    expect(await db.playableAsset.findUniqueOrThrow({ where: { id: p.id } })).toEqual(winner);
  });
});
