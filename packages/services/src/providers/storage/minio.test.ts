import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { INCOMING_PREFIX, STORAGE_BUCKETS } from "../types.js";
import type { ObjectRef, PresignedPost, StorageBucket } from "../types.js";
import { createMinioStorage, LOCAL_MINIO } from "./minio.js";

// 本地 MinIO 驱动的用例（W0-19 任务书 第 7 节第 6 条）。连的是 infra/compose/local.yml 那套共享容器：
// 先跑 pnpm infra:up。
// MinIO 连不上时：
//   给了 LYX_TEST_MINIO=required   整个文件失败。CI 的“MinIO 驱动的用例”一步带着它，验收也带着它跑
//   没给                           要连 MinIO 的几组跳过并提示，其余照跑。每晚的 Node 26 任务没有任何本地依赖，
//                                  pnpm test 走的是这一条
// 那套容器由几个会话共用：每次运行用自己的键前缀，用完只删自己建的对象，不删桶。

const runId = `w019-${randomUUID()}`;
const storage = createMinioStorage();
const created: ObjectRef[] = [];
const MIME = "application/octet-stream";

/** 照预签名表单直传：字段原样放进表单，文件放最后 */
async function upload(post: PresignedPost, body: Uint8Array<ArrayBuffer>): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(post.fields)) form.set(name, value);
  form.set("file", new Blob([body]));
  return fetch(post.url, { method: "POST", body: form });
}

function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}

/** 直传一个对象到写入区，返回它的引用 */
async function put(bucket: StorageBucket, name: string, body: Uint8Array<ArrayBuffer>) {
  const key = `${INCOMING_PREFIX}${runId}/${name}`;
  const post = await storage.presignPost({
    bucket,
    key,
    mime: MIME,
    maxBytes: 1024,
    expiresSec: 60,
  });
  if (!post.ok) throw new Error(`签发直传表单没成：${post.message}`);
  const response = await upload(post.value, body);
  created.push({ bucket, key });
  return { key, post: post.value, response };
}

const prepared = await storage.ensureBuckets();
if (!prepared.ok) {
  if (process.env.LYX_TEST_MINIO === "required") {
    throw new Error(`本地 MinIO 用不了：${prepared.message}`);
  }
  // 直接写标准错误：Vitest 不显示通过的用例文件里 console 的输出
  process.stderr.write(`[minio.test] 要连本地 MinIO 的用例跳过：${prepared.message}\n`);
}
/** 要连 MinIO 的用例组 */
const live = prepared.ok ? describe : describe.skip;

afterAll(async () => {
  for (const ref of created) await storage.delete(ref);
  storage.close();
});

