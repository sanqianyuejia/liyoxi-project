import type {
  UploadBatchDetail,
  UploadBatchCreateBody,
  UploadBatchItemUpdateBody,
} from "@liyoxi/contract";
import { maxUploadBytes } from "@liyoxi/shared/uploads";
import { newIdempotencyKey } from "../../../lib/idempotency";
import { validateUploadFile } from "../../../lib/upload";
import type { BatchApi } from "./batch-api";

export type BatchSelection = { file: File; clientToken: string };
export type BatchSnapshot = {
  batch?: UploadBatchDetail;
  pending: boolean;
  error?: string;
  pollingPaused: boolean;
};
export const batchStateLabel = (state: string): string =>
  ({
    matching: "核对集号",
    uploading: "上传中",
    verifying: "体检中",
    ready: "可登记",
    committed: "已登记",
    canceled: "已取消",
    expired: "已过期",
  })[state] ?? "当前状态暂不可操作";
export const itemStateLabel = (state: string): string =>
  ({
    pending: "待上传",
    uploaded: "已上传，等待体检",
    checked: "体检通过",
    rejected: "文件被拒收",
    skipped: "已跳过",
    replaced: "已替换",
  })[state] ?? "未知状态";
export function selectionProblem(
  files: readonly File[],
  purpose: "final_release" | "drama_master" = "final_release",
): string | null {
  if (!files.length) return purpose === "drama_master" ? "请选择原片文件" : "请选择成片文件";
  if (new Set(files.map((file) => file.name)).size !== files.length)
    return "文件名重复，请重新选择";
  const rule = {
    accept: [".mp4", ".mov"],
    maxSizeMb:
      Number(
        maxUploadBytes(
          purpose === "drama_master" ? "drama_master" : "final_episode",
          "mp4",
          "admin",
        ),
      ) /
      1024 /
      1024,
  };
  for (const file of files) {
    const problem = validateUploadFile(file, rule);
    if (problem) return `${file.name}：${problem}`;
  }
  return null;
}
export function selectableItem(batch: UploadBatchDetail, file: File) {
  const matches = batch.items.filter(
    (item) =>
      item.state !== "skipped" &&
      item.state !== "replaced" &&
      item.originalName === file.name &&
      item.sizeBytes === String(file.size),
  );
  if (matches.length !== 1) throw new Error("请选择名称和大小均一致的原始文件；其他文件请使用替换");
  return matches[0]!;
}
export function canStart(batch: UploadBatchDetail, acceptSequence: boolean): boolean {
  return (
    batch.state === "matching" &&
    batch.actions.includes("start") &&
    !batch.coverage.duplicateEpisodeNos.length &&
    !batch.coverage.unmatchedItemIds.length &&
    (batch.scope !== "full" || !batch.coverage.missingEpisodeNos.length) &&
    (!batch.coverage.needsSequenceConfirm || acceptSequence)
  );
}
export function canConsume(batch: UploadBatchDetail): boolean {
  return (
    batch.purpose === "final_release" &&
    batch.state === "ready" &&
    !batch.coverage.duplicateEpisodeNos.length &&
    !batch.coverage.unmatchedItemIds.length &&
    (batch.scope !== "full" || !batch.coverage.missingEpisodeNos.length)
  );
}

