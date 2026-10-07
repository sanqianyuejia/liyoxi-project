// 假存储：对象放在内存里，不依赖 MinIO。行为照本地 MinIO 驱动：直传只能落在写入区、
// 复制要对上 etag、读地址有时限。到期与否按替身的时钟判，拨动时钟就能测过期。
// 直传与读取没有真的 HTTP：用 upload() 与 fetch() 代替，返回的是状态码。

import { createHash } from "node:crypto";

import { failed, INCOMING_PREFIX, ok } from "../../providers/types.js";
import type {
  ObjectHead,
  ObjectRef,
  PresignedPost,
  ProviderMethodName,
  ProviderResult,
  StorageBucket,
  StorageProvider,
} from "../../providers/types.js";
import { createFakeCore, systemClock } from "./base.js";
import type { FakeClock, FakeControl } from "./base.js";

type Method = ProviderMethodName<StorageProvider>;

export interface FakeStoredObject {
  body: Uint8Array;
  mime: string;
  etag: string;
  contentDisposition?: string;
  contentIdentity?: string;
}

export type FakeFetchResult =
  | { status: 200; body: Uint8Array; mime: string; contentDisposition?: string }
  | { status: 403 | 404 };

export interface FakeStorage extends StorageProvider, FakeControl<Method> {
  /** 可以改：把 sts 置为 false，issueSts 就返回 unsupported（本地 MinIO 的样子） */
  capabilities: { sts: boolean; versioning: boolean };
  /** 全部对象，键是 “桶/对象键” */
  readonly objects: Map<string, FakeStoredObject>;
  /** 备份命名空间独立，不混入四个业务桶。替身只保存有界的小样本。 */
  readonly backupObjects: Map<string, FakeStoredObject>;
  /** 不经签名直接放一个对象（造数据用），返回 etag */
  put(ref: ObjectRef, body: Uint8Array, mime: string): string;
  /** 照预签名表单直传。返回状态码：204 成功；400 超过大小；403 表单过期、被改过或不是本替身签的 */
  upload(post: PresignedPost, body: Uint8Array): 204 | 400 | 403;
  /** 照读地址取对象：200 带内容；403 过期或不是本替身签的；404 对象不存在 */
  fetch(url: string): FakeFetchResult;
}

const ORIGIN = "https://fake-storage.invalid";

