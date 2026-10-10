import { Alert, Button, Checkbox, Input, InputNumber, Modal, Progress, Radio, Select } from "antd";
import { useMemo, useState, useSyncExternalStore, type ChangeEvent } from "react";
import type {
  UploadBatchCreateBody,
  UploadBatchDetail,
  UploadBatchItemView,
} from "@liyoxi/contract";
import { FormField } from "../../../components/FormField";
import { Can } from "../../../lib/permissions";
import type { DetailApi, Ticket } from "./api";
import {
  batchStateLabel,
  canConsume,
  canStart,
  itemStateLabel,
  selectionProblem,
  type BatchSelection,
} from "./batch-model";
import { createBatchSession, type BatchFileProgress } from "./batch-upload";
import { useDeliveryWrite } from "./write";
import "./batch-upload.css";

type AiDeclaration = NonNullable<UploadBatchCreateBody["aiUsage"]>;
type Props = { ticket: Ticket; api: DetailApi; onClose(): void; onRefresh(): void };
const plainAi: AiDeclaration = { used: false, tools: [] };

function Declaration({
  value,
  disabled,
  onChange,
}: {
  value: AiDeclaration;
  disabled: boolean;
  onChange(value: AiDeclaration): void;
}) {
  const tool = value.tools[0] ?? { name: "", version: "", usedFor: "" };
  return (
    <>
      <Checkbox
        checked={value.used}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.checked ? { used: true, tools: [tool] } : plainAi)
        }
      >
        制作中使用了 AI 工具
      </Checkbox>
      {value.used ? (
        <div className="lyx-production-two">
          {(["name", "version", "usedFor"] as const).map((key) => (
            <FormField
              key={key}
              label={key === "name" ? "工具名称" : key === "version" ? "工具版本" : "使用用途"}
            >
              {(field) => (
                <Input
                  {...field}
                  value={tool[key]}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({ used: true, tools: [{ ...tool, [key]: event.target.value }] })
                  }
                />
              )}
            </FormField>
          ))}
        </div>
      ) : null}
    </>
  );
}
function Coverage({ batch }: { batch: UploadBatchDetail }) {
  const { coverage, counts } = batch;
  return (
    <>
      <p>
        服务器要求 {batch.expectedCount} 集 · {batch.scope === "full" ? "整部" : "部分集"} ·
        共用广告版本
      </p>
      <p>
        文件 {counts.total} 个 · 已上传 {counts.uploaded} · 体检通过 {counts.checked} · 拒收{" "}
        {counts.rejected} · 跳过 {counts.skipped}
      </p>
      {coverage.missingEpisodeNos.length ? (
        <p>缺集：{coverage.missingEpisodeNos.join("、")}</p>
      ) : null}
      {coverage.duplicateEpisodeNos.length ? (
        <Alert type="warning" title={`集号重复：${coverage.duplicateEpisodeNos.join("、")}`} />
      ) : null}
      {coverage.unmatchedItemIds.length ? (
        <p role="alert">还有 {coverage.unmatchedItemIds.length} 个文件需要指定集号</p>
      ) : null}
      {batch.aiUsage?.forcedByDrama ? (
        <Alert type="info" title="本剧目要求 AI 标识；实际声明与制作留痕以服务器登记为准" />
      ) : null}
    </>
  );
}
export function ItemRow({
  item,
  batch,
  progress,
  busy,
  hasFile,
  onNumber,
  onAttach,
  onReplace,
  onSkip,
}: {
  item: UploadBatchItemView;
  batch: UploadBatchDetail;
  progress?: BatchFileProgress;
  busy: boolean;
  hasFile: boolean;
  onNumber(value: number | null): void;
  onAttach(file: File): void;
  onReplace(file: File): void;
  onSkip(): void;
}) {
  const [number, setNumber] = useState<number | null>(item.episodeNo);
  const historical = item.state === "skipped" || item.state === "replaced";
  const editable =
    !historical && ["matching", "uploading", "verifying", "ready"].includes(batch.state);
  const choose = (event: ChangeEvent<HTMLInputElement>, apply: (file: File) => void) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) apply(file);
  };
  return (
    <section
      className="lyx-production-card lyx-batch-item"
      data-batch-item={item.uploadBatchItemId}
    >
      <strong>{item.originalName}</strong>
      <p>
        {item.sizeBytes} 字节 · {itemStateLabel(item.state)}
        {progress?.busy ? " · 正在直传" : ""}
      </p>
      <div className="lyx-production-actions">
        <FormField label={`文件 ${item.originalName} 集号`}>
          {(field) => (
            <InputNumber
              {...field}
              min={1}
              max={batch.expectedCount}
              precision={0}
              value={number}
              disabled={!editable || busy || progress?.busy}
              onChange={setNumber}
            />
          )}
        </FormField>
        <Button
          disabled={
            !editable ||
            busy ||
            progress?.busy ||
            number === item.episodeNo ||
            (number !== null &&
              (!Number.isInteger(number) || number < 1 || number > batch.expectedCount))
          }
          onClick={() => onNumber(number)}
        >
          修改集号
        </Button>
        {editable && batch.scope === "partial" && ["pending", "rejected"].includes(item.state) ? (
          <Button
            disabled={
              busy ||
              progress?.busy ||
              batch.items.filter((row) => !["skipped", "replaced"].includes(row.state)).length <= 1
            }
            onClick={onSkip}
          >
            跳过此集
          </Button>
        ) : null}
      </div>
      {editable && item.state === "pending" && item.fileStatus === "pending" && !hasFile ? (
        <FormField label={`续传 ${item.originalName} 原始文件`}>
          {(field) => (
            <input
              {...field}
              type="file"
              accept=".mp4,.mov"
              disabled={busy || progress?.busy}
              onChange={(event) => choose(event, onAttach)}
            />
          )}
        </FormField>
      ) : null}
      {editable ? (
        <FormField label={`替换 ${item.originalName}`}>
          {(field) => (
            <input
              {...field}
              type="file"
              accept=".mp4,.mov"
              disabled={busy || progress?.busy}
              onChange={(event) => choose(event, onReplace)}
            />
          )}
        </FormField>
      ) : null}
      {progress ? (
        <Progress
          percent={progress.percent}
          status={progress.error ? "exception" : progress.percent === 100 ? "success" : "active"}
        />
      ) : null}
      {progress?.percent === 100 ? <p>直传与入库已完成；仍以服务器体检结论决定能否登记。</p> : null}
      {progress?.error ? <Alert type="error" title={progress.error} /> : null}
      {item.rejectReason ? <Alert type="error" title={`拒收原因：${item.rejectReason}`} /> : null}
      {item.previousDurationMs !== null || item.durationMs !== null ? (
        <p>
          时长：原 {item.previousDurationMs ?? "未知"} ms → 当前 {item.durationMs ?? "待体检"} ms
        </p>
      ) : null}
      {item.isDurationDiffWarn ? (
        <Alert type="warning" title="时长差异超过 2 秒，请核对是否选错文件" />
      ) : null}
      {item.check?.failedHard.map((check, index) => (
        <p role="alert" key={`${check.code}:${index}`}>
          体检 {check.code}：实际 {String(check.actual)}，要求 {String(check.expected)}
        </p>
      ))}
      {item.check?.warnings.map((warning, index) => (
        <p key={`${warning.code}:${index}`}>{warning.note}</p>
      ))}
    </section>
  );
}

