import { expect, it, vi } from "vitest";
import type { BatchApi } from "../../delivery/ticket-detail/batch-api";
import {
  createBatchModel,
  canConsume,
  selectionProblem,
} from "../../delivery/ticket-detail/batch-model";
import {
  batchCredentials,
  batchFixture,
  batchId,
} from "../../delivery/ticket-detail/batch-test.fixture";
import { createBatchSession } from "../../delivery/ticket-detail/batch-upload";
function apiFixture(): BatchApi {
  return {
    create: vi.fn(async () => batchFixture({ purpose: "drama_master" })),
    get: vi.fn(async () => batchFixture({ purpose: "drama_master" })),
    start: vi.fn(async () => batchFixture({ purpose: "drama_master", state: "uploading" })),
    refresh: vi.fn(async () => batchCredentials()),
    update: vi.fn(async () => batchFixture({ purpose: "drama_master" })),
    complete: vi.fn(async () => batchFixture().items[0]!),
    cancel: vi.fn(async () => batchFixture({ purpose: "drama_master", state: "canceled" })),
    commit: vi.fn(async () => ({ batch: batchFixture({ purpose: "drama_master" }), masters: [] })),
  };
}
it("原片模型只接收当前剧目原片批次，不能混用成片批次或其他剧目", async () => {
  const api = apiFixture();
  const model = createBatchModel({ api, targetId: batchId(2), purpose: "drama_master" });
  await model.open(batchId(1));
  expect(model.getSnapshot().batch?.purpose).toBe("drama_master");
  vi.mocked(api.get).mockResolvedValueOnce(batchFixture());
  await model.open(batchId(3));
  expect(model.getSnapshot().error).toContain("不属于当前");
  expect(model.getSnapshot().batch?.purpose).toBe("drama_master");
  vi.mocked(api.get).mockResolvedValueOnce(
    batchFixture({ purpose: "drama_master", targetId: batchId(4) }),
  );
  await model.open(batchId(5));
  expect(model.getSnapshot().batch?.targetId).toBe(batchId(2));
  expect(canConsume(batchFixture({ purpose: "drama_master", state: "ready" }))).toBe(false);
  model.close();
});
it("原片采用正式500MB边界，成片原200MB边界保持且ZIP仍拒绝", () => {
  const file = new File(["x"], "第1集.mp4");
  Object.defineProperty(file, "size", { value: 201 * 1024 * 1024 });
  expect(selectionProblem([file], "drama_master")).toBeNull();
  expect(selectionProblem([file])).toBe("第1集.mp4：文件超过 200MB，请压缩后重新上传");
  expect(selectionProblem([new File(["x"], "原片.zip")], "drama_master")).toContain("类型不支持");
});
it("原片会话开发重装建立新ownedruntime，旧scope关闭不复用旧上传器", async () => {
  const api = apiFixture();
  const session = createBatchSession({
    api,
    purpose: "drama_master",
    targetId: batchId(2),
    fileStatus: async (fileId) => ({ fileId, status: "stored" }),
  });
  const unsubscribe = session.subscribe(() => undefined);
  const first = session.getSnapshot().runtime;
  expect(first).toBeDefined();
  await first?.model.open(batchId(1));
  unsubscribe();
  expect(session.getSnapshot().runtime).toBeUndefined();
  const release = session.subscribe(() => undefined);
  expect(session.getSnapshot().runtime).not.toBe(first);
  await session.getSnapshot().runtime?.model.open(batchId(1));
  expect(session.getSnapshot().snapshot.batch?.purpose).toBe("drama_master");
  release();
});
