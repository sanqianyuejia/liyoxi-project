// 上传构件的校验与状态（D7 第 5.3 节 UploadField）：类型、大小校验；上传函数由调用方注入；失败可重试。
// 真实的直传（登记 → 预签名 → 确认）在 W1-07，由页面把上传函数传进来；本包不认识存储。

export interface UploadRule {
  /** 允许的类型：MIME（image/png、image/*）或扩展名（.pdf） */
  accept: readonly string[];
  /** 单个文件上限，单位 MB */
  maxSizeMb: number;
}

/** 校验要用到的文件信息：File 满足它，用例里也可以只给这三项 */
export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export type UploadFn<F extends FileLike = File> = (
  file: F,
  hooks: { onProgress: (percent: number) => void },
) => Promise<{ fileId: string }>;

const BYTES_PER_MB = 1024 * 1024;

function matchesAccept(file: FileLike, pattern: string): boolean {
  const rule = pattern.trim().toLowerCase();
  if (rule.startsWith(".")) return file.name.toLowerCase().endsWith(rule);
  const type = file.type.toLowerCase();
  if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
  return type === rule;
}

/** 不合规返回给操作人看的原因；合规返回 null */
export function validateUploadFile(file: FileLike, rule: UploadRule): string | null {
  if (!rule.accept.some((pattern) => matchesAccept(file, pattern))) {
    return `文件类型不支持，请上传 ${describeAccept(rule.accept)}`;
  }
  if (file.size > rule.maxSizeMb * BYTES_PER_MB) {
    return `文件超过 ${rule.maxSizeMb}MB，请压缩后重新上传`;
  }
  if (file.size === 0) return "文件是空的，请重新选择";
  return null;
}

/** 允许的类型写成给人看的一句：“PNG、JPG、PDF” */
export function describeAccept(accept: readonly string[]): string {
  return accept
    .map((pattern) => {
      const rule = pattern.trim().toLowerCase();
      if (rule.startsWith(".")) return rule.slice(1).toUpperCase();
      if (rule === "image/*") return "图片";
      if (rule === "video/*") return "视频";
      if (rule === "image/jpeg") return "JPG";
      return (rule.split("/")[1] ?? rule).toUpperCase();
    })
    .join("、");
}

export type UploadTaskState<F extends FileLike = File> =
  | { status: "idle" }
  | { status: "rejected"; reason: string }
  | { status: "uploading"; file: F; percent: number }
  | { status: "failed"; file: F; reason: string }
  | { status: "done"; file: F; fileId: string };

export interface UploadTask<F extends FileLike = File> {
  getState(): UploadTaskState<F>;
  /** 选了一个文件：先校验，合规才上传 */
  start(file: F): Promise<UploadTaskState<F>>;
  /** 失败后重试：用同一个文件再传一次 */
  retry(): Promise<UploadTaskState<F>>;
  /** 清掉当前文件（替换前、移除时） */
  reset(): void;
}

/** 一个上传位的状态机。onChange 在每次状态变化时调 */
export function createUploadTask<F extends FileLike = File>(options: {
  rule: UploadRule;
  upload: UploadFn<F>;
  onChange?: (state: UploadTaskState<F>) => void;
}): UploadTask<F> {
  let state: UploadTaskState<F> = { status: "idle" };
  /** 每次开始上传加一：旧的一次晚到的进度与结果不再改状态 */
  let generation = 0;

  const set = (next: UploadTaskState<F>): UploadTaskState<F> => {
    state = next;
    options.onChange?.(state);
    return state;
  };

  const run = async (file: F): Promise<UploadTaskState<F>> => {
    generation += 1;
    const mine = generation;
    set({ status: "uploading", file, percent: 0 });
    try {
      const { fileId } = await options.upload(file, {
        onProgress: (percent) => {
          if (mine !== generation) return;
          set({
            status: "uploading",
            file,
            percent: Math.min(100, Math.max(0, Math.round(percent))),
          });
        },
      });
      return mine === generation ? set({ status: "done", file, fileId }) : state;
    } catch (error) {
      if (mine !== generation) return state;
      const reason = error instanceof Error && error.message ? error.message : "上传失败，请重试";
      return set({ status: "failed", file, reason });
    }
  };

  return {
    getState: () => state,
    start(file) {
      const reason = validateUploadFile(file, options.rule);
      if (reason !== null) {
        generation += 1;
        return Promise.resolve(set({ status: "rejected", reason }));
      }
      return run(file);
    },
    retry() {
      if (state.status !== "failed") return Promise.resolve(state);
      return run(state.file);
    },
    reset() {
      generation += 1;
      set({ status: "idle" });
    },
  };
}
