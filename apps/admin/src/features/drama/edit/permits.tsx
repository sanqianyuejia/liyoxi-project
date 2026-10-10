import { DramaPermitCreateBodySchema, DramaPermitUpdateBodySchema } from "@liyoxi/contract";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Input, Select } from "antd";
import { useState } from "react";
import { FormField } from "../../../components/FormField";
import { ReadOnlyValue } from "../../../components/ReadOnlyValue";
import { DETAIL_QUERY } from "../../../lib/query";
import { ContentDialog } from "./form";
import { createContentIntent } from "./model";
import type { DramaApi, DramaDetail } from "./api";
import { ContentUpload, FileLinks } from "./media";

type Permit = Awaited<ReturnType<DramaApi["permits"]>>["items"][number];
const platforms = [
  { value: "all", label: "通用" },
  { value: "douyin", label: "抖音" },
  { value: "wechat_channels", label: "视频号" },
];
const kinds = [
  { value: "license_no", label: "许可证号" },
  { value: "approval_no", label: "批准文件号" },
  { value: "program_no", label: "节目编号" },
];
export function PermitsPanel({
  api,
  drama,
  editable,
  scope,
  refresh,
}: {
  api: DramaApi;
  drama: DramaDetail;
  editable: boolean;
  scope: string;
  refresh(): void;
}) {
  const query = useQuery({
    queryKey: ["drama", drama.dramaId, "permits", scope],
    queryFn: ({ signal }) => api.permits(drama.dramaId, signal),
    ...DETAIL_QUERY,
  });
  const [command, setCommand] = useState<{
    kind: "new" | "edit" | "replace" | "retire";
    permit?: Permit;
    version: number;
  }>();
  const saved = () => {
    void query.refetch();
    refresh();
  };
  if (query.isPending) return <p aria-busy="true">正在读取许可信息…</p>;
  if (query.isError)
    return (
      <Alert
        type="error"
        title={query.error.message}
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  return (
    <div>
      <div className="content-section-heading">
        <h2>许可信息</h2>
        {editable ? (
          <Button onClick={() => setCommand({ kind: "new", version: query.data.dramaLockVersion })}>
            新增许可
          </Button>
        ) : null}
      </div>
      <p>
        所需编号：
        {query.data.requiredKinds
          .map((v) => kinds.find((k) => k.value === v)?.label ?? v)
          .join("、") || "暂无"}
        。冻结行需替换，不直接改写原许可。
      </p>
      {query.data.items.map((permit) => (
        <section className="content-permit" key={permit.dramaPermitId}>
          <h3>
            {platforms.find((v) => v.value === permit.platform)?.label ?? permit.platform} ·{" "}
            {kinds.find((v) => v.value === permit.permitKind)?.label ?? permit.permitKind}
          </h3>
          <strong>{permit.permitNo}</strong>
          <p>
            {permit.status === "active" ? "有效" : "已撤销"} ·{" "}
            {permit.isFrozen ? "已冻结" : "可编辑"} · {permit.note ?? "无备注"}
          </p>
          <FileLinks api={api} files={permit.scanFiles} />
          {permit.retireReason ? <p>撤销原因：{permit.retireReason}</p> : null}
          {editable && permit.status === "active" ? (
            <>
              <Button
                onClick={() =>
                  setCommand({ kind: "edit", permit, version: query.data.dramaLockVersion })
                }
              >
                编辑扫描件 / 备注
              </Button>
              <Button
                onClick={() =>
                  setCommand({ kind: "replace", permit, version: query.data.dramaLockVersion })
                }
              >
                替换许可
              </Button>
              {permit.actions.includes("retire") ? (
                <Button
                  danger
                  onClick={() =>
                    setCommand({ kind: "retire", permit, version: query.data.dramaLockVersion })
                  }
                >
                  撤销
                </Button>
              ) : null}
            </>
          ) : null}
        </section>
      ))}
      {command ? (
        <PermitDialog
          key={`${command.kind}-${command.permit?.dramaPermitId ?? "new"}`}
          api={api}
          dramaId={drama.dramaId}
          command={command}
          onClose={() => setCommand(undefined)}
          onSaved={saved}
        />
      ) : null}
    </div>
  );
}
function PermitDialog({
  api,
  dramaId,
  command,
  onClose,
  onSaved,
}: {
  api: DramaApi;
  dramaId: string;
  command: { kind: "new" | "edit" | "replace" | "retire"; permit?: Permit; version: number };
  onClose(): void;
  onSaved(): void;
}) {
  const permit = command.permit;
  const [intent] = useState(() => createContentIntent(`permit-${command.kind}`));
  const [platform, setPlatform] = useState(permit?.platform ?? "all");
  const [kind, setKind] = useState(permit?.permitKind ?? "license_no");
  const [number, setNumber] = useState(permit?.permitNo ?? "");
  const [note, setNote] = useState(permit?.note ?? "");
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState(
    () => permit?.scanFiles.map((v) => ({ fileId: v.fileId, originalName: v.originalName })) ?? [],
  );
  const frozen = command.kind === "edit" && permit?.isFrozen;
  async function submit() {
    if (command.kind === "retire" && permit) {
      if (
        await intent.submit({ retireReason: reason }, (key, signal) =>
          api.retirePermit(permit.dramaPermitId, reason, key, signal),
        )
      ) {
        onSaved();
        onClose();
      }
      return;
    }
    if (command.kind === "edit" && permit) {
      const body = DramaPermitUpdateBodySchema.parse({
        dramaLockVersion: command.version,
        ...(frozen ? {} : { platform, permitKind: kind, permitNo: number }),
        scanFileIds: files.map((v) => v.fileId),
        note: note || null,
      });
      if (
        await intent.submit(body, (key, signal) =>
          api.updatePermit(permit.dramaPermitId, body, key, signal),
        )
      ) {
        onSaved();
        onClose();
      }
    } else {
      const body = DramaPermitCreateBodySchema.parse({
        platform,
        permitKind: kind,
        permitNo: number,
        scanFileIds: files.map((v) => v.fileId),
        note: note || null,
        ...(command.kind === "replace" && permit
          ? { replacesDramaPermitId: permit.dramaPermitId, retireReason: reason }
          : {}),
      });
      if (
        await intent.submit(body, (key, signal) => api.createPermit(dramaId, body, key, signal))
      ) {
        onSaved();
        onClose();
      }
    }
  }
  return (
    <ContentDialog
      title={
        command.kind === "retire"
          ? "撤销许可"
          : command.kind === "replace"
            ? "替换许可"
            : command.kind === "new"
              ? "新增许可"
              : "编辑许可"
      }
      intent={intent}
      onClose={onClose}
      submit={submit}
    >
      {command.kind !== "retire" ? (
        <>
          <FormField label="平台">
            {(field) => (
              <Select
                {...field}
                disabled={!!frozen}
                value={platform}
                options={platforms}
                onChange={setPlatform}
              />
            )}
          </FormField>
          <FormField label="编号类型">
            {(field) => (
              <Select
                {...field}
                disabled={!!frozen}
                value={kind}
                options={kinds}
                onChange={setKind}
              />
            )}
          </FormField>
          <FormField label="许可编号" value={number} maxLength={50}>
            {(field) => (
              <Input
                {...field}
                disabled={!!frozen}
                value={number}
                maxLength={50}
                onChange={(e) => setNumber(e.target.value)}
              />
            )}
          </FormField>
          {frozen ? (
            <ReadOnlyValue
              label="编号冻结"
              value="平台、类型、编号不可改写"
              reason="需要更正时使用“替换许可”，保留历史证据。"
            />
          ) : null}
          <FormField label="扫描件（最多10份）">
            {() => (
              <>
                <FileLinks
                  api={api}
                  files={files}
                  remove={(id) => setFiles((values) => values.filter((v) => v.fileId !== id))}
                />
                <ContentUpload
                  api={api}
                  category="drama_license_doc"
                  disabled={files.length >= 10}
                  onChange={(id) => {
                    if (id)
                      setFiles((values) =>
                        values.some((v) => v.fileId === id)
                          ? values
                          : [...values, { fileId: id, originalName: "本次上传扫描件" }],
                      );
                  }}
                />
              </>
            )}
          </FormField>
          <FormField label="备注" value={note} maxLength={200}>
            {(field) => (
              <Input.TextArea
                {...field}
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </FormField>
        </>
      ) : (
        <ReadOnlyValue
          label="待撤销许可"
          value={`${permit?.permitNo ?? ""} · ${permit?.platform ?? ""}`}
        />
      )}
      {command.kind === "replace" || command.kind === "retire" ? (
        <FormField label="撤销原许可的原因" value={reason} maxLength={200}>
          {(field) => (
            <Input.TextArea
              {...field}
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </FormField>
      ) : null}
    </ContentDialog>
  );
}
