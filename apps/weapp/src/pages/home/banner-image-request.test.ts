import { describe, expect, it, vi } from "vitest";
import { createBannerImageRequester, type BannerImageRequestResult } from "./banner-image-request";

const source =
  "http://192.0.2.10:9110/lyx-local-pub/banner.png?X-Amz-Signature=fake%2Bsignature&response-content-disposition=inline";
const bytes = (text: string) =>
  Uint8Array.from(text, (character) => character.charCodeAt(0)).buffer;
const image = bytes("image bytes");
const response = (data = image): BannerImageRequestResult => ({ statusCode: 200, data });
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function deferred() {
  let resolve!: (value: BannerImageRequestResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<BannerImageRequestResult>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject, abort: vi.fn() };
}
function harness() {
  const tasks: ReturnType<typeof deferred>[] = [];
  const request = vi.fn((_source: string) => {
    const task = deferred();
    tasks.push(task);
    return task;
  });
  const write = vi.fn((_bytes: ArrayBuffer, _contentType?: string) => {
    return `wxfile://tmp/banner-${write.mock.calls.length}.png`;
  });
  const remove = vi.fn();
  const requester = createBannerImageRequester({ request, write, remove });
  return { requester, request, write, remove, tasks };
}

describe("Banner request 临时图片边界", () => {
  it("完整签名URL原样请求，200二进制写文件并返回存储响应详情", async () => {
    const h = harness();
    const task = h.requester.download(source);
    expect(h.request).toHaveBeenCalledExactlyOnceWith(source);
    expect(h.write).not.toHaveBeenCalled();
    h.tasks[0]!.resolve({ ...response(), server: "MinIO", contentType: "image/png" });
    await expect(task.promise).resolves.toEqual({
      statusCode: 200,
      tempFilePath: "wxfile://tmp/banner-1.png",
      details: { server: "MinIO", contentType: "image/png" },
    });
    expect(h.write).toHaveBeenCalledExactlyOnceWith(image, "image/png");
    task.abort();
    expect(h.tasks[0]!.abort).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
    h.requester.dispose();
    expect(h.remove).toHaveBeenCalledExactlyOnceWith("wxfile://tmp/banner-1.png");
  });

  it.each([403, 404, 500])("非200响应%s不写文件，仅解析受限XML Code", async (statusCode) => {
    const h = harness();
    const task = h.requester.download(source);
    h.tasks[0]!.resolve({
      statusCode,
      data: bytes("<Error><Code>NoSuchKey</Code><RequestId>secret-body</RequestId></Error>"),
      server: "MinIO",
      contentType: "application/xml",
    });
    const result = await task.promise;
    expect(result).toEqual({
      statusCode,
      details: { server: "MinIO", contentType: "application/xml", storageError: "NoSuchKey" },
    });
    expect(JSON.stringify(result)).not.toContain("secret-body");
    expect(h.write).not.toHaveBeenCalled();
    h.requester.dispose();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("不解析超出读取上限的Code，也不将非法Code或正文暴露到结果", async () => {
    const h = harness();
    const late = h.requester.download(source);
    h.tasks[0]!.resolve({
      statusCode: 404,
      data: bytes(`${" ".repeat(4096)}<Code>NoSuchKey</Code>`),
    });
    await expect(late.promise).resolves.toEqual({ statusCode: 404 });
    const invalid = h.requester.download(source);
    h.tasks[1]!.resolve({
      statusCode: 404,
      data: bytes("<Code>secret/path?signature=fake</Code>"),
    });
    await expect(invalid.promise).resolves.toEqual({ statusCode: 404 });
    expect(h.write).not.toHaveBeenCalled();
  });

  it.each([
    ["空ArrayBuffer", new ArrayBuffer(0)],
    ["文本", "not an image"],
    ["TypedArray", new Uint8Array([1, 2, 3])],
  ])("200响应含%s时拒绝、不写文件", async (_label, data) => {
    const h = harness();
    const task = h.requester.download(source);
    const rejected = expect(task.promise).rejects.toThrow("no binary data");
    h.tasks[0]!.resolve(response(data as ArrayBuffer));
    await rejected;
    expect(h.write).not.toHaveBeenCalled();
    h.requester.dispose();
    expect(h.tasks[0]!.abort).not.toHaveBeenCalled();
  });

  it("同步request异常变成外层Promise拒绝，不留下活动任务", async () => {
    const h = harness();
    const error = new Error("request unavailable");
    h.request.mockImplementationOnce(() => {
      throw error;
    });
    const task = h.requester.download(source);
    await expect(task.promise).rejects.toBe(error);
    h.requester.dispose();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("异步request拒绝向调用方传递，并释放活动任务", async () => {
    const h = harness();
    const task = h.requester.download(source);
    const error = new Error("request:fail timeout");
    const rejected = expect(task.promise).rejects.toBe(error);
    h.tasks[0]!.reject(error);
    await rejected;
    h.requester.dispose();
    expect(h.tasks[0]!.abort).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
  });

  it("write异常向调用方传递，不记录未创建的文件", async () => {
    const h = harness();
    const error = new Error("disk unavailable");
    h.write.mockImplementationOnce(() => {
      throw error;
    });
    const task = h.requester.download(source);
    const rejected = expect(task.promise).rejects.toBe(error);
    h.tasks[0]!.resolve(response());
    await rejected;
    h.requester.dispose();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("write返回空白路径时拒绝，不提供无效本地图片", async () => {
    const h = harness();
    h.write.mockReturnValueOnce("  ");
    const task = h.requester.download(source);
    const rejected = expect(task.promise).rejects.toThrow("no file path");
    h.tasks[0]!.resolve(response());
    await rejected;
    h.requester.dispose();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "task.abort先失效并只取消一次，迟到%s不写文件",
    async (settle) => {
      const h = harness();
      const task = h.requester.download(source);
      const rejected = expect(task.promise).rejects.toThrow("aborted");
      task.abort();
      task.abort();
      await rejected;
      if (settle === "resolve") h.tasks[0]!.resolve(response());
      else h.tasks[0]!.reject(new Error("late native error"));
      await flush();
      expect(h.tasks[0]!.abort).toHaveBeenCalledOnce();
      expect(h.write).not.toHaveBeenCalled();
    },
  );

  it("底层abort抛错也不阻断取消和迟到成功隔离", async () => {
    const h = harness();
    const task = h.requester.download(source);
    const rejected = expect(task.promise).rejects.toThrow("aborted");
    h.tasks[0]!.abort.mockImplementation(() => {
      throw new Error("native abort unavailable");
    });
    expect(() => task.abort()).not.toThrow();
    await rejected;
    h.tasks[0]!.resolve(response());
    await flush();
    expect(h.write).not.toHaveBeenCalled();
  });

  it("dispose取消所有活动任务并删除完成文件，重复调用安全", async () => {
    const h = harness();
    const completed = h.requester.download(source);
    h.tasks[0]!.resolve(response());
    await completed.promise;
    const first = h.requester.download(source);
    const second = h.requester.download(source);
    const firstRejected = expect(first.promise).rejects.toThrow("aborted");
    const secondRejected = expect(second.promise).rejects.toThrow("aborted");
    h.requester.dispose();
    h.requester.dispose();
    await Promise.all([firstRejected, secondRejected]);
    expect(h.tasks[0]!.abort).not.toHaveBeenCalled();
    expect(h.tasks[1]!.abort).toHaveBeenCalledOnce();
    expect(h.tasks[2]!.abort).toHaveBeenCalledOnce();
    expect(h.remove).toHaveBeenCalledExactlyOnceWith("wxfile://tmp/banner-1.png");
    h.tasks[1]!.resolve(response());
    h.tasks[2]!.resolve(response());
    await flush();
    expect(h.write).toHaveBeenCalledOnce();
    await expect(h.requester.download(source).promise).rejects.toThrow("inactive");
    expect(h.request).toHaveBeenCalledTimes(3);
  });

  it("重新activate允许新请求，旧代次成功和失败不会穿透", async () => {
    const h = harness();
    const oldFirst = h.requester.download(source);
    const oldSecond = h.requester.download(source);
    const firstRejected = expect(oldFirst.promise).rejects.toThrow("aborted");
    const secondRejected = expect(oldSecond.promise).rejects.toThrow("aborted");
    h.requester.dispose();
    h.requester.activate();
    h.requester.activate();
    const current = h.requester.download(source);
    await Promise.all([firstRejected, secondRejected]);
    h.tasks[0]!.resolve(response());
    h.tasks[1]!.reject(new Error("stale error"));
    await flush();
    expect(h.write).not.toHaveBeenCalled();
    h.tasks[2]!.resolve(response());
    await expect(current.promise).resolves.toEqual({
      statusCode: 200,
      tempFilePath: "wxfile://tmp/banner-1.png",
    });
    h.requester.dispose();
    expect(h.remove).toHaveBeenCalledExactlyOnceWith("wxfile://tmp/banner-1.png");
  });

  it("某文件清理异常不影响其他文件清理", async () => {
    const h = harness();
    const first = h.requester.download(source);
    const second = h.requester.download(source);
    h.tasks[0]!.resolve(response());
    h.tasks[1]!.resolve(response());
    await Promise.all([first.promise, second.promise]);
    h.remove.mockImplementationOnce(() => {
      throw new Error("file already removed");
    });
    expect(() => h.requester.dispose()).not.toThrow();
    expect(h.remove.mock.calls).toEqual([
      ["wxfile://tmp/banner-1.png"],
      ["wxfile://tmp/banner-2.png"],
    ]);
    h.requester.dispose();
    expect(h.remove).toHaveBeenCalledTimes(2);
  });

  it("write期间卸载，刚写出的文件立即清理且不回报图片路径", async () => {
    const h = harness();
    h.write.mockImplementationOnce(() => {
      h.requester.dispose();
      return "wxfile://tmp/disposed.png";
    });
    const task = h.requester.download(source);
    const rejected = expect(task.promise).rejects.toThrow("aborted");
    h.tasks[0]!.resolve(response());
    await rejected;
    expect(h.remove).toHaveBeenCalledExactlyOnceWith("wxfile://tmp/disposed.png");
    h.requester.dispose();
    expect(h.remove).toHaveBeenCalledOnce();
  });
});