function etagOf(body: Uint8Array): string {
  return `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
}

const slot = (ref: ObjectRef) => `${ref.bucket}/${ref.key}`;

export function createFakeStorage(options: { clock?: FakeClock } = {}): FakeStorage {
  const clock = options.clock ?? systemClock;
  const core = createFakeCore<Method>(clock);
  const objects = new Map<string, FakeStoredObject>();
  const backupObjects = new Map<string, FakeStoredObject>();
  const posts = new Map<
    string,
    { bucket: StorageBucket; key: string; mime: string; maxBytes: number; expiresAt: Date }
  >();
  const reads = new Map<
    string,
    {
      ref: ObjectRef;
      expiresAt: Date;
      downloadName?: string;
      disposition?: "inline" | "attachment";
    }
  >();
  let seq = 0;
  const nextToken = (prefix: string) => `${prefix}-${(seq += 1)}`;
  const expiry = (seconds: number) => new Date(clock.now().getTime() + seconds * 1000);
  const expired = (at: Date) => clock.now().getTime() > at.getTime();

  function put(ref: ObjectRef, body: Uint8Array, mime: string): string {
    const stored = { body: new Uint8Array(body), mime, etag: etagOf(body) };
    objects.set(slot(ref), stored);
    return stored.etag;
  }

  const fake: FakeStorage = {
    status: "fake",
    configured: true,
    capabilities: { sts: true, versioning: false },
    ...core.control,
    objects,
    backupObjects,
    put,

    backupPutStream: (input) =>
      core.run("backupPutStream", input, async () => {
        if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0)
          return failed("rejected", "备份大小上限不合格");
        const chunks: Uint8Array[] = [];
        let size = 0;
        const iterator = input.body[Symbol.asyncIterator]();
        let aborted: (() => void) | undefined;
        try {
          const cancellation = new Promise<IteratorResult<Uint8Array>>((_, reject) => {
            aborted = () => reject(new Error("BackupAborted"));
            input.signal.addEventListener("abort", aborted, { once: true });
          });
          void cancellation.catch(() => {});
          for (;;) {
            if (input.signal.aborted) return failed("unavailable", "备份上传已中止");
            const next = await Promise.race([iterator.next(), cancellation]);
            if (next.done) break;
            const chunk = next.value;
            size += chunk.byteLength;
            if (size > input.maxBytes) return failed("rejected", "备份超过大小上限");
            chunks.push(new Uint8Array(chunk));
          }
          if (input.signal.aborted) return failed("unavailable", "备份上传已中止");
        } catch {
          return failed("unavailable", "备份流读取失败");
        } finally {
          if (aborted) input.signal.removeEventListener("abort", aborted);
          if (iterator.return) void iterator.return().catch(() => {});
        }
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const etag = etagOf(body);
        backupObjects.set(`${input.bucket}/${input.key}`, {
          body,
          mime: "application/octet-stream",
          etag,
        });
        return ok({ etag, size });
      }),
    backupHead: (input) =>
      core.run("backupHead", input, () => {
        const stored = backupObjects.get(`${input.bucket}/${input.key}`);
        return ok(
          stored
            ? { exists: true, size: stored.body.byteLength, etag: stored.etag }
            : { exists: false, size: 0 },
        );
      }),
    backupCopy: (input) =>
      core.run("backupCopy", input, () => {
        const stored = backupObjects.get(`${input.src.bucket}/${input.src.key}`);
        if (input.src.bucket !== input.dst.bucket || !stored || stored.etag !== input.ifMatchEtag)
          return failed("rejected", "备份复制目标或 etag 不合格");
        backupObjects.set(`${input.dst.bucket}/${input.dst.key}`, {
          ...stored,
          body: new Uint8Array(stored.body),
        });
        return ok({ etag: stored.etag });
      }),

    upload(post, body) {
      const policy = posts.get(post.fields.policy ?? "");
      if (!policy || expired(policy.expiresAt)) return 403;
      if (post.fields.key !== policy.key || post.fields["Content-Type"] !== policy.mime) return 403;
      if (body.byteLength > policy.maxBytes) return 400;
      put({ bucket: policy.bucket, key: policy.key }, body, policy.mime);
      return 204;
    },

    fetch(url) {
      const grant = reads.get(new URL(url).searchParams.get("token") ?? "");
      if (!grant || expired(grant.expiresAt)) return { status: 403 };
      const stored = objects.get(slot(grant.ref));
      if (!stored) return { status: 404 };
      const contentDisposition =
        grant.downloadName === undefined
          ? (grant.disposition ?? stored.contentDisposition)
          : `${grant.disposition ?? "attachment"}; filename*=UTF-8''${encodeURIComponent(grant.downloadName)}`;
      return {
        status: 200,
        body: new Uint8Array(stored.body),
        mime: stored.mime,
        contentDisposition,
      };
    },

    presignPost: (input) =>
      core.run("presignPost", input, () => {
        if (!input.key.startsWith(INCOMING_PREFIX)) {
          return failed("rejected", `直传只能写到写入区：键要以 ${INCOMING_PREFIX} 开头`);
        }
        const token = nextToken("fake-post");
        const expiresAt = expiry(input.expiresSec);
        posts.set(token, { ...input, expiresAt });
        return ok({
          url: `${ORIGIN}/${input.bucket}`,
          fields: { key: input.key, "Content-Type": input.mime, policy: token },
          key: input.key,
          expiresAt,
        });
      }),

    issueSts: (input) =>
      core.run("issueSts", input, () => {
        if (!fake.capabilities.sts) return failed("unsupported", "替身的临时密钥能力已关掉");
        const token = nextToken("fake-sts");
        return ok({
          accessKeyId: `${token}-id`,
          secretAccessKey: `${token}-secret`,
          sessionToken: `${token}-session`,
          expiresAt: expiry(input.durationSec),
        });
      }),

    head: (input) =>
      core.run("head", input, (): ProviderResult<ObjectHead> => {
        const stored = objects.get(slot(input));
        if (!stored) return ok({ exists: false, size: 0 });
        return ok({
          exists: true,
          size: stored.body.byteLength,
          mime: stored.mime,
          etag: stored.etag,
        });
      }),

    readPrefix: (input) =>
      core.run("readPrefix", input, () => {
        if (!Number.isInteger(input.bytes) || input.bytes < 1 || input.bytes > 4096)
          return failed("rejected", "文件头读取只允许 1–4096 字节");
        const stored = objects.get(slot(input));
        if (!stored || (input.ifMatchEtag !== undefined && stored.etag !== input.ifMatchEtag))
          return failed("rejected", "源对象不存在或 etag 对不上");
        return ok(stored.body.slice(0, input.bytes));
      }),
    putObject: (input) =>
      core.run("putObject", input, () => {
        const existing = objects.get(slot(input));
        if (input.ifAbsent && existing) {
          if (
            !input.contentIdentity ||
            existing.contentIdentity !== input.contentIdentity ||
            createHash("sha256").update(existing.body).digest("hex") !==
              createHash("sha256").update(input.body).digest("hex")
          )
            return failed("rejected", "正式区键已有不同内容或归属的系统文件");
          return ok({ etag: existing.etag, size: existing.body.byteLength });
        }
        const etag = put(input, input.body, input.contentType);
        const stored = objects.get(slot(input));
        if (stored) {
          stored.contentDisposition = input.contentDisposition;
          stored.contentIdentity = input.contentIdentity;
        }
        return ok({ etag, size: input.body.byteLength });
      }),

    copy: (input) =>
      core.run("copy", input, () => {
        const source = objects.get(slot(input.src));
        if (!source) return failed("rejected", "源对象不存在");
        if (source.etag !== input.ifMatchEtag) return failed("rejected", "源对象的 etag 对不上");
        objects.set(slot(input.dst), {
          body: new Uint8Array(source.body),
          mime: input.contentType,
          etag: source.etag,
          contentDisposition: input.contentDisposition,
        });
        return ok({ etag: source.etag });
      }),

    presignGet: (input) =>
      core.run("presignGet", input, () => {
        const token = nextToken("fake-read");
        const expiresAt = expiry(input.expiresSec);
        reads.set(token, {
          ref: { bucket: input.bucket, key: input.key },
          expiresAt,
          downloadName: input.downloadName,
          disposition: input.disposition,
        });
        const path = input.key.split("/").map(encodeURIComponent).join("/");
        return ok({ url: `${ORIGIN}/${input.bucket}/${path}?token=${token}`, expiresAt });
      }),

    delete: (input) =>
      core.run("delete", input, () => {
        objects.delete(slot(input));
        return ok(undefined);
      }),
  };
  return fake;
}
