import { Prisma } from "@liyoxi/db";
import type { MediaJob } from "@liyoxi/db";
import { assertLockOrder, createIdentityContext, lockRows, uuidv7 } from "../../kernel/index.js";
import type { Tx } from "../../kernel/index.js";
import type {
  JobOutcome,
  MediaJobHandler,
  MediaJobsOptions,
  MediaJobKind,
  MediaConvergenceHandler,
} from "./types.js";
import {
  jobBudget,
  MEDIA_SCAN_LIMIT,
  MEDIA_LOCAL_CONCURRENCY,
  MEDIA_REMOTE_CONCURRENCY,
  MEDIA_POLL_INITIAL_MS,
  MEDIA_POLL_MAX_MS,
  MEDIA_SHUTDOWN_WAIT_MS,
  retryDelay,
  nextPollDelay,
} from "./policy.js";

const activeStates = ["queued", "running", "submitting", "submitted"];
const terminalStates = ["succeeded", "failed", "canceled"];
const fail = (code: string, retryable = false): JobOutcome => ({
  state: "failed",
  failure: { code, retryable },
});
type Claim = {
  job: MediaJob;
  beforeState: string;
  handler: MediaJobHandler;
  context: unknown;
  owner: string;
  previousPoll: number;
};
export async function lockJobParent(tx: Tx, job: MediaJob, convergence?: MediaConvergenceHandler) {
  if (job.parentId && job.parentType) {
    if (
      ![
        "store_asset",
        "playable_asset",
        "upload_batch",
        "production_record",
        "zip_bundle",
      ].includes(job.parentType)
    )
      throw new TypeError("媒体父对象类型不合格");
    if (convergence?.lockSiblings) {
      await convergence.lockSiblings(tx, job.parentId);
      return;
    }
    await lockRows(
      tx,
      job.parentType as
        "store_asset" | "playable_asset" | "upload_batch" | "production_record" | "zip_bundle",
      [job.parentId],
    );
  }
}
const sameParent = (left: MediaJob, right: MediaJob) =>
  left.parentId === right.parentId && left.parentType === right.parentType;