export function BatchUploadModal({ ticket, api, onClose, onRefresh }: Props) {
  const session = useMemo(
    () =>
      createBatchSession({
        api: api.batches,
        targetId: ticket.orderItemId,
        fileStatus: async (id, signal) => {
          const file = await api.fileStatus(id, signal);
          if (file.fileId !== id || typeof file.status !== "string")
            throw new Error("文件状态响应不合格");
          return { fileId: file.fileId, status: file.status };
        },
      }),
    [api, ticket.orderItemId],
  );
  const { runtime, snapshot, progress } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const alive = () => runtime !== undefined && session.getSnapshot().runtime === runtime;
  const [selection, setSelection] = useState<BatchSelection[]>([]);
  const [, updateAttachments] = useState(0);
  const [scope, setScope] = useState<"full" | "partial">("full");
  const [ai, setAi] = useState<AiDeclaration>(plainAi);
  const [sequenceConfirmed, setSequenceConfirmed] = useState(false);
  const [originalConfirmed, setOriginalConfirmed] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const consume = useDeliveryWrite(() => {
    onRefresh();
    onClose();
  });
  const batch = snapshot.batch;
  const busy = snapshot.pending || consume.pending;
  const problem = selectionProblem(selection.map((row) => row.file));
  const aiComplete =
    !ai.used ||
    (ai.tools.length > 0 &&
      ai.tools.every((tool) => tool.name.trim() && tool.version.trim() && tool.usedFor.trim()));
  const fail = (error: unknown) => {
    if (alive()) setLocalError(error instanceof Error ? error.message : "操作失败，请重试");
  };
  const attach = (file: File) => {
    if (!runtime || !batch) return;
    if (!originalConfirmed) {
      setLocalError("请先确认重新选择的是未经修改的同一原始文件");
      return;
    }
    try {
      const problem = selectionProblem([file]);
      if (problem) throw new Error(problem);
      runtime.uploader.attach(batch, [file], false);
      setLocalError(undefined);
      updateAttachments((revision) => revision + 1);
    } catch (error) {
      fail(error);
    }
  };
  const replace = async (item: UploadBatchItemView, file: File) => {
    if (!runtime) return;
    const problem = selectionProblem([file]);
    if (problem) {
      setLocalError(problem);
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
        setLocalError(undefined);
      } catch (error) {
        fail(error);
      }
    }
  };
  const upload = async () => {
    if (!runtime || uploading) return;
    setUploading(true);
    setLocalError(undefined);
    try {
      await runtime.uploader.run();
    } catch (error) {
      fail(error);
    } finally {
      if (alive()) setUploading(false);
    }
  };
  return (
    <Modal
      open
      title="登记成片"
      width={800}
      footer={null}
      onCancel={() => {
        if (!busy) onClose();
      }}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
    >
      <div className="lyx-production-form lyx-batch-form">
        <p>
          {ticket.store.storeName ?? "未命名门店"} · {ticket.dramaTitle} · 工单{" "}
          {ticket.episodeCount} 集
        </p>
        {!batch ? (
          <>
            {ticket.openUploadBatches.length ? (
              <FormField label="找回未结束批次">
                {(field) => (
                  <Select
                    {...field}
                    placeholder="选择已有批次"
                    disabled={busy}
                    options={ticket.openUploadBatches.map((row) => ({
                      value: row.uploadBatchId,
                      label: `${batchStateLabel(row.state)} · ${row.expectedCount} 集 · ${row.createdBy.name}`,
                    }))}
                    onChange={(id: string) => {
                      setLocalError(undefined);
                      void runtime?.model.open(id);
                    }}
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
                  onChange={(event) =>
                    setScope(event.target.value === "partial" ? "partial" : "full")
                  }
                >
                  <Radio value="full">整部</Radio>
                  <Radio value="partial">部分集</Radio>
                </Radio.Group>
              )}
            </FormField>
            <Declaration value={ai} onChange={setAi} disabled={busy} />
            <FormField label="选择成片文件">
              {(field) => (
                <input
                  {...field}
                  className="lyx-production-file-select"
                  type="file"
                  accept=".mp4,.mov"
                  multiple
                  disabled={busy}
                  onChange={(event) => {
                    const selected = [...(event.target.files ?? [])];
                    event.target.value = "";
                    setSelection(
                      selected.map((file) => ({ file, clientToken: crypto.randomUUID() })),
                    );
                  }}
                />
              )}
            </FormField>
            <p>不支持 ZIP；请选择未经修改的视频文件。集号匹配与总集数以服务器结果为准。</p>
            {selection.map((row) => (
              <p key={row.clientToken}>
                {row.file.name} · {row.file.size} 字节
              </p>
            ))}
            {selection.length && problem ? <p role="alert">{problem}</p> : null}
            <Button
              type="primary"
              loading={busy}
              disabled={!runtime || !!problem || !aiComplete}
              onClick={() => {
                if (!runtime) return;
                void runtime.model
                  .create({
                    purpose: "final_release",
                    targetId: ticket.orderItemId,
                    scope,
                    aiUsage: ai,
                    isContentChanged: false,
                    files: selection.map(({ file, clientToken }) => ({
                      clientToken,
                      originalName: file.name,
                      sizeBytes: String(file.size),
                    })),
                  })
                  .then((created) => {
                    if (created && alive()) {
                      try {
                        runtime.uploader.attach(
                          created,
                          selection.map((row) => row.file),
                          true,
                        );
                      } catch (error) {
                        fail(error);
                      }
                    }
                  });
              }}
            >
              创建批次并核对
            </Button>
          </>
        ) : (
          <>
            <h3>{batchStateLabel(batch.state)}</h3>
            <Coverage batch={batch} />
            {batch.coverage.needsSequenceConfirm ? (
              <Checkbox
                checked={sequenceConfirmed}
                disabled={busy}
                onChange={(event) => setSequenceConfirmed(event.target.checked)}
              >
                我已逐集核对，确认采用服务器给出的顺序建议
              </Checkbox>
            ) : null}
            <Checkbox
              checked={originalConfirmed}
              onChange={(event) => setOriginalConfirmed(event.target.checked)}
            >
              续传时，我确认重新选择的是未经修改的同一原始文件
            </Checkbox>
            <div className="lyx-batch-items">
              {batch.items.map((item) => (
                <ItemRow
                  key={`${item.uploadBatchItemId}:${item.episodeNo ?? "none"}`}
                  item={item}
                  batch={batch}
                  progress={progress[item.uploadBatchItemId]}
                  busy={busy}
                  hasFile={runtime?.uploader.hasFile(item.uploadBatchItemId) ?? false}
                  onNumber={(episodeNo) => {
                    void runtime?.model.update(item.uploadBatchItemId, { episodeNo });
                  }}
                  onAttach={attach}
                  onReplace={(file) => {
                    void replace(item, file);
                  }}
                  onSkip={() => {
                    void runtime?.model.update(item.uploadBatchItemId, { skip: true });
                  }}
                />
              ))}
            </div>
            {snapshot.pollingPaused ? (
              <Alert type="info" title="自动刷新已暂停，当前结果以服务器为准" />
            ) : null}
            <div className="lyx-production-actions">
              <Button
                disabled={busy}
                onClick={() => {
                  void runtime?.model.refresh();
                }}
              >
                刷新批次
              </Button>
              {batch.state === "matching" ? (
                <Button
                  type="primary"
                  loading={busy}
                  disabled={!canStart(batch, sequenceConfirmed)}
                  onClick={() => {
                    void runtime?.model.start(sequenceConfirmed).then((started) => {
                      if (started && alive()) void upload();
                    });
                  }}
                >
                  确认匹配并开始上传
                </Button>
              ) : null}
              {batch.state === "uploading" ? (
                <Button
                  type="primary"
                  loading={uploading}
                  disabled={busy}
                  onClick={() => {
                    void upload();
                  }}
                >
                  上传所选文件 / 重试
                </Button>
              ) : null}
              {["matching", "ready"].includes(batch.state) && batch.actions.includes("cancel") ? (
                <Button
                  disabled={busy || uploading}
                  onClick={() => {
                    void runtime?.model.cancel().then((canceled) => {
                      if (canceled && alive()) {
                        onRefresh();
                        onClose();
                      }
                    });
                  }}
                >
                  取消此批次
                </Button>
              ) : null}
            </div>
            {batch.state === "verifying" ? (
              <p>文件已上传，正在等待服务器体检；每 2 秒更新一次。</p>
            ) : null}
          </>
        )}
        {snapshot.error || localError || consume.error ? (
          <Alert type="error" title={snapshot.error ?? localError ?? consume.error} />
        ) : null}
        <div className="lyx-production-footer">
          <Button disabled={busy} onClick={onClose}>
            关闭，稍后继续
          </Button>
          {batch && ticket.actions.includes("episode-register") ? (
            <Can module="delivery" need="o" action="delivery.episode.register">
              <Button
                type="primary"
                disabled={!canConsume(batch) || busy || uploading}
                loading={consume.pending}
                onClick={() => {
                  const body = { uploadBatchId: batch.uploadBatchId };
                  void consume.submit({ ticketId: ticket.deliveryTicketId, ...body }, (key) =>
                    api.registerEpisodes(ticket.deliveryTicketId, body, key),
                  );
                }}
              >
                登记成片文件
              </Button>
            </Can>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
