import { Alert, Button, Checkbox, DatePicker, Input, Modal, Space } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { FormField } from "../../../components/FormField";
import { ConfirmAction } from "../../../components/ConfirmAction";
import { UploadField } from "../../../components/UploadField";
import type { AppServices } from "../../../app/services";
import {
  AgreementFailure,
  type AgreementApi,
  type CreateBody,
  type UpdateBody,
  type Version,
} from "./api";
import {
  createWriteIntent,
  effectiveInstant,
  failureDetails,
  failureText,
  localEffective,
  type AgreementWorkspace,
} from "./model";
import { createAgreementUploader, PDF_RULE, WORD_RULE } from "./upload";

export interface DraftFields {
  date: string;
  time: string;
  summary: string;
  sourceFileId: string | null;
  pdfFileId: string | null;
  isReconsentRequired: boolean;
  isLegalApproved: boolean;
  bumpMajor: boolean;
}
type DraftBody = Omit<UpdateBody, "lockVersion"> & { bumpMajor?: boolean };
export function initialFields(version?: Version): DraftFields {
  return {
    ...localEffective(version?.effectiveAt ?? null),
    summary: version?.summary ?? "",
    sourceFileId: version?.sourceFile?.fileId ?? null,
    pdfFileId: version?.pdfFile?.fileId ?? null,
    isReconsentRequired: version?.isReconsentRequired ?? false,
    isLegalApproved: false,
    bumpMajor: false,
  };
}
export function editorBody(fields: DraftFields, updating: boolean): DraftBody {
  const effectiveAt = fields.date ? effectiveInstant(fields.date, fields.time) : null;
  const summary = fields.summary.trim() || null;
  if (summary && summary.length > 60) throw new Error("变更摘要最多60字");
  return {
    ...(updating
      ? { effectiveAt, summary, sourceFileId: fields.sourceFileId, pdfFileId: fields.pdfFileId }
      : {
          ...(effectiveAt ? { effectiveAt } : {}),
          ...(summary ? { summary } : {}),
          ...(fields.sourceFileId ? { sourceFileId: fields.sourceFileId } : {}),
          ...(fields.pdfFileId ? { pdfFileId: fields.pdfFileId } : {}),
          bumpMajor: fields.bumpMajor,
        }),
    isReconsentRequired: fields.isReconsentRequired,
    isLegalApproved: fields.isLegalApproved,
  };
}
export function createDraftSession(
  api: Pick<AgreementApi, "create" | "update" | "schedule">,
  key: string,
  initial?: Version,
) {
  let version = initial,
    signature: string | undefined,
    result: Awaited<ReturnType<AgreementApi["update"]>> | undefined,
    closed = false;
  const intent = createWriteIntent();
  async function save(body: DraftBody) {
    if (closed) throw new Error("编辑已结束");
    const next = JSON.stringify(body);
    if (signature === next && result) return result;
    if (version) {
      const { bumpMajor: _major, ...fields } = body;
      const request: UpdateBody = { ...fields, lockVersion: version.lockVersion };
      result = await api.update(
        version.agreementVersionId,
        request,
        intent.key("update", version.agreementVersionId, request),
      );
    } else {
      const request: CreateBody = {
        bumpMajor: body.bumpMajor ?? false,
        isLegalApproved: body.isLegalApproved,
        isReconsentRequired: body.isReconsentRequired,
        ...(body.summary ? { summary: body.summary } : {}),
        ...(body.effectiveAt ? { effectiveAt: body.effectiveAt } : {}),
        ...(body.sourceFileId ? { sourceFileId: body.sourceFileId } : {}),
        ...(body.pdfFileId ? { pdfFileId: body.pdfFileId } : {}),
      };
      result = await api.create(key, request, intent.key("create", key, request));
    }
    version = result.version;
    signature = next;
    if (closed) throw new Error("编辑已结束");
    return result;
  }
  return {
    save,
    async schedule(body: DraftBody, shortNoticeReason: string) {
      const saved = await save(body);
      if (!saved.version.actions.includes("schedule"))
        throw new Error("当前版本不可安排，请按服务端提示完善草稿");
      const request = {
        lockVersion: saved.version.lockVersion,
        ...(shortNoticeReason.trim() ? { shortNoticeReason: shortNoticeReason.trim() } : {}),
      };
      return api.schedule(
        saved.version.agreementVersionId,
        request,
        intent.key("schedule", saved.version.agreementVersionId, request),
      );
    },
    current: () => result,
    close() {
      closed = true;
      intent.reset();
    },
  };
}
export function HtmlPreview({
  html,
  title = "协议正文预览",
}: {
  html: string | null;
  title?: string;
}) {
  if (!html) return <p className="lyx-agreement-muted">请先上传经法务审核的协议正文。</p>;
  const source = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.8 sans-serif;padding:16px;overflow-wrap:anywhere}img{max-width:100%}</style>${html}`;
  return (
    <iframe
      className="lyx-agreement-preview"
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={source}
    />
  );
}
function Problem({ error }: { error: unknown }) {
  const details = failureDetails(error);
  const lines = ["earliestEffectiveAt", "minDays", "actualDays", "versionLabel", "reason"].flatMap(
    (key) => {
      const value = details[key];
      return typeof value === "string" || typeof value === "number" ? [`${key}: ${value}`] : [];
    },
  );
  const missing = Array.isArray(details.missing)
    ? details.missing.filter((v): v is string => typeof v === "string")
    : [];
  const conflict = error instanceof AgreementFailure && error.failure.symbol === "VERSION_CONFLICT";
  return (
    <Alert
      type="error"
      showIcon
      title={failureText(error)}
      description={
        <>
          {lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
          {missing.length > 0 ? <div>待完善：{missing.join("、")}</div> : null}
          {conflict ? (
            <div>输入已保留；版本已被他人修改。关闭编辑器、刷新详情后，重新核对并编辑。</div>
          ) : null}
        </>
      }
    />
  );
}
export function AgreementEditor({
  services,
  api,
  workspace,
  agreementKey,
  version,
  canBumpMajor,
  canShortNotice,
  onClose,
  onSaved,
}: {
  services: AppServices;
  api: AgreementApi;
  workspace: AgreementWorkspace;
  agreementKey: string;
  version?: Version;
  canBumpMajor: boolean;
  canShortNotice: boolean;
  onClose: () => void;
  onSaved: (warnings?: string[]) => void;
}) {
  const [fields, setFields] = useState(() => initialFields(version));
  const [dateEpoch, setDateEpoch] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [preview, setPreview] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]),
    [shortNoticeReason, setShortNoticeReason] = useState("");
  const [shortNotice, setShortNotice] = useState(false),
    [savedVersion, setSavedVersion] = useState(version);
  const [confirming, setConfirming] = useState(false);
  // Resources start on an actual click, so StrictMode's setup/cleanup replay cannot leave a closed adapter in use.
  const sessionRef = useRef<ReturnType<typeof createDraftSession> | undefined>(undefined);
  const uploaderRef = useRef<ReturnType<typeof createAgreementUploader> | undefined>(undefined);
  useEffect(
    () => () => {
      sessionRef.current?.close();
      uploaderRef.current?.close();
      sessionRef.current = undefined;
      uploaderRef.current = undefined;
    },
    [api, agreementKey, version, services],
  );
  const set = <K extends keyof DraftFields>(key: K, value: DraftFields[K]) =>
    setFields((old) => ({ ...old, [key]: value }));
  async function submit(schedule: boolean): Promise<boolean> {
    if (busy) return false;
    setError(undefined);
    setBusy(true);
    try {
      const existing = sessionRef.current?.current()?.version ?? version;
      const body = editorBody(fields, Boolean(existing));
      const result = await workspace.write(schedule ? "安排中" : "保存中", async () => {
        const session = (sessionRef.current ??= createDraftSession(api, agreementKey, version));
        const saved = await session.save(body);
        return {
          saved,
          scheduled: schedule ? await session.schedule(body, shortNoticeReason) : undefined,
        };
      });
      if (!result) return false;
      setSavedVersion(result.saved.version);
      setPreview(result.saved.contentHtml);
      const messages = result.saved.conversion.warnings.map(
        (w) => `Word 与 PDF 的文本相似度为 ${(w.similarityBp / 100).toFixed(2)}%，请人工核对差异。`,
      );
      setWarnings(messages);
      onSaved(messages);
      if (result.scheduled) onClose();
      return true;
    } catch (err) {
      const saved = sessionRef.current?.current();
      if (saved) {
        setSavedVersion(saved.version);
        setPreview(saved.contentHtml);
        setWarnings(
          saved.conversion.warnings.map(
            (w) =>
              `Word 与 PDF 的文本相似度为 ${(w.similarityBp / 100).toFixed(2)}%，请人工核对差异。`,
          ),
        );
      }
      setError(err);
      if (
        err instanceof AgreementFailure &&
        failureDetails(err).canOverride === true &&
        canShortNotice
      )
        setShortNotice(true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const upload = useCallback(
    async (file: File, hooks: { onProgress: (percent: number) => void }) => {
      const uploader = (uploaderRef.current ??= createAgreementUploader(services));
      setBusy(true);
      try {
        return await uploader.upload(file, hooks);
      } finally {
        setBusy(false);
      }
    },
    [services],
  );
  return (
    <Modal
      open
      width={760}
      styles={{ body: { maxHeight: "calc(100vh - 260px)", overflowY: "auto" } }}
      title={savedVersion ? `编辑草稿 ${savedVersion.versionLabel}` : "新建协议草稿"}
      onCancel={() => {
        if (!busy) onClose();
      }}
      maskClosable={false}
      footer={
        <Space>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void submit(false)}>
            保存草稿
          </Button>
          <Button
            type="primary"
            loading={busy}
            disabled={busy || confirming}
            onClick={() => setConfirming(true)}
          >
            保存并安排
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        title="请上传经法务审核的Word正文和PDF签署文件；确认审核后才能安排生效"
      />
      {error ? (
        <>
          <Problem error={error} />
          <Button
            onClick={() => {
              onClose();
              onSaved();
            }}
          >
            关闭并刷新详情，重新核对
          </Button>
        </>
      ) : null}
      <div className="lyx-agreement-editor">
        <FormField label="变更摘要" value={fields.summary} maxLength={60}>
          {(props) => (
            <Input.TextArea
              {...props}
              value={fields.summary}
              maxLength={60}
              rows={2}
              disabled={busy}
              onChange={(e) => set("summary", e.target.value)}
            />
          )}
        </FormField>
        <FormField label="生效日期（北京时间）">
          {(props) => (
            <div
              onKeyDownCapture={(event) => {
                if (
                  (event.key === "Delete" || event.key === "Backspace") &&
                  event.target instanceof HTMLInputElement &&
                  !event.target.value
                )
                  set("date", "");
              }}
            >
              <DatePicker
                key={dateEpoch}
                {...props}
                disabled={busy}
                placeholder={fields.date || "请选择日期"}
                onInput={(event) => {
                  if (event.target instanceof HTMLInputElement && !event.target.value)
                    set("date", "");
                }}
                onChange={(_date, text) => set("date", typeof text === "string" ? text : "")}
              />
              <p className="lyx-agreement-muted">当前生效日期：{fields.date || "未设置"}</p>
            </div>
          )}
        </FormField>
        <FormField label="生效时刻（北京时间）">
          {(props) => (
            <Input
              {...props}
              type="time"
              value={fields.time}
              disabled={busy}
              onChange={(e) => set("time", e.target.value)}
            />
          )}
        </FormField>
        <Button
          size="small"
          disabled={busy || !fields.date}
          onClick={() => {
            set("date", "");
            setDateEpoch((current) => current + 1);
          }}
        >
          清除生效日期
        </Button>
        <div className="lyx-agreement-files">
          <section>
            <h3>Word 正文</h3>
            {version?.sourceFile ? (
              <p>原文件：{version.sourceFile.originalName ?? "Word 文档"}</p>
            ) : null}
            <UploadField
              rule={WORD_RULE}
              upload={upload}
              disabled={busy}
              onChange={(fileId) => set("sourceFileId", fileId)}
              text="上传或替换 Word"
            />
            {fields.sourceFileId ? (
              <Button type="link" disabled={busy} onClick={() => set("sourceFileId", null)}>
                清除 Word 引用
              </Button>
            ) : null}
          </section>
          <section>
            <h3>PDF 签署文件</h3>
            {version?.pdfFile ? <p>原文件：{version.pdfFile.originalName ?? "PDF 文档"}</p> : null}
            <UploadField
              rule={PDF_RULE}
              upload={upload}
              disabled={busy}
              onChange={(fileId) => set("pdfFileId", fileId)}
              text="上传或替换 PDF"
            />
            {fields.pdfFileId ? (
              <Button type="link" disabled={busy} onClick={() => set("pdfFileId", null)}>
                清除 PDF 引用
              </Button>
            ) : null}
          </section>
        </div>
        {!version && canBumpMajor ? (
          <Checkbox
            checked={fields.bumpMajor}
            disabled={busy}
            onChange={(e) => set("bumpMajor", e.target.checked)}
          >
            升级主版本（仅具备超级管理员操作权限）
          </Checkbox>
        ) : null}
        <Checkbox
          checked={fields.isReconsentRequired}
          disabled={busy}
          onChange={(e) => set("isReconsentRequired", e.target.checked)}
        >
          要求用户重新同意
        </Checkbox>
        {version?.isLegalApproved ? (
          <p>服务器记录：原草稿已完成法务审核；本次编辑请重新核对正文。</p>
        ) : null}
        <Checkbox
          checked={fields.isLegalApproved}
          disabled={busy}
          onChange={(e) => set("isLegalApproved", e.target.checked)}
        >
          我确认本次正文已完成法务审核
        </Checkbox>
        {shortNotice ? (
          <FormField label="公告不足期覆盖理由" value={shortNoticeReason} maxLength={100}>
            {(props) => (
              <Input.TextArea
                {...props}
                value={shortNoticeReason}
                maxLength={100}
                disabled={busy}
                onChange={(e) => setShortNoticeReason(e.target.value)}
              />
            )}
          </FormField>
        ) : null}
        {warnings.map((warning) => (
          <Alert key={warning} type="warning" title={warning} />
        ))}
        {preview ? <HtmlPreview html={preview} title="保存后转换正文" /> : null}
      </div>
      {confirming ? (
        <ConfirmAction
          open
          action="agreement-schedule"
          spec={{
            title: "安排协议生效",
            echo: [
              { label: "协议", value: agreementKey },
              { label: "版本", value: savedVersion?.versionLabel ?? "保存后由服务器分配" },
              { label: "生效日期", value: fields.date || "尚未填写" },
              { label: "生效时刻（北京时间）", value: fields.time },
              { label: "变更摘要", value: fields.summary || "尚未填写" },
            ],
            description:
              "先保存正文，再由服务端核对完整性、公告期与当前权限。需要再验证时沿用本次请求意图。",
            checkLabel: "我已核对文件、法务记录与安排信息",
          }}
          onCancel={() => setConfirming(false)}
          onConfirm={async () =>
            (await submit(true))
              ? { outcome: "done" }
              : { outcome: "failed", message: "安排未完成，关闭此确认查看服务端提示；表单已保留" }
          }
          onDone={() => setConfirming(false)}
        />
      ) : null}
    </Modal>
  );
}