live("备份专用有界流", () => {
  it("上游next一直等待时取消仍中止分块，不等待新字节", async () => {
    const backup = createMinioStorage({ ...LOCAL_MINIO, backupBucket: LOCAL_MINIO.buckets.secure });
    const key = `backup-tests/${runId}/pending-next.dump.age`;
    created.push({ bucket: "secure", key });
    const abort = new AbortController();
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    try {
      const uploading = backup.backupPutStream({
        bucket: LOCAL_MINIO.buckets.secure,
        key,
        signal: abort.signal,
        maxBytes: 8 * 1024 ** 2,
        body: {
          async *[Symbol.asyncIterator]() {
            yield new Uint8Array(5 * 1024 ** 2);
            entered();
            await new Promise<void>(() => {});
          },
        },
      });
      await waiting;
      abort.abort();
      expect(await uploading).toMatchObject({ ok: false, reason: "unavailable" });
      expect(await backup.backupHead({ bucket: LOCAL_MINIO.buckets.secure, key })).toEqual({
        ok: true,
        value: { exists: false, size: 0 },
      });
    } finally {
      backup.close();
    }
  });
  it("显式目标流式分块上传、HEAD与条件月度复制，不扩四个业务桶", async () => {
    const backup = createMinioStorage({ ...LOCAL_MINIO, backupBucket: LOCAL_MINIO.buckets.secure });
    const key = `backup-tests/${runId}/daily.dump.age`,
      monthly = `backup-tests/${runId}/monthly.dump.age`;
    created.push({ bucket: "secure", key }, { bucket: "secure", key: monthly });
    try {
      const chunk = new Uint8Array(3 * 1024 ** 2).fill(42);
      const result = await backup.backupPutStream({
        bucket: LOCAL_MINIO.buckets.secure,
        key,
        body: {
          async *[Symbol.asyncIterator]() {
            yield chunk;
            yield chunk;
          },
        },
        maxBytes: chunk.byteLength * 2,
        signal: new AbortController().signal,
      });
      expect(result).toMatchObject({ ok: true, value: { size: chunk.byteLength * 2 } });
      const head = await backup.backupHead({ bucket: LOCAL_MINIO.buckets.secure, key });
      expect(head).toMatchObject({ ok: true, value: { exists: true, size: chunk.byteLength * 2 } });
      if (!head.ok || !head.value.etag) throw new Error("缺少备份etag");
      expect(
        await backup.backupCopy({
          src: { bucket: LOCAL_MINIO.buckets.secure, key },
          dst: { bucket: LOCAL_MINIO.buckets.secure, key: monthly },
          ifMatchEtag: head.value.etag,
        }),
      ).toMatchObject({ ok: true });
      expect(
        await backup.backupHead({ bucket: LOCAL_MINIO.buckets.secure, key: monthly }),
      ).toMatchObject({ ok: true, value: { exists: true, size: chunk.byteLength * 2 } });
      expect(
        await backup.backupCopy({
          src: { bucket: LOCAL_MINIO.buckets.secure, key },
          dst: { bucket: LOCAL_MINIO.buckets.secure, key: monthly },
          ifMatchEtag: '"wrong-etag"',
        }),
      ).toMatchObject({ ok: false, reason: "rejected" });
    } finally {
      backup.close();
    }
  });
  it.each(["limit", "stream", "abort"] as const)("%s中断不完成对象", async (failure) => {
    const backup = createMinioStorage({ ...LOCAL_MINIO, backupBucket: LOCAL_MINIO.buckets.secure });
    const key = `backup-tests/${runId}/${failure}.dump.age`;
    created.push({ bucket: "secure", key });
    const abort = new AbortController();
    try {
      const result = await backup.backupPutStream({
        bucket: LOCAL_MINIO.buckets.secure,
        key,
        maxBytes: 8 * 1024 ** 2,
        signal: abort.signal,
        body: {
          async *[Symbol.asyncIterator]() {
            yield new Uint8Array(5 * 1024 ** 2);
            if (failure === "stream") throw new Error("private-stream-error");
            if (failure === "abort") abort.abort();
            yield new Uint8Array(4 * 1024 ** 2);
          },
        },
      });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("private-stream-error");
      expect(await backup.backupHead({ bucket: LOCAL_MINIO.buckets.secure, key })).toEqual({
        ok: true,
        value: { exists: false, size: 0 },
      });
    } finally {
      backup.close();
    }
  });
});

describe("备份目标边界", () => {
  it("缺配和不匹配明确失败，不借四个业务桶或任意桶兜底", async () => {
    expect(
      await storage.backupHead({ bucket: LOCAL_MINIO.buckets.secure, key: "daily/test.dump.age" }),
    ).toMatchObject({ ok: false, reason: "unconfigured" });
    const backup = createMinioStorage({ ...LOCAL_MINIO, backupBucket: LOCAL_MINIO.buckets.secure });
    try {
      expect(
        await backup.backupHead({ bucket: LOCAL_MINIO.buckets.asset, key: "daily/test.dump.age" }),
      ).toMatchObject({ ok: false, reason: "rejected" });
    } finally {
      backup.close();
    }
    expect([...STORAGE_BUCKETS]).toEqual(["secure", "asset", "media", "pub"]);
  });
});

