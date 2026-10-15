import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { KeyValueStorage } from "../platform";
import { StorageKey } from "../storage";
import type { Registration } from "./api";
import { clientToken, hmacSha1, sha1, sha1Bytes, utf8Bytes } from "./hash";
import { createMultipartPort, MultipartUncertainError } from "./multipart";
import type { CloudRequest, CloudResponse, MultipartDeps } from "./multipart";
import type { SelectedFile } from "./queue";
import { createResumeStore } from "./resume";
import type { ResumeManifest, ResumeOwner } from "./resume";

const NOW = Date.parse("2026-10-12T04:00:00Z"),
  CHUNK = 1024 * 1024;
const ID = "00000000-0000-4000-8000-000000000001",
  TOKEN = "same-head-token",
  CONFIRM = "file_complete:original";
const OWNER: ResumeOwner = {
  userId: "user",
  memberId: "member",
  entityId: "entity",
  storeId: "store",
  role: "owner",
  storeScope: "all",
};
const ticket = (): Registration => ({
  fileId: ID,
  clientToken: TOKEN,
  status: "pending",
  mode: "multipart",
  bucket: "test-media-1250000000",
  region: "ap-beijing",
  key: `incoming/${ID}/clip.mp4`,
  post: null,
  sts: {
    tmpSecretId: "fictional-ak",
    tmpSecretKey: "fictional-key",
    sessionToken: "fictional+token/=",
    startTime: new Date(NOW - 60_000).toISOString(),
    expiredTime: new Date(NOW + 1800_000).toISOString(),
  },
  chunkSize: CHUNK,
  chunkParallel: 4,
  expiresAt: new Date(NOW + 1800_000).toISOString(),
  uploadExpiresAt: new Date(NOW + 86_400_000).toISOString(),
  credentialsLeft: 29,
});
const digest = (data: Uint8Array) => createHash("md5").update(data).digest("hex");
const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
const response = (
  data: string,
  headers: Record<string, string> = {},
  statusCode = 200,
): CloudResponse => ({ data, headers, statusCode });
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const partXml = (n: number, size: number, etag: string) =>
  `<Part><PartNumber>${n}</PartNumber><Size>${size}</Size><ETag>${escapeXml(etag)}</ETag></Part>`;
