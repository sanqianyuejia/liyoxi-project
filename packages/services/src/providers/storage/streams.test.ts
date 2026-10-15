import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withBeforeCall } from "../types.js";
import { createCosStorage } from "./cos.js";
import type { CosConfig } from "./cos.js";
import { checkedStream } from "./streams.js";

const bytes = new TextEncoder().encode("small actual stream"),
  size = bytes.length;
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const sha = hash(bytes),
  identity = "1".repeat(64),
  etag = '"public-test-etag"';
const config: CosConfig = {
  region: "ap-beijing",
  buckets: {
    secure: "stream-secure-1250000000",
    asset: "stream-asset-1250000000",
    media: "stream-media-1250000000",
    pub: "stream-pub-1250000000",
  },
  worker: { secretId: "publicfakeid", secretKey: "publicfakekey" },
};
const ref = { bucket: "media" as const, key: "derived/test/output.mp4" };
const owned: Array<ReturnType<typeof createCosStorage>> = [];
afterEach(async () => {
  await Promise.all(owned.splice(0).map((one) => one.close()));
});
function fixture(
  overrides: {
    headSize?: number;
    etag?: string;
    getSize?: number;
    status?: number;
    versioning?: string;
    existing?: boolean;
    targetHash?: string;
    actualBytes?: Uint8Array;
  } = {},
) {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  let written = new Uint8Array(),
    chunks = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    expect(url.origin).toBe(`https://${config.buckets.media}.cos.ap-beijing.myqcloud.com`);
    expect(init.redirect).toBe("error");
    const headers = {
      "content-length": String(overrides.headSize ?? size),
      etag: overrides.etag ?? etag,
      "x-cos-meta-lyx-sha256": overrides.targetHash ?? sha,
      "x-cos-meta-lyx-content-identity": identity,
    };
    if (init.method === "HEAD")
      return new Response(null, { status: overrides.status ?? 200, headers });
    if (url.searchParams.has("versioning"))
      return new Response(overrides.versioning ?? "<VersioningConfiguration/>");
    if (init.method === "GET") {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const actual = overrides.actualBytes ?? bytes;
          controller.enqueue(actual.slice(0, 5));
          controller.enqueue(
            overrides.getSize === undefined ? actual.slice(5) : new Uint8Array(overrides.getSize),
          );
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers });
    }
    if (init.method === "PUT") {
      if (overrides.existing)
        return new Response("<Error><Code>FileAlreadyExists</Code></Error>", { status: 409 });
      const reader = (init.body as ReadableStream<Uint8Array>).getReader(),
        parts: Uint8Array[] = [];
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          chunks++;
          parts.push(item.value);
        }
      } finally {
        reader.releaseLock();
      }
      written = new Uint8Array(Buffer.concat(parts));
      return new Response(null, { status: 200, headers: { etag } });
    }
    throw new Error("unexpected request");
  };
  const driver = createCosStorage(config, {
    now: () => new Date("2026-01-05T04:00:00Z"),
    fetchImpl,
  });
  owned.push(driver);
  return { driver, requests, written: () => written, chunks: () => chunks };
}
function readInput(sink: (chunk: Uint8Array) => Promise<void> = async () => {}) {
  return {
    ...ref,
    expectedSize: size,
    maxBytes: size,
    ifMatchEtag: etag,
    signal: new AbortController().signal,
    sink,
  };
}
function writeInput(
  body: (signal: AbortSignal) => AsyncIterable<Uint8Array> = async function* () {
    yield bytes.slice(0, 5);
    yield bytes.slice(5);
  },
) {
  return {
    ...ref,
    body,
    size,
    sha256: sha,
    contentIdentity: identity,
    contentType: "video/mp4",
    ifAbsent: true as const,
    signal: new AbortController().signal,
  };
}
describe("COS bounded streams", () => {
  it("COS metadata声明正确但真实GET字节不符时拒绝409重放", async () => {
    const f = fixture({ existing: true, actualBytes: new Uint8Array(size) });
    const result = await f.driver.putStream(writeInput());
    expect(result).toMatchObject({ ok: false, reason: "rejected" });
    expect(f.requests.filter((r) => r.init.method === "PUT")).toHaveLength(1);
    const actualGet = f.requests.find(
      (r) => r.init.method === "GET" && !r.url.searchParams.has("versioning"),
    );
    expect(actualGet).toBeDefined();
    expect(new Headers(actualGet!.init.headers).get("if-match")).toBe(etag);
  });
  it("明确early409先取消独占源并等待finally，HEAD采用同预扫描字节且不关闭父信号", async () => {
    let scans = 0,
      cleaned = 0,
      cleanAtHead = 0;
    const provider = createCosStorage(config, {
      now: () => new Date("2026-01-05T04:00:00Z"),
      fetchImpl: async (input, init = {}) => {
        if (new URL(String(input)).searchParams.has("versioning"))
          return new Response("<VersioningConfiguration/>");
        if (init.method === "HEAD") {
          cleanAtHead = cleaned;
          return new Response(null, {
            headers: {
              "content-length": String(size),
              etag,
              "x-cos-meta-lyx-sha256": sha,
              "x-cos-meta-lyx-content-identity": identity,
            },
          });
        }
        if (init.method === "GET")
          return new Response(bytes, { headers: { "content-length": String(size), etag } });
        const reader = (init.body as ReadableStream<Uint8Array>).getReader();
        try {
          const first = await reader.read();
          expect(first.done).toBe(false);
        } finally {
          reader.releaseLock();
        }
        return new Response("<Error><Code>FileAlreadyExists</Code></Error>", { status: 409 });
      },
    });
    owned.push(provider);
    const signal = AbortSignal.timeout(2000);
    const result = await provider.putStream({
      ...writeInput(async function* (sourceSignal) {
        scans++;
        try {
          if (scans === 1) {
            yield bytes;
            return;
          }
          yield bytes.slice(0, 5);
          await new Promise<void>((resolve) => {
            if (sourceSignal.aborted) resolve();
            else sourceSignal.addEventListener("abort", () => resolve(), { once: true });
          });
          yield bytes.slice(5);
        } finally {
          cleaned++;
        }
      }),
      signal,
    });
    expect(result).toEqual({ ok: true, value: { etag, size } });
    expect(scans).toBe(2);
    expect(cleaned).toBe(2);
    expect(cleanAtHead).toBe(2);
    expect(signal.aborted).toBe(false);
  });
  it("HEAD/IfMatch GET逐块await sink，实际完整hash而非请求声明", async () => {
    const f = fixture(),
      result: Uint8Array[] = [];
    let active = 0;
    expect(
      await f.driver.readTo(
        readInput(async (chunk) => {
          expect(active++).toBe(0);
          await Promise.resolve();
          result.push(chunk);
          active--;
        }),
      ),
    ).toEqual({ ok: true, value: { size, sha256: sha } });
    expect(Buffer.concat(result)).toEqual(Buffer.from(bytes));
    expect(f.requests.map((r) => r.init.method)).toEqual(["HEAD", "GET"]);
    expect(new Headers(f.requests[1]!.init.headers).get("if-match")).toBe(etag);
  });
  it("HEAD声明大小或etag不符时零GET/零sink", async () => {
    for (const options of [{ headSize: size + 1 }, { etag: '"changed"' }]) {
      const f = fixture(options),
        sink = vi.fn(async () => {});
      expect(await f.driver.readTo(readInput(sink))).toMatchObject({
        ok: false,
        reason: "rejected",
      });
      expect(f.requests.map((r) => r.init.method)).toEqual(["HEAD"]);
      expect(sink).not.toHaveBeenCalled();
    }
  });
  it("HEAD/GET同声明却真实流超限或短读都失败，不给完整结果", async () => {
    for (const getSize of [size + 1, 1]) {
      const f = fixture({ getSize });
      expect(await f.driver.readTo(readInput())).toMatchObject({ ok: false });
    }
  });
  it("非法最大长度/preabort零外呼；guard先于preabort", async () => {
    const f = fixture();
    expect(await f.driver.readTo({ ...readInput(), maxBytes: 0 })).toMatchObject({
      ok: false,
      reason: "rejected",
    });
    const guarded = withBeforeCall("storage", f.driver, () => {
      throw new Error("TX guard");
    });
    await expect(guarded.readTo({ ...readInput(), signal: AbortSignal.abort() })).rejects.toThrow(
      "TX guard",
    );
    expect(f.requests).toEqual([]);
  });
  it("服务端5xx/429保留unavailable，不把临时读故障判成不可重试拒绝", async () => {
    for (const status of [500, 429]) {
      const f = fixture({ status });
      expect(await f.driver.readTo(readInput())).toMatchObject({
        ok: false,
        reason: "unavailable",
      });
      expect(f.requests.map((r) => r.init.method)).toEqual(["HEAD"]);
    }
  });
  it("流写两次独立消费+实际hash，worker原子防覆盖/固定目标元数据", async () => {
    const f = fixture(),
      consumed = vi.fn();
    const result = await f.driver.putStream(
      writeInput(async function* () {
        try {
          yield bytes.slice(0, 5);
          yield bytes.slice(5);
        } finally {
          consumed();
        }
      }),
    );
    expect(result).toEqual({ ok: true, value: { etag, size } });
    expect(consumed).toHaveBeenCalledTimes(2);
    expect(f.written()).toEqual(bytes);
    expect(f.chunks()).toBeGreaterThan(0);
    const headers = new Headers(f.requests.find((r) => r.init.method === "PUT")!.init.headers);
    expect(headers.get("x-cos-forbid-overwrite")).toBe("true");
    expect(headers.get("if-none-match")).toBeNull();
    expect(headers.get("x-cos-meta-lyx-sha256")).toBe(sha);
    expect(headers.get("content-length")).toBe(String(size));
  });
  it("预扫描实际hash错误零PUT；第二次源变更亦不成功", async () => {
    const first = fixture();
    expect(await first.driver.putStream({ ...writeInput(), sha256: "2".repeat(64) })).toMatchObject(
      { ok: false, reason: "rejected" },
    );
    expect(first.requests).toEqual([]);
    const second = fixture();
    let reads = 0;
    expect(
      await second.driver.putStream(
        writeInput(async function* () {
          yield ++reads === 1 ? bytes : new Uint8Array(size);
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(reads).toBe(2);
  });
  it("原子409只接受预扫actual hash/HEAD size及归属完全一致的对象", async () => {
    const same = fixture({ existing: true }),
      consumed = vi.fn();
    expect(
      await same.driver.putStream(
        writeInput(async function* () {
          try {
            yield bytes;
          } finally {
            consumed();
          }
        }),
      ),
    ).toEqual({ ok: true, value: { etag, size } });
    expect(consumed).toHaveBeenCalled();
    expect(same.requests.map((r) => r.init.method)).toEqual(["GET", "PUT", "HEAD", "HEAD", "GET"]);
    const different = fixture({ existing: true, targetHash: "0".repeat(64) });
    expect(await different.driver.putStream(writeInput())).toMatchObject({
      ok: false,
      reason: "rejected",
    });
  });
  it("版本桶Enabled/Suspended/未知均unsupported且零PUT", async () => {
    for (const versioning of [
      "<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>",
      "<VersioningConfiguration><Status>Suspended</Status></VersioningConfiguration>",
      "unexpected",
    ]) {
      const f = fixture({ versioning });
      expect(await f.driver.putStream(writeInput())).toMatchObject({
        ok: false,
        reason: "unsupported",
      });
      expect(f.requests.some((r) => r.init.method === "PUT")).toBe(false);
    }
  });
  it("close取消真实HTTP在途GET且等socket关闭；另一driver不受影响", async () => {
    const sockets = new Set<Socket>();
    let entered!: () => void, ended!: () => void;
    const ready = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      socketClosed = new Promise<void>((resolve) => {
        ended = resolve;
      });
    const server = createServer((request, response) => {
      if (request.method === "HEAD") {
        response.writeHead(200, { "Content-Length": size, ETag: etag }).end();
        return;
      }
      request.socket.once("close", ended);
      response.writeHead(200, { "Content-Length": size, ETag: etag });
      response.write(bytes.slice(0, 5));
      entered();
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("owned server");
    const forward: typeof fetch = (input, init) =>
      fetch(`http://127.0.0.1:${address.port}${new URL(String(input)).pathname}`, init);
    const a = createCosStorage(config, { now: () => new Date(), fetchImpl: forward });
    owned.push(a);
    const b = fixture();
    const pending = a.readTo(readInput());
    try {
      await ready;
      await a.close();
      expect(await pending).toMatchObject({ ok: false });
      await socketClosed;
      expect(await b.driver.readTo(readInput())).toMatchObject({ ok: true });
    } finally {
      await a.close();
      const socketsClosed = Promise.all(
        [...sockets].map((socket) => new Promise<void>((resolve) => socket.once("close", resolve))),
      );
      const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await Promise.all([serverClosed, socketsClosed]);
    }
    expect(sockets.size).toBe(0);
  });
});
describe("bounded actual iterator", () => {
  it("完整hash只在全部字节后回调，consumer不提前拉后续块", async () => {
    let pulled = 0,
      completed = "";
    const source = async function* () {
      pulled++;
      yield bytes.slice(0, 5);
      pulled++;
      yield bytes.slice(5);
    };
    const iterator = checkedStream(source(), size, new AbortController().signal, (value) => {
      completed = value;
    });
    expect((await iterator.next()).done).toBe(false);
    expect(pulled).toBe(1);
    expect(completed).toBe("");
    expect((await iterator.next()).done).toBe(false);
    expect(completed).toBe("");
    expect((await iterator.next()).done).toBe(true);
    expect(completed).toBe(sha);
  });
  it("长度过多/过少、单块超1MiB、取消都真正执行source finally", async () => {
    for (const value of [
      new Uint8Array(size + 1),
      new Uint8Array(size - 1),
      new Uint8Array(1024 * 1024 + 1),
    ]) {
      const cleaned = vi.fn(),
        complete = vi.fn();
      const source = async function* () {
        try {
          yield value;
        } finally {
          cleaned();
        }
      };
      await expect(
        (async () => {
          for await (const _item of checkedStream(
            source(),
            size,
            new AbortController().signal,
            complete,
          )) {
            // Fully consume the adversarial iterator to verify its bounded failure.
          }
        })(),
      ).rejects.toThrow();
      expect(cleaned).toHaveBeenCalledOnce();
      expect(complete).not.toHaveBeenCalled();
    }
    const cleaned = vi.fn(),
      controller = new AbortController(),
      complete = vi.fn();
    const source = async function* () {
      try {
        yield bytes;
      } finally {
        cleaned();
      }
    };
    controller.abort();
    await expect(
      (async () => {
        for await (const _item of checkedStream(source(), size, controller.signal, complete)) {
          // Cancellation must close the actual source before returning.
        }
      })(),
    ).rejects.toThrow();
    expect(cleaned).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });
});
