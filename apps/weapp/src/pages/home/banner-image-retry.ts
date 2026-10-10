export interface BannerImageDownloadDetails {
  readonly storageError?: string;
  readonly server?: string;
  readonly contentType?: string;
}

export interface BannerImageDownloadResult {
  readonly statusCode: number;
  readonly tempFilePath?: string;
  readonly details?: BannerImageDownloadDetails;
}

export interface BannerImageDownload {
  readonly promise: Promise<BannerImageDownloadResult>;
  abort(): void;
}

export interface BannerImageRetryResult {
  readonly statusCode?: number;
  readonly error?: unknown;
  readonly details?: BannerImageDownloadDetails;
}

/** One fallback download per activation; a disposed task cannot update a new activation. */
export function createBannerImageRetry({
  source,
  download,
  onReady,
  onResult,
}: {
  source: string;
  download(source: string): BannerImageDownload;
  onReady(path: string): void;
  onResult(result: BannerImageRetryResult): void;
}) {
  let active = false;
  let generation = 0;
  let attempted = false;
  let pending: BannerImageDownload | undefined;

  const abort = (task: BannerImageDownload | undefined) => {
    try {
      task?.abort();
    } catch {
      // Native cancellation errors must not revive a disposed task or interrupt cleanup.
    }
  };
  const report = (result: BannerImageRetryResult) => {
    try {
      onResult(result);
    } catch {
      // Diagnostic callbacks cannot stop a valid image from becoming ready.
    }
  };

  return {
    activate() {
      if (active) return;
      active = true;
      generation++;
      attempted = false;
    },
    retry() {
      if (!active || attempted) return;
      attempted = true;
      const requestedGeneration = generation;
      const isCurrent = () => active && generation === requestedGeneration;
      const fail = (error: unknown) => {
        if (!isCurrent()) return;
        pending = undefined;
        report({ error });
      };
      try {
        const task = download(source);
        if (isCurrent()) pending = task;
        else abort(task);
        void task.promise.then((result) => {
          if (!isCurrent()) return;
          pending = undefined;
          report({
            statusCode: result.statusCode,
            ...(result.details === undefined ? {} : { details: result.details }),
          });
          if (!isCurrent() || result.statusCode !== 200 || !result.tempFilePath?.trim()) return;
          try {
            onReady(result.tempFilePath);
          } catch {
            // A consumer callback must not create an unhandled promise rejection.
          }
        }, fail);
      } catch (error) {
        fail(error);
      }
    },
    dispose() {
      active = false;
      generation++;
      const task = pending;
      pending = undefined;
      abort(task);
    },
  };
}