function listed(
  g: Registration,
  parts: string,
  truncated = false,
  marker = 0,
  next = 0,
  id = "original+/=id",
) {
  return `<ListPartsResult><Bucket>${g.bucket}</Bucket><Key>${escapeXml(g.key)}</Key><UploadId>${escapeXml(id)}</UploadId><PartNumberMarker>${marker}</PartNumberMarker><NextPartNumberMarker>${next}</NextPartNumberMarker><MaxParts>100</MaxParts><IsTruncated>${truncated}</IsTruncated>${parts}</ListPartsResult>`;
}
function harness(size = CHUNK * 2 + 3) {
  const data = Uint8Array.from({ length: size }, (_, n) => n % 251),
    grant = ticket();
  const file: SelectedFile = { path: "wxfile://tmp/clip", name: "clip.mp4", size };
  const values = new Map<string, unknown>(),
    calls: CloudRequest[] = [],
    parts = new Map<number, string>();
  const storage: KeyValueStorage = {
    get: <T>(key: string) => (values.has(key) ? (structuredClone(values.get(key)) as T) : null),
    set: (key, value) => {
      values.set(key, structuredClone(value));
    },
    remove: (key) => {
      values.delete(key);
    },
  };
  const resume = createResumeStore(storage, () => NOW);
  let currentOwner: ResumeOwner | null = { ...OWNER };
  const h = {
    data,
    grant,
    file,
    values,
    parts,
    calls,
    storage,
    resume,
    route: async (request: CloudRequest): Promise<CloudResponse> => {
      const url = new URL(request.url);
      if (request.method === "POST" && url.searchParams.has("uploads"))
        return response(
          `<InitiateMultipartUploadResult><Bucket>${grant.bucket}</Bucket><Key>${escapeXml(grant.key)}</Key><UploadId>original+/=id</UploadId></InitiateMultipartUploadResult>`,
        );
      if (request.method === "GET")
        return response(
          listed(
            grant,
            [...parts]
              .sort(([a], [b]) => a - b)
              .map(([n, tag]) => partXml(n, Math.min(CHUNK, size - (n - 1) * CHUNK), `"${tag}"`))
              .join(""),
          ),
        );
      if (request.method === "PUT") {
        expect(request.data).toBeInstanceOf(ArrayBuffer);
        const n = Number(url.searchParams.get("partNumber")),
          tag = digest(new Uint8Array(request.data as ArrayBuffer));
        expect(request.headers["content-md5"]).toBe(Buffer.from(tag, "hex").toString("base64"));
        parts.set(n, tag);
        return response("", { eTaG: `"${tag.toUpperCase()}"` });
      }
      return response(
        `<CompleteMultipartUploadResult><Bucket>${grant.bucket}</Bucket><Key>${escapeXml(grant.key)}</Key><ETag>"${"a".repeat(32)}-3"</ETag></CompleteMultipartUploadResult>`,
      );
    },
    owner: (value: ResumeOwner | null) => {
      currentOwner = value;
    },
  };
  const deps: MultipartDeps = {
    owner: () => currentOwner,
    resume,
    now: () => NOW,
    refresh: vi.fn(async () => grant),
    read: vi.fn(async (path, offset, length) => {
      expect(path).toBe(file.path);
      return data.subarray(offset, offset + length);
    }),
    send: vi.fn((request) => {
      calls.push(request);
      return { done: Promise.resolve().then(() => h.route(request)), abort: vi.fn() };
    }),
  };
  const record = (phase: ResumeManifest["phase"] = "uploading"): ResumeManifest => ({
    version: 1,
    owner: { ...OWNER },
    token: TOKEN,
    fileId: ID,
    bucket: grant.bucket,
    region: grant.region,
    key: grant.key,
    size,
    chunkSize: CHUNK,
    digests: Array.from({ length: Math.ceil(size / CHUNK) }, (_, n) =>
      digest(data.subarray(n * CHUNK, Math.min(size, (n + 1) * CHUNK))),
    ),
    uploadId: phase === "initiating" ? null : "original+/=id",
    phase,
    confirmKey: CONFIRM,
    expiresAt: NOW + 86_400_000,
  });
  const progress = vi.fn(),
    check = vi.fn();
  const port = createMultipartPort(deps);
  const upload = () => port.upload(grant, file, TOKEN, CONFIRM, progress, check);
  return Object.assign(h, { deps, record, progress, check, port, upload });
}

// 独立Node实现官方COS签名步骤；不复用被测编码/摘要/签名函数。
function expectedAuthorization(request: CloudRequest, g: Registration) {
  const encode = (s: string) =>
    encodeURIComponent(s).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const url = new URL(request.url),
    canonical = (values: Record<string, string>) =>
      Object.entries(values)
        .map(([k, v]) => [encode(k).toLowerCase(), encode(v)])
        .sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0));
  const query = canonical(Object.fromEntries(url.searchParams));
  const headers = canonical({
    host: url.hostname,
    ...Object.fromEntries(
      Object.entries(request.headers).filter(([k]) => k.toLowerCase() !== "authorization"),
    ),
  });
  const time = `${Date.parse(g.sts!.startTime) / 1000};${Date.parse(g.sts!.expiredTime) / 1000}`;
  const signKey = createHmac("sha1", g.sts!.tmpSecretKey).update(time).digest("hex");
  const http = `${request.method.toLowerCase()}\n/${g.key}\n${query.map(([k, v]) => `${k}=${v}`).join("&")}\n${headers.map(([k, v]) => `${k}=${v}`).join("&")}\n`;
  const hash = createHash("sha1").update(http).digest("hex");
  const signature = createHmac("sha1", signKey).update(`sha1\n${time}\n${hash}\n`).digest("hex");
  return `q-sign-algorithm=sha1&q-ak=${g.sts!.tmpSecretId}&q-sign-time=${time}&q-key-time=${time}&q-header-list=${headers.map(([k]) => k).join(";")}&q-url-param-list=${query.map(([k]) => k).join(";")}&q-signature=${signature}`;
}