describe("连接参数", () => {
  it("LOCAL_MINIO 与 infra/compose/local.yml 一致；桶名照任务书 第 11 节第 4 项", () => {
    const compose = readFileSync(
      fileURLToPath(new URL("../../../../../infra/compose/local.yml", import.meta.url)),
      "utf8",
    );
    const port = compose.match(/"127\.0\.0\.1:(\d+):9000"/)?.[1];
    expect(LOCAL_MINIO.endpoint).toBe(`http://127.0.0.1:${port}`);
    expect(LOCAL_MINIO.accessKey).toBe(compose.match(/MINIO_ROOT_USER: (\S+)/)?.[1]);
    expect(LOCAL_MINIO.secretKey).toBe(compose.match(/MINIO_ROOT_PASSWORD: (\S+)/)?.[1]);
    expect(LOCAL_MINIO.buckets).toEqual({
      secure: "lyx-local-secure",
      asset: "lyx-local-asset",
      media: "lyx-local-media",
      pub: "lyx-local-pub",
    });
  });

  it("生效状态是 local；没有临时密钥，没有版本控制", async () => {
    expect(storage.status).toBe("local");
    expect(storage.configured).toBe(true);
    expect(storage.capabilities).toEqual({ sts: false, versioning: false });
    expect(
      await storage.issueSts({ bucket: "media", keyPrefix: INCOMING_PREFIX, durationSec: 900 }),
    ).toMatchObject({ ok: false, reason: "unsupported" });
  });
});

live("初始化时建四个桶", () => {
  it("再建一次：四个桶都已经在，一个也不用新建", async () => {
    const again = createMinioStorage();
    try {
      expect(await again.ensureBuckets()).toEqual({ ok: true, value: { created: [] } });
    } finally {
      again.close();
    }
  });
});

live("五步连通，四个桶都可用", () => {
  it.each(STORAGE_BUCKETS)(
    "%s 桶：表单直传到 incoming/ → 读对象头 → 条件复制到正式区 → 签发读地址 → 删除",
    async (bucket) => {
      const body = bytesOf(`狸有戏 ${bucket} ${runId}`);

      // 1. 表单直传到写入区
      const { key, response } = await put(bucket, `${bucket}.bin`, body);
      expect(key.startsWith("incoming/")).toBe(true);
      expect(response.status).toBe(204);

      // 2. 读对象头
      const head = await storage.head({ bucket, key });
      expect(head).toMatchObject({ ok: true, value: { exists: true, size: body.byteLength } });
      if (!head.ok || head.value.etag === undefined) throw new Error("没读到 etag");

      // 3. 条件复制到正式区，改写内容类型
      const dst = { bucket, key: `files/${runId}/${bucket}.txt` };
      created.push(dst);
      const copied = await storage.copy({
        src: { bucket, key },
        dst,
        ifMatchEtag: head.value.etag,
        contentType: "text/plain; charset=utf-8",
      });
      expect(copied).toMatchObject({ ok: true });
      expect(await storage.head(dst)).toMatchObject({
        ok: true,
        value: { exists: true, size: body.byteLength, mime: "text/plain; charset=utf-8" },
      });

      // 4. 签发读地址：读回来的内容与传上去的相同
      const signed = await storage.presignGet({ ...dst, expiresSec: 300 });
      if (!signed.ok) throw new Error(signed.message);
      const read = await fetch(signed.value.url);
      expect(read.status).toBe(200);
      expect(new Uint8Array(await read.arrayBuffer())).toEqual(body);

      // 5. 删除：正式区与写入区的都删掉，读对象头回“不存在”，原来的读地址读不到
      expect(await storage.delete(dst)).toEqual({ ok: true, value: undefined });
      expect(await storage.delete({ bucket, key })).toEqual({ ok: true, value: undefined });
      expect(await storage.head(dst)).toEqual({ ok: true, value: { exists: false, size: 0 } });
      expect((await fetch(signed.value.url)).status).toBe(404);
    },
  );
});

describe("写入区", () => {
  it("键不在 incoming/ 下：不签发", async () => {
    const result = await storage.presignPost({
      bucket: "asset",
      key: `files/${runId}/direct.bin`,
      mime: MIME,
      maxBytes: 1024,
      expiresSec: 60,
    });
    expect(result).toMatchObject({ ok: false, reason: "rejected" });
  });
});

