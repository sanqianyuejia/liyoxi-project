import { describe, expect, it, vi } from "vitest";
import { createBannerImageRetry, type BannerImageDownloadResult } from "./banner-image-retry";

const source =
  "http://192.0.2.10:9110/lyx-local-pub/banner.png?X-Amz-Signature=fake%2Bsignature&response-content-disposition=inline";
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function deferred() {
  let resolve!: (value: BannerImageDownloadResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<BannerImageDownloadResult>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject, abort: vi.fn() };
}
function harness() {
  const tasks: ReturnType<typeof deferred>[] = [];
  const download = vi.fn((_source: string) => {
    const task = deferred();
    tasks.push(task);
    return task;
  });
  const onReady = vi.fn();
  const onResult = vi.fn();
  const retry = createBannerImageRetry({ source, download, onReady, onResult });
  return { retry, download, onReady, onResult, tasks };
}

describe("Banner 图片失败后的临时文件恢复", () => {
  it("激活前和仅正常显示时不下载；重复激活不重置已尝试状态", async () => {
    const h = harness();
    h.retry.retry();
    expect(h.download).not.toHaveBeenCalled();
    h.retry.activate();
    expect(h.download).not.toHaveBeenCalled();
    h.retry.retry();
    h.retry.activate();
    h.retry.retry();
    expect(h.download).toHaveBeenCalledTimes(1);
    h.tasks[0]!.resolve({ statusCode: 200, tempFilePath: "wxfile://tmp/banner.png" });
    await flush();
    h.retry.retry();
    expect(h.download).toHaveBeenCalledTimes(1);
  });

  it("签名地址原样下载，只有200与有效临时路径才替换图片", async () => {
    const h = harness();
    h.retry.activate();
    h.retry.retry();
    expect(h.download).toHaveBeenCalledWith(source);
    expect(h.onReady).not.toHaveBeenCalled();
    h.tasks[0]!.resolve({ statusCode: 200, tempFilePath: "wxfile://tmp/banner.png" });
    await flush();
    expect(h.onReady).toHaveBeenCalledExactlyOnceWith("wxfile://tmp/banner.png");
    expect(h.onResult).toHaveBeenCalledExactlyOnceWith({ statusCode: 200 });
    h.retry.dispose();
    expect(h.tasks[0]!.abort).not.toHaveBeenCalled();
  });

  it.each([
    { statusCode: 404, tempFilePath: "wxfile://tmp/not-found.xml" },
    { statusCode: 403, tempFilePath: "wxfile://tmp/forbidden.xml" },
    { statusCode: 200 },
    { statusCode: 200, tempFilePath: "" },
    { statusCode: 200, tempFilePath: "  " },
  ])("拒绝非200或空路径回包且不自动循环：%j", async (result) => {
    const h = harness();
    h.retry.activate();
    h.retry.retry();
    h.tasks[0]!.resolve(result);
    await flush();
    expect(h.onReady).not.toHaveBeenCalled();
    expect(h.onResult).toHaveBeenCalledExactlyOnceWith({ statusCode: result.statusCode });
    h.retry.retry();
    expect(h.download).toHaveBeenCalledTimes(1);
  });

  it("同步下载异常只报告一次，不重试、不向外抛出", () => {
    const h = harness();
    const error = new Error("native download unavailable");
    h.download.mockImplementationOnce(() => {
      throw error;
    });
    h.retry.activate();
    expect(() => h.retry.retry()).not.toThrow();
    h.retry.retry();
    expect(h.onResult).toHaveBeenCalledExactlyOnceWith({ error });
    expect(h.onReady).not.toHaveBeenCalled();
    expect(h.download).toHaveBeenCalledTimes(1);
  });

  it("只传递当前下载的存储响应详情，重新激活前的迟到详情不回报", async () => {
    const h = harness();
    const staleDetails = { storageError: "NoSuchKey", server: "stale-server" };
    const currentDetails = {
      storageError: "AccessDenied",
      server: "MinIO",
      contentType: "application/xml",
    };
    h.retry.activate();
    h.retry.retry();
    h.retry.dispose();
    h.retry.activate();
    h.retry.retry();
    h.tasks[0]!.resolve({ statusCode: 404, details: staleDetails });
    await flush();
    expect(h.onResult).not.toHaveBeenCalled();
    h.tasks[1]!.resolve({ statusCode: 403, details: currentDetails });
    await flush();
    expect(h.onResult).toHaveBeenCalledExactlyOnceWith({
      statusCode: 403,
      details: currentDetails,
    });
    expect(h.onReady).not.toHaveBeenCalled();
  });

  it("异步失败被接住，重复图片error不产生第二次下载", async () => {
    const h = harness();
    const error = new Error("downloadFile:fail timeout");
    h.retry.activate();
    h.retry.retry();
    h.retry.retry();
    h.tasks[0]!.reject(error);
    await flush();
    h.retry.retry();
    expect(h.download).toHaveBeenCalledTimes(1);
    expect(h.onResult).toHaveBeenCalledExactlyOnceWith({ error });
    expect(h.onReady).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "卸载先失效并取消，旧下载迟到%s不再更新图片或日志",
    async (settle) => {
      const h = harness();
      h.retry.activate();
      h.retry.retry();
      h.retry.dispose();
      h.retry.dispose();
      h.retry.retry();
      if (settle === "resolve")
        h.tasks[0]!.resolve({ statusCode: 200, tempFilePath: "wxfile://tmp/stale.png" });
      else h.tasks[0]!.reject(new Error("late abort"));
      await flush();
      expect(h.tasks[0]!.abort).toHaveBeenCalledOnce();
      expect(h.onReady).not.toHaveBeenCalled();
      expect(h.onResult).not.toHaveBeenCalled();
      expect(h.download).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "严格模式重新激活后，旧代次%s不会穿透到新图片",
    async (settle) => {
      const h = harness();
      h.retry.activate();
      h.retry.retry();
      h.retry.dispose();
      h.retry.activate();
      h.retry.retry();
      if (settle === "resolve")
        h.tasks[0]!.resolve({ statusCode: 200, tempFilePath: "wxfile://tmp/stale.png" });
      else h.tasks[0]!.reject(new Error("stale failure"));
      await flush();
      expect(h.onReady).not.toHaveBeenCalled();
      expect(h.onResult).not.toHaveBeenCalled();
      h.tasks[1]!.resolve({ statusCode: 200, tempFilePath: "wxfile://tmp/current.png" });
      await flush();
      expect(h.onReady).toHaveBeenCalledExactlyOnceWith("wxfile://tmp/current.png");
      expect(h.onResult).toHaveBeenCalledExactlyOnceWith({ statusCode: 200 });
      expect(h.download).toHaveBeenCalledTimes(2);
    },
  );

  it("取消抛错不阻断卸载或下一次激活，也不允许旧结果穿透", async () => {
    const h = harness();
    h.retry.activate();
    h.retry.retry();
    h.tasks[0]!.abort.mockImplementation(() => {
      throw new Error("native abort unavailable");
    });
    expect(() => h.retry.dispose()).not.toThrow();
    h.retry.activate();
    h.retry.retry();
    h.tasks[0]!.resolve({ statusCode: 200, tempFilePath: "wxfile://tmp/stale.png" });
    h.tasks[1]!.resolve({ statusCode: 200, tempFilePath: "wxfile://tmp/current.png" });
    await flush();
    expect(h.onReady).toHaveBeenCalledExactlyOnceWith("wxfile://tmp/current.png");
    expect(h.onResult).toHaveBeenCalledOnce();
  });

  it("结果日志抛错不阻断有效图片，图片回调抛错不产生未处理拒绝", async () => {
    const h = harness();
    h.onResult.mockImplementation(() => {
      throw new Error("logger unavailable");
    });
    h.onReady.mockImplementation(() => {
      throw new Error("consumer unavailable");
    });
    h.retry.activate();
    h.retry.retry();
    h.tasks[0]!.resolve({ statusCode: 200, tempFilePath: "wxfile://tmp/banner.png" });
    await flush();
    expect(h.onReady).toHaveBeenCalledExactlyOnceWith("wxfile://tmp/banner.png");
    h.retry.retry();
    expect(h.download).toHaveBeenCalledTimes(1);
  });
});