describe("SHA1/HMAC标准向量与COS真实协议", () => {
  it.each(["", "abc", "你好😀é", "a".repeat(55), "b".repeat(56), "c".repeat(64), "d".repeat(1000)])(
    "UTF8/SHA1与Node独立实现一致（%#）",
    (text) => {
      expect(utf8Bytes(text)).toEqual(new Uint8Array(Buffer.from(text, "utf8")));
      expect(sha1(text)).toBe(createHash("sha1").update(text).digest("hex"));
      const backing = new Uint8Array([255, 0, 1, 128, 254, 253]);
      expect(sha1Bytes(backing.subarray(1, 5))).toBe(
        createHash("sha1").update(backing.subarray(1, 5)).digest("hex"),
      );
    },
  );
  it.each([
    {
      key: new Uint8Array(20).fill(0x0b),
      text: "Hi There",
      expected: "b617318655057264e28bc0b6fb378c8ef146be00",
    },
    {
      key: new Uint8Array(Buffer.from("Jefe")),
      text: "what do ya want for nothing?",
      expected: "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79",
    },
    {
      key: new Uint8Array(80).fill(0xaa),
      text: "Test Using Larger Than Block-Size Key - Hash Key First",
      expected: "aa4ae5e15272d00e95705637ce8a3b55ed402112",
    },
  ])("RFC2202标准HMAC向量（%#）", ({ key, text, expected }) => {
    expect(hmacSha1(key, utf8Bytes(text))).toBe(expected);
    expect(hmacSha1(key, utf8Bytes(text))).toBe(createHmac("sha1", key).update(text).digest("hex"));
  });
  it("所有COS方法/查询/头签名独立对照，PUT为精确ArrayBuffer和base64 MD5", async () => {
    const h = harness();
    h.grant.key = `incoming/${ID}/片 段!'()*.mp4`;
    await h.upload().done;
    for (const call of h.calls) {
      expect(call.headers.Authorization).toBe(expectedAuthorization(call, h.grant));
      expect(call.headers["x-cos-security-token"]).toBe(h.grant.sts!.sessionToken);
      expect(call.headers).not.toHaveProperty("Host");
      expect(call.url).toMatch(
        /^https:\/\/test-media-1250000000\.cos\.ap-beijing\.myqcloud\.com\//,
      );
      expect(call.headers.Authorization).not.toContain(h.grant.sts!.tmpSecretKey);
    }
    const put = h.calls.filter((call) => call.method === "PUT");
    expect(
      put.map((call) => Number(new URL(call.url).searchParams.get("partNumber"))).sort(),
    ).toEqual([1, 2, 3]);
    for (const call of put) {
      const n = Number(new URL(call.url).searchParams.get("partNumber"));
      // 原生逐字节与长度比较保留1MiB边界，避免通用深比较枚举百万个字节键。
      expect(
        Buffer.compare(
          new Uint8Array(call.data as ArrayBuffer),
          h.data.subarray((n - 1) * CHUNK, n * CHUNK),
        ),
      ).toBe(0);
    }
    const complete = h.calls.at(-1)!;
    expect(complete.method).toBe("POST");
    expect(complete.data).toBe(
      `<CompleteMultipartUpload>${h
        .record()
        .digests.map(
          (tag, n) =>
            `<Part><PartNumber>${n + 1}</PartNumber><ETag>&quot;${tag}&quot;</ETag></Part>`,
        )
        .join("")}</CompleteMultipartUpload>`,
    );
    expect(h.resume.load(OWNER, TOKEN)).toMatchObject({ phase: "uploaded", confirmKey: CONFIRM });
  });
});