live("直传的限制", () => {
  it("超过签发时定的大小：MinIO 拒收，对象没有落地", async () => {
    const { key, response } = await put("asset", "too-big.bin", new Uint8Array(2048));
    expect(response.status).toBe(400);
    expect(await storage.head({ bucket: "asset", key })).toEqual({
      ok: true,
      value: { exists: false, size: 0 },
    });
  });

  it("内容类型与签发时不同：MinIO 拒收", async () => {
    const key = `${INCOMING_PREFIX}${runId}/wrong-type.bin`;
    const post = await storage.presignPost({
      bucket: "asset",
      key,
      mime: MIME,
      maxBytes: 1024,
      expiresSec: 60,
    });
    if (!post.ok) throw new Error(post.message);
    created.push({ bucket: "asset", key });
    const tampered = {
      ...post.value,
      fields: { ...post.value.fields, "Content-Type": "text/html" },
    };
    expect((await upload(tampered, bytesOf("x"))).status).toBe(403);
  });
});

live("条件复制", () => {
  it("etag 对不上：不复制，返回 rejected", async () => {
    const { key } = await put("media", "stale.bin", bytesOf("第一版"));
    const dst = { bucket: "media" as const, key: `files/${runId}/stale.bin` };
    created.push(dst);
    const result = await storage.copy({
      src: { bucket: "media", key },
      dst,
      ifMatchEtag: '"00000000000000000000000000000000"',
      contentType: MIME,
    });
    expect(result).toMatchObject({ ok: false, reason: "rejected" });
    expect(await storage.head(dst)).toEqual({ ok: true, value: { exists: false, size: 0 } });
  });
});

live("读地址", () => {
  it("给了下载文件名：按附件下载", async () => {
    const { key } = await put("secure", "named.bin", bytesOf("授权书"));
    const signed = await storage.presignGet({
      bucket: "secure",
      key,
      expiresSec: 300,
      downloadName: "授权书.pdf",
    });
    if (!signed.ok) throw new Error(signed.message);
    const read = await fetch(signed.value.url);
    expect(read.status).toBe(200);
    expect(read.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("授权书.pdf")}`,
    );
  });

  it("不带签名直接读：被拒（桶是私有的）", async () => {
    const { key } = await put("pub", "private.bin", bytesOf("x"));
    const signed = await storage.presignGet({ bucket: "pub", key, expiresSec: 300 });
    if (!signed.ok) throw new Error(signed.message);
    const bare = signed.value.url.split("?")[0] ?? "";
    expect((await fetch(bare)).status).toBe(403);
  });

  it("过期后访问被拒", { timeout: 40_000 }, async () => {
    const { key } = await put("media", "expiring.bin", bytesOf("样片"));
    const signed = await storage.presignGet({ bucket: "media", key, expiresSec: 1 });
    if (!signed.ok) throw new Error(signed.message);
    // 容器与本机的时钟可能差一点：过了到期时刻之后隔半秒看一次，30 秒内必须被拒
    const deadline = Date.now() + 30_000;
    let status = 0;
    let body = "";
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (Date.now() < signed.value.expiresAt.getTime()) continue;
      const response = await fetch(signed.value.url);
      status = response.status;
      body = await response.text();
      if (status === 403) break;
    }
    expect(status).toBe(403);
    expect(body).toContain("Request has expired");
  });
});

describe("MinIO 连不上", () => {
  it("返回 unavailable，不抛错；提示里不带地址与账号", async () => {
    const unreachable = createMinioStorage({ ...LOCAL_MINIO, endpoint: "http://127.0.0.1:1" });
    try {
      const results = [
        await unreachable.ensureBuckets(),
        await unreachable.head({ bucket: "asset", key: "incoming/x" }),
        await unreachable.presignGet({ bucket: "asset", key: "incoming/x", expiresSec: 60 }),
        await unreachable.delete({ bucket: "asset", key: "incoming/x" }),
      ];
      for (const result of results) {
        expect(result).toMatchObject({ ok: false, reason: "unavailable" });
        const message = result.ok ? "" : result.message;
        expect(message).toContain("pnpm infra:up");
        expect(message).not.toContain("127.0.0.1");
        expect(message).not.toContain(LOCAL_MINIO.secretKey);
      }
    } finally {
      unreachable.close();
    }
  });
});
