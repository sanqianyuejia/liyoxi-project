// 上传构件（D7 第 5.3 节 UploadField；规范 第 5.3 节“上传区”）：图片、PDF 等单个文件。
// 类型与大小在选文件时校验；上传函数由调用方注入；失败可重试、已传可替换。
// 上传中、失败、已传的样子按 Ant Design 上传组件的默认表现（规范原话），上传区是通栏高 64 的虚线框。
// 批量视频上传（BatchUploader）在 M3，不在本构件。
import { Upload, type UploadFile } from "antd";
import { useMemo, useState } from "react";

import {
  createUploadTask,
  describeAccept,
  type UploadFn,
  type UploadRule,
  type UploadTaskState,
} from "../lib/upload";

import { Icon } from "./Icon";

export interface UploadFieldProps {
  rule: UploadRule;
  /** 由调用方注入：登记、直传、确认都在它里面（W1-07 提供真实实现） */
  upload: UploadFn;
  /** 传完或移除时回调：fileId，或 null */
  onChange: (fileId: string | null) => void;
  /** 上传区里的字，缺省“点击上传” */
  text?: string;
  disabled?: boolean;
  /** 替换失败时保留调用方当前引用，仅成功或明确移除已上传文件时更改。 */
  preserveValueOnFailure?: boolean;
  onStateChange?: (state: UploadTaskState) => void;
}

const UID = "lyx-upload-file";

/** 状态 → antd 上传列表的一行；没有文件时为空 */
export function toUploadList(state: UploadTaskState): UploadFile[] {
  switch (state.status) {
    case "uploading":
      return [{ uid: UID, name: state.file.name, status: "uploading", percent: state.percent }];
    case "failed":
      return [{ uid: UID, name: state.file.name, status: "error", response: state.reason }];
    case "done":
      return [{ uid: UID, name: state.file.name, status: "done" }];
    default:
      return [];
  }
}

export function UploadField({
  rule,
  upload,
  onChange,
  text,
  disabled,
  preserveValueOnFailure = false,
  onStateChange,
}: UploadFieldProps) {
  const [state, setState] = useState<UploadTaskState>({ status: "idle" });
  const task = useMemo(
    () =>
      createUploadTask({
        rule,
        upload,
        onChange: (next) => {
          setState(next);
          onStateChange?.(next);
        },
      }),
    [rule, upload, onStateChange],
  );
  const report = (final: UploadTaskState): void => {
    if (final.status === "done") onChange(final.fileId);
    else if (!preserveValueOnFailure) onChange(null);
  };

  const busy = state.status === "uploading";
  const hint = `支持 ${describeAccept(rule.accept)}，单个文件不超过 ${rule.maxSizeMb}MB`;

  return (
    <div className="lyx-upload">
      <Upload
        accept={rule.accept.join(",")}
        maxCount={1}
        disabled={disabled || busy}
        fileList={toUploadList(state)}
        // 不走 antd 自己的请求：校验与上传都交给状态机
        beforeUpload={(file) => {
          if (!preserveValueOnFailure) onChange(null);
          void task.start(file).then(report);
          return false;
        }}
        onRemove={() => {
          const removeReference = !preserveValueOnFailure || state.status === "done";
          task.reset();
          if (removeReference) onChange(null);
          return true;
        }}
        showUploadList={{
          showRemoveIcon: !busy && !disabled,
          extra: ({ status }) =>
            status === "error" ? (
              <button
                type="button"
                disabled={disabled}
                className="lyx-link"
                onClick={() => void task.retry().then(report)}
              >
                重试
              </button>
            ) : null,
        }}
      >
        <button
          type="button"
          className="lyx-upload__zone lyx-focusable"
          disabled={disabled || busy}
        >
          <Icon name="upload" size={16} />
          <span>
            {busy
              ? state.percent >= 90
                ? "正在处理文件…"
                : "上传中…"
              : state.status === "done"
                ? "重新上传（替换）"
                : (text ?? "点击上传")}
          </span>
        </button>
      </Upload>
      {state.status === "rejected" ? (
        <div className="lyx-upload__error" role="alert">
          {state.reason}
        </div>
      ) : state.status === "failed" ? (
        <div className="lyx-upload__error" role="alert">
          {state.reason}
        </div>
      ) : (
        <div className="lyx-upload__hint">{hint}</div>
      )}
    </div>
  );
}
