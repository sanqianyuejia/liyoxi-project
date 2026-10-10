import type {
  BannerImageDownload,
  BannerImageDownloadDetails,
  BannerImageDownloadResult,
} from "./banner-image-retry";

export interface BannerImageRequestResult {
  readonly statusCode: number;
  readonly data: ArrayBuffer;
  readonly server?: string;
  readonly contentType?: string;
}

export interface BannerImageRequest {
  readonly promise: Promise<BannerImageRequestResult>;
  abort(): void;
}

function storageError(data: ArrayBuffer) {
  if (!(data instanceof ArrayBuffer)) return undefined;
  const bytes = new Uint8Array(data, 0, Math.min(data.byteLength, 4096));
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text.match(/<Code>\s*([A-Za-z0-9_]{1,80})\s*<\/Code>/)?.[1];
}

function responseDetails(result: BannerImageRequestResult) {
  const code = result.statusCode === 200 ? undefined : storageError(result.data);
  const details: BannerImageDownloadDetails = {
    ...(result.server === undefined ? {} : { server: result.server }),
    ...(result.contentType === undefined ? {} : { contentType: result.contentType }),
    ...(code === undefined ? {} : { storageError: code }),
  };
  return Object.keys(details).length ? { details } : {};
}

/** Requests keep their original signed URL; only this instance owns the files it writes. */
export function createBannerImageRequester({
  request,
  write,
  remove,
}: {
  request(source: string): BannerImageRequest;
  write(bytes: ArrayBuffer, contentType?: string): string;
  remove(path: string): void;
}) {
  let active = true;
  let generation = 0;
  const tasks = new Set<() => void>();
  const files = new Set<string>();
  const abortRequest = (task: BannerImageRequest | undefined) => {
    try {
      task?.abort();
    } catch {
      // The wrapper is already invalid, even if native cancellation fails.
    }
  };
  const removeFile = (path: string) => {
    try {
      remove(path);
    } catch {
      // One missing or inaccessible file must not interrupt the remaining cleanup.
    }
  };

  return {
    activate() {
      if (active) return;
      active = true;
      generation++;
    },
    download(source: string): BannerImageDownload {
      const requestedGeneration = generation;
      let settled = false;
      let task: BannerImageRequest | undefined;
      let resolve!: (result: BannerImageDownloadResult) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<BannerImageDownloadResult>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      const isCurrent = () => active && generation === requestedGeneration && !settled;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        tasks.delete(abort);
        reject(error);
      };
      const abort = () => {
        if (settled) return;
        fail(new Error("Banner image request aborted"));
        abortRequest(task);
      };
      const succeed = (result: BannerImageDownloadResult) => {
        if (!isCurrent()) return;
        settled = true;
        tasks.delete(abort);
        resolve(result);
      };

      if (!active) {
        fail(new Error("Banner image requester is inactive"));
        return { promise, abort };
      }
      tasks.add(abort);
      try {
        task = request(source);
        if (!isCurrent()) abortRequest(task);
        void task.promise.then(
          (result) => {
            if (!isCurrent()) return;
            try {
              const details = responseDetails(result);
              if (result.statusCode !== 200) {
                succeed({ statusCode: result.statusCode, ...details });
                return;
              }
              if (!(result.data instanceof ArrayBuffer) || result.data.byteLength === 0)
                throw new Error("Banner image response has no binary data");
              const path = write(result.data, result.contentType);
              if (!path.trim()) throw new Error("Banner image write returned no file path");
              if (!isCurrent()) {
                removeFile(path);
                return;
              }
              files.add(path);
              succeed({ statusCode: result.statusCode, tempFilePath: path, ...details });
            } catch (error) {
              fail(error);
            }
          },
          (error: unknown) => {
            if (isCurrent()) fail(error);
          },
        );
      } catch (error) {
        fail(error);
      }
      return { promise, abort };
    },
    dispose() {
      active = false;
      generation++;
      for (const abort of [...tasks]) abort();
      for (const path of files) removeFile(path);
      files.clear();
    },
  };
}