describe("全文件恢复、远端ListParts及停止边界", () => {
  it("真实PUT失败后保留原UploadId，重开实例仅补远端缺块并再次核实所有块", async () => {
    const h = harness(),
      ordinary = h.route;
    let failed = false;
    h.route = async (request) => {
      if (
        request.method === "PUT" &&
        new URL(request.url).searchParams.get("partNumber") === "2" &&
        !failed
      ) {
        failed = true;
        return response("<Error><Code>InternalError</Code></Error>", {}, 500);
      }
      return ordinary(request);
    };
    await expect(h.upload().done).rejects.toThrow();
    expect(h.resume.load(OWNER, TOKEN)).toMatchObject({
      phase: "uploading",
      uploadId: "original+/=id",
    });
    const before = h.calls.length,
      missing = h
        .record()
        .digests.map((_, n) => n + 1)
        .filter((n) => !h.parts.has(n));
    expect(missing).toContain(2);
    h.progress.mockClear();
    await createMultipartPort(h.deps).upload(h.grant, h.file, TOKEN, CONFIRM, h.progress, h.check)
      .done;
    expect(
      h.calls
        .slice(before)
        .filter((c) => c.method === "PUT")
        .map((c) => Number(new URL(c.url).searchParams.get("partNumber")))
        .sort(),
    ).toEqual(missing);
    expect(h.calls.filter((c) => new URL(c.url).searchParams.has("uploads"))).toHaveLength(1);
    expect(h.calls.at(-2)?.method).toBe("GET");
    expect(h.parts.size).toBe(3);
    expect(h.progress).toHaveBeenLastCalledWith(100);
  });

  it("同首256KB异后缀仍是原clientToken，但整文件恢复拒绝且不发送COS", async () => {
    const h = harness(),
      fingerprint = {
        storeId: OWNER.storeId,
        category: "asset_video",
        size: h.file.size,
        durationMs: 0,
        width: 0,
        height: 0,
      };
    const before = clientToken(fingerprint, h.data);
    h.resume.save(h.record());
    h.data[h.data.length - 1] = h.data[h.data.length - 1]! ^ 1;
    expect(clientToken(fingerprint, h.data)).toBe(before);
    const failed = h.port.restore(TOKEN, h.file, h.check);
    await expect(failed).rejects.toThrow("不一致");
    await expect(failed).rejects.toMatchObject({ fileId: ID });
    expect(h.deps.send).not.toHaveBeenCalled();
    expect(h.resume.load(OWNER, TOKEN)?.phase).toBe("uploading");
  });

  it.each(["size", "read"] as const)(
    "恢复%s失败保留原fileId供既有cancel协议精确收尾",
    async (mode) => {
      const h = harness();
      h.resume.save(h.record());
      if (mode === "read")
        h.deps.read = async () => {
          throw new Error("local file gone");
        };
      const selected = mode === "size" ? { ...h.file, size: h.file.size + 1 } : h.file;
      await expect(h.port.restore(TOKEN, selected, h.check)).rejects.toMatchObject({ fileId: ID });
      expect(h.deps.send).not.toHaveBeenCalled();
      expect(h.resume.load(OWNER, TOKEN)).toMatchObject({ fileId: ID, phase: "uploading" });
    },
  );

  it("始终无owner的可选restore不干扰旧POST；真正multipart upload仍拒绝", async () => {
    const h = harness(),
      port = createMultipartPort({ ...h.deps, owner: () => null });
    expect(await port.restore(TOKEN, h.file, h.check)).toBeNull();
    expect(h.deps.read).not.toHaveBeenCalled();
    await expect(
      port.upload(h.grant, h.file, TOKEN, CONFIRM, h.progress, h.check).done,
    ).rejects.toThrow("归属");
    expect(h.deps.send).not.toHaveBeenCalled();
  });

  it("新实例重选同内容：分页远端块核实后只补缺块，进度按确认字节", async () => {
    const h = harness(),
      record = h.record();
    h.resume.save(record);
    h.parts.set(1, record.digests[0]!);
    h.parts.set(3, record.digests[2]!);
    const ordinary = h.route;
    let pages = 0;
    h.route = async (request) => {
      const url = new URL(request.url);
      if (request.method === "GET" && pages++ < 2) {
        expect(url.searchParams.get("max-parts")).toBe("100");
        const second = pages === 2;
        expect(url.searchParams.get("part-number-marker")).toBe(second ? "1" : null);
        return response(
          listed(
            h.grant,
            partXml(second ? 3 : 1, second ? 3 : CHUNK, `"${record.digests[second ? 2 : 0]}"`),
            !second,
            second ? 1 : 0,
            second ? 3 : 1,
          ),
        );
      }
      return ordinary(request);
    };
    const reopened = createMultipartPort({
      ...h.deps,
      resume: createResumeStore(h.storage, () => NOW),
    });
    expect(await reopened.restore(TOKEN, { ...h.file, path: h.file.path }, h.check)).toEqual(
      record,
    );
    await reopened.upload(h.grant, h.file, TOKEN, "ignored-new-key", h.progress, h.check).done;
    expect(h.calls.filter((c) => new URL(c.url).searchParams.has("uploads"))).toHaveLength(0);
    expect(
      h.calls
        .filter((c) => c.method === "PUT")
        .map((c) => new URL(c.url).searchParams.get("partNumber")),
    ).toEqual(["2"]);
    expect(h.progress.mock.calls.map(([value]) => value)).toEqual([
      Math.floor(((CHUNK + 3) / h.file.size) * 100),
      100,
    ]);
    expect(h.resume.load(OWNER, TOKEN)?.confirmKey).toBe(CONFIRM);
  });

  it.each([
    "bucket",
    "key",
    "upload_id",
    "duplicate",
    "size",
    "etag",
    "part_zero",
    "part_extra",
    "truncation",
    "marker",
    "nested",
    "doctype",
    "oversize",
    "duplicate_field",
    "bad_etag",
    "tail_size",
  ] as const)("%s：远端不可信标识/尺寸/ETag/分页严格拒绝且不PUT/complete", async (mode) => {
    const h = harness(),
      record = h.record();
    h.resume.save(record);
    let body = listed(h.grant, partXml(1, CHUNK, `"${record.digests[0]}"`));
    if (mode === "bucket") body = body.replace(h.grant.bucket, "foreign-1250000000");
    if (mode === "key") body = body.replace(h.grant.key, `incoming/${ID}/foreign.mp4`);
    if (mode === "upload_id") body = body.replace("original+/=id", "foreign-upload");
    if (mode === "duplicate")
      body = listed(h.grant, partXml(1, CHUNK, record.digests[0]!).repeat(2));
    if (mode === "size") body = body.replace(`<Size>${CHUNK}</Size>`, "<Size>1</Size>");
    if (mode === "etag") body = body.replace(record.digests[0]!, "a".repeat(32));
    if (mode === "part_zero") body = body.replace("<PartNumber>1", "<PartNumber>0");
    if (mode === "part_extra") body = body.replace("<PartNumber>1", "<PartNumber>4");
    if (mode === "truncation") body = body.replace("<IsTruncated>false", "<IsTruncated>unknown");
    if (mode === "marker")
      body = listed(h.grant, partXml(1, CHUNK, record.digests[0]!), true, 0, 0);
    if (mode === "nested")
      body = body.replace(
        `<Key>${h.grant.key}</Key>`,
        `<Wrapper><Key>${h.grant.key}</Key></Wrapper>`,
      );
    if (mode === "doctype") body = `<!DOCTYPE x [<!ENTITY x SYSTEM "file:///forbidden">]>${body}`;
    if (mode === "oversize") body = "x".repeat(65_537);
    if (mode === "duplicate_field")
      body = body.replace("</UploadId>", "</UploadId><UploadId>original+/=id</UploadId>");
    if (mode === "bad_etag") body = body.replace(record.digests[0]!, "multipart-etag-1");
    if (mode === "tail_size") body = listed(h.grant, partXml(3, CHUNK, record.digests[2]!));
    h.route = async () => response(body);
    await expect(h.upload().done).rejects.toThrow();
    expect(h.calls.map((call) => call.method)).toEqual(["GET"]);
    expect(h.progress).not.toHaveBeenCalled();
    expect(h.resume.load(OWNER, TOKEN)).toEqual(record);
  });

  it.each(["missing", "duplicate", "wrong", "malformed"] as const)(
    "PUT %s ETag拒绝且不合并",
    async (mode) => {
      const h = harness(),
        ordinary = h.route;
      h.route = async (request) => {
        const result = await ordinary(request);
        if (request.method === "PUT") {
          const expected = digest(new Uint8Array(request.data as ArrayBuffer));
          return response(
            "",
            mode === "missing"
              ? {}
              : mode === "duplicate"
                ? { ETag: expected, etag: expected }
                : { ETag: mode === "wrong" ? "a".repeat(32) : "arbitrary" },
          );
        }
        return result;
      };
      await expect(h.upload().done).rejects.toThrow();
      expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(1);
      expect(h.resume.load(OWNER, TOKEN)?.phase).toBe("uploading");
      expect(h.progress.mock.calls).toEqual([[0]]);
    },
  );

  it("cap2：未收到ETag不计进度；停止后等待两在途请求settled且无合并/晚进度", async () => {
    const h = harness(),
      pending = [deferred<CloudResponse>(), deferred<CloudResponse>()];
    let active = 0,
      maximum = 0,
      puts = 0,
      aborts = 0;
    const ordinary = h.deps.send;
    h.deps.send = (request) => {
      if (request.method !== "PUT") return ordinary(request);
      h.calls.push(request);
      active++;
      maximum = Math.max(maximum, active);
      const task = pending[puts++]!;
      return {
        done: task.promise.finally(() => {
          active--;
        }),
        abort: () => {
          aborts++;
        },
      };
    };
    const task = h.upload();
    let settled = false,
      rejection: unknown;
    const result = task.done.then(
      () => {
        settled = true;
      },
      (error: unknown) => {
        rejection = error;
        settled = true;
      },
    );
    try {
      await vi.waitFor(() => expect(puts).toBe(2));
      expect(maximum).toBe(2);
      expect(active).toBe(2);
      expect(h.progress.mock.calls).toEqual([[0]]);
      task.abort();
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(aborts).toBeGreaterThanOrEqual(2);
      pending[0]!.resolve(response("", { ETag: h.record().digests[0]! }));
      await Promise.resolve();
      expect(settled).toBe(false);
      pending[1]!.resolve(response("", { ETag: h.record().digests[1]! }));
      await result;
      expect(rejection).toBeInstanceOf(Error);
      expect(active).toBe(0);
      expect(puts).toBe(2);
      expect(h.progress.mock.calls).toEqual([[0]]);
      expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    } finally {
      task.abort();
      pending.forEach((item) => item.resolve(response("")));
      await result;
    }
  });

  it("停止在本地read中：等待迟到读取结束，随后不持久化、不发送、不进度", async () => {
    const h = harness(),
      read = deferred<Uint8Array>();
    h.deps.read = vi.fn(() => read.promise);
    const task = h.upload();
    let settled = false,
      rejection: unknown;
    const result = task.done.then(
      () => {
        settled = true;
      },
      (error: unknown) => {
        rejection = error;
        settled = true;
      },
    );
    try {
      await vi.waitFor(() => expect(h.deps.read).toHaveBeenCalledOnce());
      task.abort();
      await Promise.resolve();
      expect(settled).toBe(false);
      read.resolve(h.data.subarray(0, CHUNK));
      await result;
      expect(rejection).toBeInstanceOf(Error);
      expect(h.deps.send).not.toHaveBeenCalled();
      expect(h.progress).not.toHaveBeenCalled();
      expect(h.values.has(StorageKey.uploadResume)).toBe(false);
    } finally {
      read.resolve(h.data.subarray(0, CHUNK));
      task.abort();
      await result;
    }
  });

  it.each(["userId", "memberId", "entityId", "storeId", "role", "storeScope"] as const)(
    "%s在read后变化，独立完整owner复查拒绝迟到结果",
    async (field) => {
      const h = harness(),
        read = deferred<Uint8Array>();
      h.deps.read = vi.fn(() => read.promise);
      const task = h.upload(),
        settled = Promise.allSettled([task.done]);
      try {
        await vi.waitFor(() => expect(h.deps.read).toHaveBeenCalledOnce());
        h.owner({ ...OWNER, [field]: "changed" });
        read.resolve(h.data.subarray(0, CHUNK));
        const [result] = await settled;
        expect(result).toMatchObject({
          status: "rejected",
          reason: { message: expect.stringContaining("归属") },
        });
        expect(h.deps.send).not.toHaveBeenCalled();
        expect(h.progress).not.toHaveBeenCalled();
        expect(h.values.has(StorageKey.uploadResume)).toBe(false);
      } finally {
        read.resolve(h.data.subarray(0, CHUNK));
        task.abort();
        await settled;
      }
    },
  );

  it.each(["initiate", "complete"] as const)(
    "%s回执未知保留phase，重开实例不盲目新建UploadId",
    async (mode) => {
      const h = harness(),
        ordinary = h.route;
      h.route = async (request) => {
        if (
          request.method === "POST" &&
          new URL(request.url).searchParams.has(mode === "initiate" ? "uploads" : "uploadId")
        )
          throw new Error("响应已丢失");
        return ordinary(request);
      };
      await expect(h.upload().done).rejects.toMatchObject({
        recovery: mode === "initiate" ? "initiate_unknown" : "complete_unknown",
      });
      const record = h.resume.load(OWNER, TOKEN)!;
      expect(record).toMatchObject({
        phase: mode === "initiate" ? "initiating" : "completing",
        confirmKey: CONFIRM,
      });
      const before = h.calls.length,
        reopened = createMultipartPort(h.deps);
      if (mode === "initiate") {
        await expect(
          reopened.upload(h.grant, h.file, TOKEN, CONFIRM, h.progress, h.check).done,
        ).rejects.toBeInstanceOf(MultipartUncertainError);
        expect(h.calls).toHaveLength(before);
      } else {
        h.route = async () => response("<Error><Code>NoSuchUpload</Code></Error>", {}, 404);
        await reopened.upload(h.grant, h.file, TOKEN, CONFIRM, h.progress, h.check).done;
        expect(h.calls.slice(before).map((call) => call.method)).toEqual(["GET"]);
        expect(h.resume.load(OWNER, TOKEN)?.phase).toBe("completing");
      }
      expect(h.calls.filter((c) => new URL(c.url).searchParams.has("uploads"))).toHaveLength(1);
    },
  );

  it.each(["fileId", "bucket", "region", "key", "chunkSize"] as const)(
    "续签%s改变归属即停止，不发送COS",
    async (field) => {
      const h = harness();
      h.grant.expiresAt = new Date(NOW).toISOString();
      const fresh = {
        ...h.grant,
        expiresAt: new Date(NOW + 1800_000).toISOString(),
        [field]: field === "chunkSize" ? CHUNK * 2 : "foreign",
      };
      h.deps.refresh = vi.fn(async () => fresh as Registration);
      await expect(h.upload().done).rejects.toThrow();
      expect(h.deps.refresh).toHaveBeenCalledExactlyOnceWith(ID);
      expect(h.deps.send).not.toHaveBeenCalled();
      expect(h.resume.load(OWNER, TOKEN)?.phase).toBe("initiating");
    },
  );

  it("持久化未读回不开始initiate；forget只清本file的完整归属记录", async () => {
    const h = harness();
    h.storage.set = () => {};
    await expect(h.upload().done).rejects.toThrow("保存");
    expect(h.deps.send).not.toHaveBeenCalled();
    const other = harness();
    other.resume.save(other.record());
    other.port.forget("unrelated");
    expect(other.resume.load(OWNER, TOKEN)).not.toBeNull();
    other.port.forget(ID);
    expect(other.resume.load(OWNER, TOKEN)).toBeNull();
  });
});
