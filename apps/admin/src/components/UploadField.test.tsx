// 上传构件的用例（任务书 第 7 节第 8 条）：校验类型与大小；上传函数由调用方注入；失败可重试。
// 选文件、点“重试”的操作由冒烟覆盖；这里断言校验、状态机与初始结构。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  createUploadTask,
  describeAccept,
  validateUploadFile,
  type FileLike,
  type UploadFn,
  type UploadRule,
  type UploadTaskState,
} from "../lib/upload";

import { toUploadList, UploadField } from "./UploadField";

const MB = 1024 * 1024;
const rule: UploadRule = { accept: ["image/png", "image/jpeg", ".pdf"], maxSizeMb: 10 };
const png: FileLike = { name: "营业执照.png", type: "image/png", size: 2 * MB };

describe("校验类型与大小", () => {
  it("类型：MIME、通配、扩展名三种写法；不在清单里的拒收并说明能传什么", () => {
    expect(validateUploadFile(png, rule)).toBeNull();
    expect(validateUploadFile({ name: "回单.PDF", type: "", size: MB }, rule)).toBeNull();
    expect(
      validateUploadFile(
        { name: "a.gif", type: "image/gif", size: MB },
        { accept: ["image/*"], maxSizeMb: 10 },
      ),
    ).toBeNull();
    expect(validateUploadFile({ name: "说明.txt", type: "text/plain", size: 10 }, rule)).toBe(
      "文件类型不支持，请上传 PNG、JPG、PDF",
    );
    expect(validateUploadFile({ name: "片子.mp4", type: "video/mp4", size: MB }, rule)).toMatch(
      /文件类型不支持/,
    );
    expect(describeAccept(["image/*", "video/*", ".pdf"])).toBe("图片、视频、PDF");
  });

  it("大小：超过上限拒收；正好等于上限放行；空文件拒收", () => {
    expect(validateUploadFile({ ...png, size: 10 * MB + 1 }, rule)).toBe(
      "文件超过 10MB，请压缩后重新上传",
    );
    expect(validateUploadFile({ ...png, size: 10 * MB }, rule)).toBeNull();
    expect(validateUploadFile({ ...png, size: 0 }, rule)).toBe("文件是空的，请重新选择");
  });
});

describe("上传函数由调用方注入，失败可重试", () => {
  it("不合规的文件不调上传函数", async () => {
    const upload = vi.fn<UploadFn<FileLike>>();
    const task = createUploadTask({ rule, upload });
    const state = await task.start({ name: "说明.txt", type: "text/plain", size: 10 });
    expect(state).toEqual({ status: "rejected", reason: "文件类型不支持，请上传 PNG、JPG、PDF" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("传成功：经过上传中（带进度）到完成，拿到调用方给的 fileId", async () => {
    const seen: UploadTaskState<FileLike>[] = [];
    const upload = vi.fn<UploadFn<FileLike>>(async (_file, { onProgress }) => {
      onProgress(40);
      onProgress(120);
      return { fileId: "f-1" };
    });
    const task = createUploadTask({ rule, upload, onChange: (state) => seen.push(state) });
    const final = await task.start(png);
    expect(upload).toHaveBeenCalledWith(
      png,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(final).toEqual({ status: "done", file: png, fileId: "f-1" });
    expect(
      seen.map((state) =>
        state.status === "uploading" ? `uploading:${state.percent}` : state.status,
      ),
    ).toEqual(["uploading:0", "uploading:40", "uploading:100", "done"]);
  });

  it("传失败：停在失败态并带原因；重试用同一个文件再调一次上传函数，成功后完成", async () => {
    let attempt = 0;
    const upload = vi.fn<UploadFn<FileLike>>(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("网络中断，请重试");
      return { fileId: "f-2" };
    });
    const task = createUploadTask({ rule, upload });
    expect(await task.start(png)).toEqual({
      status: "failed",
      file: png,
      reason: "网络中断，请重试",
    });
    expect(await task.retry()).toEqual({ status: "done", file: png, fileId: "f-2" });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1]?.[0]).toBe(png);
    // 不在失败态时重试什么都不做
    expect(await task.retry()).toEqual({ status: "done", file: png, fileId: "f-2" });
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("替换或移除后，旧的一次晚到的结果不再改状态", async () => {
    let finish: (value: { fileId: string }) => void = () => {};
    const upload = vi.fn<UploadFn<FileLike>>(() => new Promise((resolve) => (finish = resolve)));
    const task = createUploadTask({ rule, upload });
    const first = task.start(png);
    task.reset();
    finish({ fileId: "late" });
    await first;
    expect(task.getState()).toEqual({ status: "idle" });
  });
});

describe("结构", () => {
  const upload: UploadFn = () => Promise.resolve({ fileId: "f" });

  it("上传区是一个按钮，下面写能传什么、多大；文件选择框带 accept", () => {
    const html = renderToStaticMarkup(
      <UploadField rule={rule} upload={upload} onChange={() => {}} text="点击上传营业执照" />,
    );
    expect(html).toContain("点击上传营业执照");
    expect(html).toContain("支持 PNG、JPG、PDF，单个文件不超过 10MB");
    expect(html).toContain('accept="image/png,image/jpeg,.pdf"');
    expect(html).toContain('type="file"');
  });

  it("状态 → 上传列表的一行：上传中带进度、失败是 error、完成是 done；没有文件时为空", () => {
    const file = new File(["x"], "执照.png", { type: "image/png" });
    expect(toUploadList({ status: "idle" })).toEqual([]);
    expect(toUploadList({ status: "rejected", reason: "x" })).toEqual([]);
    expect(toUploadList({ status: "uploading", file, percent: 60 })).toMatchObject([
      { name: "执照.png", status: "uploading", percent: 60 },
    ]);
    expect(toUploadList({ status: "failed", file, reason: "断了" })).toMatchObject([
      { status: "error" },
    ]);
    expect(toUploadList({ status: "done", file, fileId: "f" })).toMatchObject([{ status: "done" }]);
  });
});