export function createMediaJobs(options: MediaJobsOptions) {
  const { tx: transactions, clock } = options;
  const handlers = new Map(options.handlers.map((one) => [one.kind, one]));
  const convergence = new Map(options.convergenceHandlers?.map((one) => [one.parentType, one]));
  if (handlers.size !== options.handlers.length) throw new TypeError("媒体处理器重复登记");
  let closing = false;
  let paused = false;
  const counts = { local: 0, remote: 0 };
  const inFlight = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  const ctx = createIdentityContext({ actor: { type: "system", job: "media_job_run" } });

  async function parentNeeded(tx: Tx, job: MediaJob) {
    const parent = job.parentType ? convergence.get(job.parentType as "store_asset") : undefined;
    return !parent || (await parent.needed(tx, job));
  }
  async function converge(tx: Tx, job: MediaJob) {
    if (job.parentId && job.parentType)
      await convergence
        .get(job.parentType as "store_asset")
        ?.converge(tx, job.parentId, clock.now());
  }
  async function finish(tx: Tx, job: MediaJob, outcome: JobOutcome, handler?: MediaJobHandler) {
    const now = clock.now();
    const retry =
      outcome.state === "failed" &&
      outcome.failure.retryable &&
      outcome.failure.automaticRetry !== false &&
      job.attemptNo < job.maxAttempts &&
      job.deadlineAt > now;
    const state = outcome.state === "pending" ? "submitted" : retry ? "queued" : outcome.state;
    const code =
      outcome.state === "failed" && /^[A-Za-z0-9_]{1,100}$/.test(outcome.failure.code)
        ? outcome.failure.code
        : outcome.state === "failed"
          ? "MEDIA_EXECUTION_FAILED"
          : null;
    const next =
      outcome.state === "submitted" && outcome.nextRunAt
        ? outcome.nextRunAt
        : retry
          ? new Date(now.getTime() + retryDelay(job.attemptNo))
          : job.nextRunAt;
    await tx.mediaJob.update({
      where: { id: job.id },
      data: {
        state,
        nextRunAt: next,
        leaseOwner: null,
        ...(outcome.state === "succeeded"
          ? {
              output:
                outcome.output === null
                  ? Prisma.JsonNull
                  : (outcome.output as Prisma.InputJsonValue),
            }
          : {}),
        ...(outcome.state === "submitted" ? { externalJobId: outcome.externalJobId } : {}),
        finishedAt: terminalStates.includes(state) ? now : null,
        errorCode: code,
        errorMessage: code ? "媒体任务未完成，请依据受控错误码检查" : null,
        isRetryable: outcome.state === "failed" && outcome.failure.retryable,
        updatedAt: now,
      },
    });
    const written = await tx.mediaJob.findUniqueOrThrow({ where: { id: job.id } });
    const wakes = await handler?.finish?.(tx, written, outcome, ctx);
    await converge(tx, written);
    return wakes ?? [];
  }

  async function claim(id: string): Promise<Claim | null> {
    let wakes: readonly string[] = [];
    let canceled: { job: MediaJob; handler: MediaJobHandler } | undefined;
    const result = await transactions.run(async (tx) => {
      const snapshot = await tx.mediaJob.findUnique({ where: { id } });
      if (
        !snapshot ||
        closing ||
        paused ||
        !activeStates.includes(snapshot.state) ||
        snapshot.nextRunAt > clock.now()
      )
        return null;
      await lockJobParent(
        tx,
        snapshot,
        snapshot.parentType ? convergence.get(snapshot.parentType as "store_asset") : undefined,
      );
      assertLockOrder(tx, "media_job", [id]);
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id::text FROM media_job WHERE id=${id}::uuid FOR UPDATE SKIP LOCKED
      `);
      if (!locked.length) return null;
      const job = await tx.mediaJob.findUniqueOrThrow({ where: { id } });
      const now = clock.now();
      if (
        closing ||
        paused ||
        !sameParent(snapshot, job) ||
        !activeStates.includes(job.state) ||
        job.nextRunAt > now
      )
        return null;
      const handler = handlers.get(job.kind as MediaJobKind);
      const budget = jobBudget(job.kind);
      if (
        handler &&
        (handler.mode !== job.mode ||
          (handler.provider && handler.provider !== job.provider) ||
          (handler.claims && !handler.claims(job)))
      )
        return null;
      if (!handler || !budget || !handler.validInput(job.input)) {
        await finish(tx, job, fail("MEDIA_HANDLER_UNSUPPORTED"));
        return null;
      }
      if (!(await handler.current(tx, job))) {
        wakes = await finish(tx, job, { state: "canceled" }, handler);
        canceled = { job, handler };
        return null;
      }
      const parentHandler = job.parentType
        ? convergence.get(job.parentType as "store_asset")
        : undefined;
      if (parentHandler && !(await parentHandler.needed(tx, job))) {
        wakes = await finish(tx, job, { state: "canceled" }, handler);
        canceled = { job, handler };
        return null;
      }
      if (
        job.deadlineAt <= now ||
        (job.state !== "submitted" &&
          job.state !== "submitting" &&
          job.attemptNo >= job.maxAttempts)
      ) {
        wakes = await finish(tx, job, fail("MEDIA_JOB_EXHAUSTED"), handler);
        return null;
      }
      const state =
        job.state === "submitted" ? "submitted" : job.mode === "local" ? "running" : "submitting";
      const attempt =
        job.state === "submitted" || job.state === "submitting" ? job.attemptNo : job.attemptNo + 1;
      const owner = `${options.ownerId}:${uuidv7()}`;
      const claimed = await tx.mediaJob.update({
        where: { id },
        data: {
          state,
          attemptNo: attempt,
          ...(attempt !== job.attemptNo ? { externalJobId: null } : {}),
          leaseOwner: owner,
          nextRunAt: new Date(
            now.getTime() + (state === "submitted" ? MEDIA_POLL_MAX_MS : budget.leaseMs),
          ),
          startedAt: job.startedAt ?? now,
          updatedAt: now,
        },
      });
      return {
        job: claimed,
        beforeState: job.state,
        handler,
        context: await handler.prepare?.(tx, claimed),
        owner,
        previousPoll: Math.max(
          MEDIA_POLL_INITIAL_MS,
          job.nextRunAt.getTime() - job.updatedAt.getTime(),
        ),
      };
    });
    for (const id of wakes) await wake(id);
    if (canceled) await cancelRemote(canceled.job, canceled.handler);
    return result;
  }

  async function cancelRemote(job: MediaJob, handler: MediaJobHandler) {
    if (job.mode !== "remote" || !job.externalJobId || !handler.cancel) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      await handler.cancel(job, controller.signal);
    } catch {
      /* business cancellation remains authoritative */
    } finally {
      clearTimeout(timer);
    }
  }
  async function settle(claimed: Claim, outcome: JobOutcome, aborted: boolean, stopping: boolean) {
    let canceled: MediaJob | undefined;
    const wakes = await transactions.run(async (tx) => {
      await lockJobParent(
        tx,
        claimed.job,
        claimed.job.parentType
          ? convergence.get(claimed.job.parentType as "store_asset")
          : undefined,
      );
      await lockRows(tx, "media_job", [claimed.job.id]);
      const job = await tx.mediaJob.findUniqueOrThrow({ where: { id: claimed.job.id } });
      const now = clock.now();
      if (
        !sameParent(job, claimed.job) ||
        job.state !== claimed.job.state ||
        job.attemptNo !== claimed.job.attemptNo ||
        job.leaseOwner !== claimed.owner ||
        job.externalJobId !== claimed.job.externalJobId ||
        job.nextRunAt <= now
      )
        return [];
      if (!(await parentNeeded(tx, job))) {
        canceled = job;
        return finish(tx, job, { state: "canceled" }, claimed.handler);
      }
      if (stopping && aborted && job.state === "running") {
        await tx.mediaJob.update({
          where: { id: job.id },
          data: {
            state: "queued",
            attemptNo: Math.max(0, job.attemptNo - 1),
            leaseOwner: null,
            nextRunAt: now,
            updatedAt: now,
          },
        });
        return [];
      }
      if (!(await claimed.handler.current(tx, job))) {
        canceled = job;
        return finish(tx, job, { state: "canceled" }, claimed.handler);
      }
      if (job.deadlineAt <= now) outcome = fail("MEDIA_JOB_DEADLINE");
      else if (aborted && job.mode === "local") outcome = fail("MEDIA_JOB_TIMEOUT", true);
      if (outcome.state === "succeeded" && !claimed.handler.validOutput(outcome.output))
        outcome = fail("MEDIA_RESULT_INVALID");
      if (outcome.state === "pending") {
        // An uncertain submission keeps its persisted lease; it must be recovered before any resubmit.
        if (job.state === "submitting") return [];
        await tx.mediaJob.update({
          where: { id: job.id },
          data: {
            leaseOwner: null,
            nextRunAt: new Date(now.getTime() + nextPollDelay(claimed.previousPoll)),
            updatedAt: now,
          },
        });
        return [];
      }
      if (outcome.state === "submitted") {
        if (!/^[A-Za-z0-9_-]{1,256}$/.test(outcome.externalJobId))
          outcome = fail("MEDIA_RESULT_INVALID");
        else
          outcome = {
            ...outcome,
            nextRunAt: outcome.nextRunAt ?? new Date(now.getTime() + MEDIA_POLL_INITIAL_MS),
          };
      }
      return finish(tx, job, outcome, claimed.handler);
    });
    for (const id of wakes) await wake(id);
    if (canceled) await cancelRemote(canceled, claimed.handler);
  }
  async function wake(id: string) {
    await options.channel
      ?.enqueue("media_job", `media-${id}`, { jobId: id })
      .catch(() => undefined);
  }
  async function execute(claimed: Claim, controller: AbortController) {
    const budget = jobBudget(claimed.job.kind)!;
    const timeout = setTimeout(
      () => controller.abort("media_timeout"),
      budget.hardTimeoutMs ?? 90_000,
    );
    try {
      let outcome: JobOutcome;
      try {
        if (controller.signal.aborted) outcome = { state: "pending" };
        else if (claimed.beforeState === "submitting")
          outcome =
            (await claimed.handler.recover?.(claimed.job, controller.signal)) ??
            fail("MEDIA_RECOVERY_UNSUPPORTED");
        else if (claimed.beforeState === "submitted")
          outcome =
            (await claimed.handler.poll?.(claimed.job, controller.signal)) ??
            fail("MEDIA_QUERY_UNSUPPORTED");
        else
          outcome = await claimed.handler.execute(claimed.job, claimed.context, controller.signal);
      } catch {
        outcome =
          claimed.job.state === "submitting"
            ? { state: "pending" }
            : fail("MEDIA_EXECUTION_UNAVAILABLE", true);
      }
      await settle(
        claimed,
        outcome,
        controller.signal.aborted,
        ["media_shutdown", "media_lease_lost"].includes(String(controller.signal.reason)),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  async function start(jobId: string) {
    if (closing || paused || inFlight.has(jobId)) return;
    const row = await transactions.run((tx) =>
      tx.mediaJob.findUnique({ where: { id: jobId }, select: { mode: true } }),
    );
    if (!row) return;
    if (closing || paused || inFlight.has(jobId)) return;
    const mode = row.mode === "remote" ? "remote" : "local";
    if (counts[mode] >= (mode === "local" ? MEDIA_LOCAL_CONCURRENCY : MEDIA_REMOTE_CONCURRENCY))
      return;
    counts[mode]++;
    const controller = new AbortController();
    let claimEnded!: (result: { ok: true } | { ok: false; error: unknown }) => void;
    const claimed = new Promise<{ ok: true } | { ok: false; error: unknown }>((resolve) => {
      claimEnded = resolve;
    });
    const promise = (async () => {
      try {
        let ready: Claim | null;
        try {
          ready = await claim(jobId);
        } catch (error) {
          claimEnded({ ok: false, error });
          throw error;
        }
        claimEnded({ ok: true });
        if (ready) await execute(ready, controller);
      } finally {
        counts[mode]--;
        inFlight.delete(jobId);
      }
    })();
    inFlight.set(jobId, { controller, promise });
    // Scanner-owned completions must never reject unobserved; the database lease remains recovery truth.
    void promise.catch(() => undefined);
    return { claimed, completion: promise };
  }
  async function run({ jobId }: { jobId: string }) {
    const execution = await start(jobId);
    await execution?.completion;
  }
  async function scan(beat?: () => void) {
    if (closing || paused) return 0;
    // 扫描只发现候选；行锁与租约归 claim，避免扫描锁令并发队列认领跳过后又被 owned 去重。
    const due = await transactions.run((tx) =>
      tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id::text FROM media_job
      WHERE state IN ('queued','running','submitting','submitted') AND next_run_at<=${clock.now()}
      ORDER BY next_run_at,id LIMIT ${MEDIA_SCAN_LIMIT}
    `),
    );
    // Await only real short claims: legitimate four-minute IO must not stall the fifteen-second loop.
    await Promise.all(
      due.map(async (one) => {
        await wake(one.id);
        const execution = await start(one.id);
        if (execution) {
          const result = await execution.claimed;
          if (!result.ok) throw result.error;
          beat?.();
        }
      }),
    );
    return due.length;
  }
  async function expire(tx: Tx, id: string, now: Date): Promise<boolean> {
    const snapshot = await tx.mediaJob.findUnique({ where: { id } });
    if (!snapshot || !activeStates.includes(snapshot.state) || snapshot.deadlineAt > now)
      return false;
    await lockJobParent(
      tx,
      snapshot,
      snapshot.parentType ? convergence.get(snapshot.parentType as "store_asset") : undefined,
    );
    await lockRows(tx, "media_job", [id]);
    const job = await tx.mediaJob.findUniqueOrThrow({ where: { id } });
    if (!sameParent(snapshot, job) || !activeStates.includes(job.state) || job.deadlineAt > now)
      return false;
    const handler = handlers.get(job.kind as MediaJobKind);
    const valid =
      handler &&
      handler.mode === job.mode &&
      (!handler.provider || handler.provider === job.provider) &&
      handler.validInput(job.input);
    const current = valid && (await parentNeeded(tx, job)) && (await handler.current(tx, job));
    await finish(
      tx,
      job,
      current
        ? fail("MEDIA_JOB_DEADLINE")
        : valid
          ? { state: "canceled" }
          : fail("MEDIA_HANDLER_UNSUPPORTED"),
      valid ? handler : undefined,
    );
    return true;
  }
  async function pause() {
    paused = true;
    const pending = [...inFlight.values()];
    for (const one of pending) one.controller.abort("media_lease_lost");
    await Promise.allSettled(pending.map((one) => one.promise));
  }
  function resume() {
    if (!closing) paused = false;
  }
  let stopped: Promise<void> | undefined;
  async function shutdown() {
    closing = true;
    return (stopped ??= (async () => {
      const pending = [...inFlight.values()];
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled(pending.map((one) => one.promise)),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, MEDIA_SHUTDOWN_WAIT_MS);
          }),
        ]);
        for (const one of pending) one.controller.abort("media_shutdown");
        // Each registered handler must cancel its IO and release all owned resources before resolving.
        await Promise.allSettled(pending.map((one) => one.promise));
      } finally {
        if (timer) clearTimeout(timer);
      }
    })());
  }
  return { run, scan, shutdown, pause, resume, expire, wake, handlers, convergence };
}
export type MediaJobs = ReturnType<typeof createMediaJobs>;
