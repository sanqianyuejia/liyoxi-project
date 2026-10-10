import type { UploadBatchItemView } from "@liyoxi/contract";
import { Alert, Button, Checkbox, Input, Modal, Radio, Select } from "antd";
import { useMemo, useState, useSyncExternalStore, useEffect } from "react";
import { FormField } from "../../../components/FormField";
import { createBatchSession } from "../../delivery/ticket-detail/batch-upload";
import { ItemRow } from "../../delivery/ticket-detail/batch-upload-modal";
import {
  batchStateLabel,
  canStart,
  selectionProblem,
  type BatchSelection,
} from "../../delivery/ticket-detail/batch-model";
import type { DramaApi, DramaDetail } from "./api";
import { contentError } from "./api";
import { createContentIntent } from "./model";
import "../../delivery/ticket-detail/batch-upload.css";

export function MasterBatchDialog({
  api,
  drama,
  openBatches,
  onClose,
  onRefresh,
}: {
  api: DramaApi;
  drama: DramaDetail;
  openBatches: Awaited<ReturnType<DramaApi["readiness"]>>["openUploadBatches"];
  onClose(): void;
  onRefresh(): void;
}) {
  const session = useMemo(
    () =>
      createBatchSession({
        api: api.batches,
        targetId: drama.dramaId,
        purpose: "drama_master",
        fileStatus: api.fileStatus,
      }),
    [api, drama.dramaId],
  );
  const { runtime, snapshot, progress } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const [selection, setSelection] = useState<BatchSelection[]>([]);
  const [scope, setScope] = useState<"full" | "partial">("full");
  const [reason, setReason] = useState<"quality_fix" | "license_info_fix" | "other">("quality_fix");
  const [changed, setChanged] = useState(false);
  const [note, setNote] = useState("");
  const [sequence, setSequence] = useState(false);
  const [original, setOriginal] = useState(false);
  const [error, setError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitIntent] = useState(() => createContentIntent("master-commit"));
  const [, redraw] = useState(0);
  useEffect(() => {
    commitIntent.activate();
    return () => commitIntent.close();
  }, [commitIntent]);
  const alive = () => runtime !== undefined && session.getSnapshot().runtime === runtime;
  const batch = snapshot.batch;
  const busy = snapshot.pending || committing;
  const fail = (failure: unknown) => {
    if (alive()) setError(contentError(failure));
  };
  const attach = (file: File) => {
    if (!runtime || !batch) return;
    try {
      if (!original) throw new Error("请先确认选择未经修改的同一原始文件");
      const problem = selectionProblem([file], "drama_master");
      if (problem) throw new Error(problem);
      runtime.uploader.attach(batch, [file], false);
      setError(undefined);
      redraw((v) => v + 1);
    } catch (failure) {
      fail(failure);
    }
  };
  async function replace(item: UploadBatchItemView, file: File) {
    if (!runtime) return;
    const problem = selectionProblem([file], "drama_master");
    if (problem) {
      setError(problem);
      return;
    }
    const updated = await runtime.model.update(item.uploadBatchItemId, {
      replacementFile: {
        clientToken: crypto.randomUUID(),
        originalName: file.name,
        sizeBytes: String(file.size),
      },
    });
    if (updated && alive()) {
      try {
        runtime.uploader.attach(updated, [file], true);
        redraw((v) => v + 1);
      } catch (failure) {
        fail(failure);
      }
    }
  }
  async function start() {
    if (!runtime || !batch || !canStart(batch, sequence)) return;
    const updated = await runtime.model.start(sequence);
    if (updated && alive()) {
      try {
        runtime.uploader.attach(
          updated,
          selection.map((v) => v.file),
          true,
        );
      } catch (failure) {
        fail(failure);
      }
    }
  }
  async function upload() {
    if (!runtime || uploading) return;
    setUploading(true);
    setError(undefined);
    try {
      await runtime.uploader.run();
    } catch (failure) {
      fail(failure);
    } finally {
      if (alive()) setUploading(false);
    }
  }
  async function commit() {
    if (!batch || batch.state !== "ready" || !batch.actions.includes("commit") || busy) return;
    setCommitting(true);
    setError(undefined);
    try {
      const result = await commitIntent.submit({ id: batch.uploadBatchId }, (key, signal) =>
        api.batches.commit(batch.uploadBatchId, key, signal),
      );
      if (result && alive()) {
        onRefresh();
        onClose();
      }
    } catch (failure) {
      fail(failure);
    } finally {
      if (alive()) setCommitting(false);
    }
  }
  const problem = selectionProblem(
    selection.map((row) => row.file),
    "drama_master",
  );
  return (
    <Modal
      open
      title="上传 / 替换原片"
      width={860}
      footer={null}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <div className="lyx-production-form lyx-batch-form">
        <p>
          {drama.title} · 总集数 {drama.totalEpisodes ?? "未填写"} ·{" "}
          {drama.isAiGenerated ? "原片为 AI 制作" : "原片非 AI 制作"}
        </p>
        {!batch ? (
          <>
            {openBatches.length ? (
              <FormField label="恢复已有原片批次">
                {(field) => (
                  <Select
                    {...field}
                    placeholder="选择本剧未结束批次"
                    disabled={busy}
                    options={openBatches.map((v) => ({
                      value: v.uploadBatchId,
                      label: `${batchStateLabel(v.state)} · ${v.createdBy.name} · ${v.expiresAt}`,
                    }))}
                    onChange={(id: string) => void runtime?.model.open(id)}
                  />
                )}
              </FormField>
            ) : null}
            <FormField label="上传范围">
              {(field) => (
                <Radio.Group
                  {...field}
                  value={scope}
                  disabled={busy}
                  onChange={(e) => setScope(e.target.value === "partial" ? "partial" : "full")}
                >
                  <Radio value="full">整部</Radio>
                  <Radio value="partial" disabled={drama.episodeSummary.withCurrentMaster === 0}>
                    部分集替换
                  </Radio>
                </Radio.Group>
              )}
            </FormField>
            {drama.episodeSummary.withCurrentMaster > 0 ? (
              <>
                <FormField label="替换原因">
                  {(field) => (
                    <Select
                      {...field}
                      value={reason}
                      disabled={busy}
                      onChange={(value) => {
                        setReason(value);
                        if (value === "license_info_fix") setChanged(true);
                      }}
                      options={[
                        { value: "quality_fix", label: "画质修复" },
                        { value: "license_info_fix", label: "片头许可信息更正" },
                        { value: "other", label: "其他" },
                      ]}
                    />
                  )}
                </FormField>
                <Checkbox
                  checked={changed}
                  disabled={busy}
                  onChange={(e) => setChanged(e.target.checked)}
                >
                  内容有实质变更（须重新核验许可信息）
                </Checkbox>
              </>
            ) : null}
            <FormField label="说明" value={note} maxLength={200}>
              {(field) => (
                <Input.TextArea
                  {...field}
                  value={note}
                  disabled={busy}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </FormField>
            <FormField label="选择原片文件">
              {(field) => (
                <input
                  {...field}
                  type="file"
                  accept=".mp4,.mov"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    setSelection(
                      Array.from(e.target.files ?? []).map((file) => ({
                        file,
                        clientToken: crypto.randomUUID(),
                      })),
                    );
                    e.target.value = "";
                  }}
                />
              )}
            </FormField>
            <p>不支持 ZIP。首次整部必须完整覆盖所有集号；原片批次不提交成片制作声明。</p>
            {selection.map((v) => (
              <p key={v.clientToken}>
                {v.file.name} · {v.file.size} 字节
              </p>
            ))}
            {selection.length && problem ? <Alert type="error" title={problem} /> : null}
            <Button
              type="primary"
              disabled={busy || !!problem || !drama.totalEpisodes}
              onClick={() =>
                void runtime?.model.create({
                  purpose: "drama_master",
                  targetId: drama.dramaId,
                  scope,
                  replaceReason: drama.episodeSummary.withCurrentMaster > 0 ? reason : null,
                  isContentChanged: changed,
                  note: note.trim() || null,
                  aiUsage: null,
                  files: selection.map((v) => ({
                    clientToken: v.clientToken,
                    originalName: v.file.name,
                    sizeBytes: String(v.file.size),
                  })),
                })
              }
            >
              建立批次并核对集号
            </Button>
          </>
        ) : (
          <>
            <h3>{batchStateLabel(batch.state)}</h3>
            <p>
              要求 {batch.expectedCount} 集 · 文件 {batch.counts.total} · 已上传{" "}
              {batch.counts.uploaded} · 体检通过 {batch.counts.checked} · 拒收{" "}
              {batch.counts.rejected}
            </p>
            <p>
              缺集：{batch.coverage.missingEpisodeNos.join("、") || "无"} · 重复集：
              {batch.coverage.duplicateEpisodeNos.join("、") || "无"} · 未匹配{" "}
              {batch.coverage.unmatchedItemIds.length}
            </p>
            {batch.coverage.needsSequenceConfirm ? (
              <Checkbox
                checked={sequence}
                disabled={busy}
                onChange={(e) => setSequence(e.target.checked)}
              >
                我已逐集核对顺序建议
              </Checkbox>
            ) : null}
            <Checkbox
              checked={original}
              disabled={busy}
              onChange={(e) => setOriginal(e.target.checked)}
            >
              续传重新选择的是未经修改的原始文件
            </Checkbox>
            {batch.items.map((item) => (
              <ItemRow
                key={item.uploadBatchItemId}
                item={item}
                batch={batch}
                progress={progress[item.uploadBatchItemId]}
                busy={busy}
                hasFile={runtime?.uploader.hasFile(item.uploadBatchItemId) ?? false}
                onNumber={(episodeNo) =>
                  void runtime?.model.update(item.uploadBatchItemId, { episodeNo })
                }
                onSkip={() => void runtime?.model.update(item.uploadBatchItemId, { skip: true })}
                onAttach={attach}
                onReplace={(file) => void replace(item, file)}
              />
            ))}
            <div className="lyx-production-actions">
              {batch.state === "matching" ? (
                <Button
                  type="primary"
                  disabled={!canStart(batch, sequence) || busy}
                  onClick={() => void start()}
                >
                  确认匹配并开始
                </Button>
              ) : null}
              {batch.state === "uploading" ? (
                <Button
                  type="primary"
                  loading={uploading}
                  disabled={busy}
                  onClick={() => void upload()}
                >
                  上传 / 继续上传
                </Button>
              ) : null}
              <Button disabled={busy} onClick={() => void runtime?.model.refresh()}>
                刷新服务器状态
              </Button>
              {batch.actions.includes("cancel") ? (
                <Button danger disabled={busy} onClick={() => void runtime?.model.cancel()}>
                  取消批次
                </Button>
              ) : null}
              {batch.state === "ready" && batch.actions.includes("commit") ? (
                <Button
                  type="primary"
                  loading={committing}
                  disabled={busy}
                  onClick={() => void commit()}
                >
                  提交原片批次
                </Button>
              ) : null}
            </div>
            <p>直传完成仍须等待服务器体检；只有提交成功才切换本剧当前原片。</p>
          </>
        )}
        {snapshot.error || error ? <Alert type="error" title={error ?? snapshot.error} /> : null}
        {snapshot.pollingPaused ? (
          <Alert type="warning" title="自动查询已暂停，请手动刷新重试" />
        ) : null}
        <div className="lyx-confirm__footer">
          <Button size="large" disabled={busy} onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  );
}