/** One modal owns one batch; late reads and closed scopes cannot replace current facts. */
export function createBatchModel(options: {
  api: BatchApi;
  targetId: string;
  purpose?: "final_release" | "drama_master";
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  unschedule?: (id: ReturnType<typeof setTimeout>) => void;
  maxPolls?: number;
}) {
  let snapshot: BatchSnapshot = { pending: false, pollingPaused: false };
  const listeners = new Set<() => void>();
  const lifetime = new AbortController();
  const intents = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false,
    readEpoch = 0,
    polls = 0;
  const schedule = options.schedule ?? setTimeout;
  const unschedule = options.unschedule ?? clearTimeout;
  const publish = (patch: Partial<BatchSnapshot>) => {
    if (closed) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const stopTimer = () => {
    if (timer !== undefined) unschedule(timer);
    timer = undefined;
  };
  const accept = (batch: UploadBatchDetail) => {
    if (
      batch.purpose !== (options.purpose ?? "final_release") ||
      batch.targetId !== options.targetId
    )
      throw new Error("批次不属于当前工单，请重新进入");
    publish({ batch, error: undefined, pollingPaused: false });
    stopTimer();
    if (batch.state === "uploading" || batch.state === "verifying") {
      if (polls >= (options.maxPolls ?? 1800)) {
        publish({ pollingPaused: true });
      } else {
        timer = schedule(() => {
          timer = undefined;
          void refresh();
        }, 2000);
      }
    }
  };
  const fail = (error: unknown) => {
    if (!closed && !lifetime.signal.aborted) {
      stopTimer();
      publish({
        error: error instanceof Error ? error.message : "读取批次失败，请重试",
        pollingPaused: true,
      });
    }
  };
  async function refresh() {
    const batch = snapshot.batch;
    if (closed || !batch) return;
    const mine = ++readEpoch;
    polls++;
    try {
      const current = await options.api.get(batch.uploadBatchId, lifetime.signal);
      if (!closed && mine === readEpoch) accept(current);
    } catch (error) {
      if (mine === readEpoch) fail(error);
    }
  }
  async function write(
    action: string,
    body: unknown,
    send: (key: string, signal: AbortSignal) => Promise<UploadBatchDetail>,
  ) {
    if (closed || snapshot.pending) return undefined;
    const intent = JSON.stringify([action, body]);
    const key = intents.get(intent) ?? newIdempotencyKey("uploadbatch");
    intents.set(intent, key);
    readEpoch++;
    stopTimer();
    publish({ pending: true, error: undefined });
    try {
      const batch = await send(key, lifetime.signal);
      if (closed) return undefined;
      readEpoch++;
      accept(batch);
      intents.delete(intent);
      return batch;
    } catch (error) {
      fail(error);
      return undefined;
    } finally {
      publish({ pending: false });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    create(body: UploadBatchCreateBody) {
      return write("create", body, (key, signal) => options.api.create(body, key, signal));
    },
    async open(id: string) {
      if (closed || snapshot.pending) return;
      const mine = ++readEpoch;
      stopTimer();
      publish({ pending: true, error: undefined });
      try {
        const batch = await options.api.get(id, lifetime.signal);
        if (mine === readEpoch && !closed) {
          polls = 0;
          accept(batch);
        }
      } catch (error) {
        if (mine === readEpoch) fail(error);
      } finally {
        if (mine === readEpoch) publish({ pending: false });
      }
    },
    start(acceptSequence: boolean) {
      const batch = snapshot.batch;
      if (!batch || !canStart(batch, acceptSequence)) return Promise.resolve(undefined);
      return write("start", [batch.uploadBatchId, acceptSequence], (key, signal) =>
        options.api.start(batch.uploadBatchId, acceptSequence, key, signal),
      );
    },
    update(id: string, body: UploadBatchItemUpdateBody) {
      return write("update", [id, body], (key, signal) =>
        options.api.update(id, body, key, signal),
      );
    },
    cancel() {
      const batch = snapshot.batch;
      if (
        !batch ||
        !["matching", "ready"].includes(batch.state) ||
        !batch.actions.includes("cancel")
      )
        return Promise.resolve(undefined);
      return write("cancel", batch.uploadBatchId, (key, signal) =>
        options.api.cancel(batch.uploadBatchId, key, signal),
      );
    },
    refresh() {
      polls = 0;
      publish({ pollingPaused: false, error: undefined });
      return refresh();
    },
    close() {
      closed = true;
      readEpoch++;
      stopTimer();
      lifetime.abort();
      listeners.clear();
    },
  };
}
export type BatchModel = ReturnType<typeof createBatchModel>;
