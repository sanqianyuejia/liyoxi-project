import { afterEach, expect, it, vi } from "vitest";
import { createProductionUpload } from "./upload";
import type { DetailApi } from "./api";
const registration: Awaited<ReturnType<DetailApi["file"]>> = {
  fileId: "file",
  mode: "post",
  status: "pending",
  bucket: "media",
  key: "incoming/file",
  region: "us-east-1",
  clientToken: "test",
  credentialsLeft: 30,
  expiresAt: "2099-10-01T00:00:00Z",
  uploadExpiresAt: "2099-10-01T00:00:00Z",
  sts: null,
  chunkSize: null,
  chunkParallel: null,
  post: {
    url: "http://storage.test/bucket",
    fields: { policy: "signed-policy", key: "incoming/file" },
  },
};
class Xhr {
  static calls: Xhr[] = [];
  upload: {
    onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;
  } = {};
  status = 204;
  withCredentials = true;
  body?: FormData;
  url?: string;
  method?: string;
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  ontimeout?: () => void;
  timeout = 0;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
    Xhr.calls.push(this);
  }
  abort() {
    this.onabort?.();
  }
}
function setup() {
  Xhr.calls = [];
  vi.stubGlobal("XMLHttpRequest", Xhr);
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  const api = {
    file: vi.fn().mockResolvedValue(registration),
    refreshCredentials: vi.fn().mockResolvedValue(registration),
    complete: vi.fn().mockResolvedValue({ status: "stored" }),
    fileStatus: vi.fn().mockResolvedValue({ status: "stored" }),
  };
  const adapter = createProductionUpload(
    api as unknown as Pick<DetailApi, "file" | "complete" | "fileStatus" | "refreshCredentials">,
    {
      category: "sample_video",
      storeId: "store",
      production: {
        kind: "sample",
        orderItemId: "item",
        episodeNo: 1,
        aiUsage: { used: false, tools: [] },
      },
    },
  );
  return { api, adapter, file: new File(["content"], "sample.mp4", { type: "video/mp4" }) };
}
afterEach(() => vi.unstubAllGlobals());
it("独立签名表单直传，真实 stored 后才返回 fileId", async () => {
  const { api, adapter, file } = setup(),
    progress = vi.fn();
  const pending = adapter.upload(file, { onProgress: progress });
  await vi.waitFor(() => expect(Xhr.calls).toHaveLength(1));
  const xhr = Xhr.calls[0]!;
  expect([xhr.method, xhr.url, xhr.withCredentials]).toEqual([
    "POST",
    registration.post!.url,
    false,
  ]);
  expect([...xhr.body!.keys()]).toEqual(["policy", "key", "file"]);
  expect(xhr.body!.get("file")).toBeInstanceOf(File);
  expect(api.complete).not.toHaveBeenCalled();
  xhr.onload?.();
  await expect(pending).resolves.toEqual({ fileId: "file" });
  expect(api.complete).toHaveBeenCalledTimes(1);
  expect(progress).toHaveBeenLastCalledWith(100);
  adapter.dispose();
});
it("网络失败重试同一 File 保持 clientToken 与 complete 意图", async () => {
  const { api, adapter, file } = setup();
  const first = adapter.upload(file, { onProgress: vi.fn() });
  const failed = expect(first).rejects.toThrow("网络失败");
  await vi.waitFor(() => expect(Xhr.calls).toHaveLength(1));
  Xhr.calls[0]!.onerror?.();
  await failed;
  const second = adapter.upload(file, { onProgress: vi.fn() });
  await vi.waitFor(() => expect(Xhr.calls).toHaveLength(2));
  Xhr.calls[1]!.onload?.();
  await second;
  expect(api.file).toHaveBeenCalledTimes(1);
  expect(api.file.mock.calls[0]![0].clientToken).toMatch(/^[a-f0-9-]{36}$/);
  adapter.dispose();
});
it("关闭上传取消 XHR；晚到登记响应不继续直传或 complete", async () => {
  const { api, adapter, file } = setup();
  let release!: (value: typeof registration) => void;
  api.file.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = adapter.upload(file, { onProgress: vi.fn() }),
    rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  adapter.dispose();
  release(registration);
  await rejected;
  expect(Xhr.calls).toHaveLength(0);
  expect(api.complete).not.toHaveBeenCalled();
});
it("直传中关闭取消网络且不 complete、不报告成功", async () => {
  const { api, adapter, file } = setup(),
    progress = vi.fn();
  const pending = adapter.upload(file, { onProgress: progress }),
    rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(Xhr.calls).toHaveLength(1));
  adapter.dispose();
  await rejected;
  expect(api.complete).not.toHaveBeenCalled();
  expect(progress).not.toHaveBeenCalledWith(100);
});

it("直传超时拒绝且不确认入库，重试仍可成功", async () => {
  const { api, adapter, file } = setup();
  const first = adapter.upload(file, { onProgress: vi.fn() });
  const failed = expect(first).rejects.toThrow("直传超时");
  await vi.waitFor(() => expect(Xhr.calls).toHaveLength(1));
  expect(Xhr.calls[0]!.timeout).toBe(120_000);
  Xhr.calls[0]!.ontimeout?.();
  Xhr.calls[0]!.onload?.();
  await failed;
  expect(api.complete).not.toHaveBeenCalled();
  const retry = adapter.upload(file, { onProgress: vi.fn() });
  await vi.waitFor(() => expect(Xhr.calls).toHaveLength(2));
  Xhr.calls[1]!.onload?.();
  await expect(retry).resolves.toEqual({ fileId: "file" });
  adapter.dispose();
});
it("失败后凭证过期，续签同一 fileId 再直传，不重新登记", async () => {
  const { api, adapter, file } = setup();
  const expiring = { ...registration, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  api.file.mockResolvedValue(expiring);
  const first = adapter.upload(file, { onProgress: vi.fn() });
  const failed = expect(first).rejects.toThrow("网络失败");
  await vi.waitFor(() => expect(Xhr.calls).toHaveLength(1));
  Xhr.calls[0]!.onerror?.();
  await failed;
  expiring.expiresAt = "2000-01-01T00:00:00Z";
  api.refreshCredentials.mockResolvedValue({
    ...registration,
    post: { ...registration.post!, url: "https://storage.test/renewed" },
  });
  const retry = adapter.upload(file, { onProgress: vi.fn() });
  await vi.waitFor(() => expect(Xhr.calls).toHaveLength(2));
  expect(api.refreshCredentials).toHaveBeenCalledWith("file", expect.any(AbortSignal));
  expect(api.file).toHaveBeenCalledTimes(1);
  expect(Xhr.calls[1]!.url).toBe("https://storage.test/renewed");
  Xhr.calls[1]!.onload?.();
  await retry;
  adapter.dispose();
});
it("上传窗口过期不再直传或续签", async () => {
  const { api, adapter, file } = setup();
  api.file.mockResolvedValue({ ...registration, uploadExpiresAt: "2000-01-01T00:00:00Z" });
  await expect(adapter.upload(file, { onProgress: vi.fn() })).rejects.toThrow("重新选择文件");
  expect(Xhr.calls).toHaveLength(0);
  expect(api.refreshCredentials).not.toHaveBeenCalled();
  adapter.dispose();
});
