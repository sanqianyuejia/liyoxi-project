import { CopyrightReplaceBodySchema, CopyrightRevisionCreateBodySchema } from "@liyoxi/contract";
import { Alert, Checkbox, Input, Select } from "antd";
import { useState } from "react";
import { DateRangeField, type DateRangeFieldProps } from "../../../components/DateRangeField";
import { FormField } from "../../../components/FormField";
import type { DramaApi, DramaDetail, CopyrightBody } from "./api";
import { ContentDialog } from "./form";
import { createContentIntent } from "./model";
import { ContentUpload, FileLinks } from "./media";

export function CopyrightDialog({
  api,
  drama,
  revision,
  onClose,
  onSaved,
}: {
  api: DramaApi;
  drama: DramaDetail;
  revision: boolean;
  onClose(): void;
  onSaved(): void;
}) {
  const [intent] = useState(() =>
    createContentIntent(revision ? "copyright-revision" : "copyright-save"),
  );
  const copyright = drama.copyright;
  const initial = CopyrightReplaceBodySchema.safeParse({
    lockVersion: copyright.lockVersion,
    source: copyright.source,
    platforms: copyright.platforms,
    territory: copyright.territory,
    hasNetworkRight: copyright.hasNetworkRight,
    canSublicense: copyright.canSublicense,
    canEditEmbed: copyright.canEditEmbed,
    canAdapt: copyright.canAdapt,
    licenseStartDate: copyright.licenseStartDate,
    licenseEndDate: copyright.licenseEndDate,
    proofFileIds: copyright.proofFiles.map((v) => v.fileId),
  });
  const [draft, setDraft] = useState<CopyrightBody>(() =>
    initial.success
      ? initial.data
      : {
          lockVersion: copyright.lockVersion,
          source: null,
          platforms: [],
          territory: null,
          hasNetworkRight: false,
          canSublicense: false,
          canEditEmbed: false,
          canAdapt: false,
          licenseStartDate: null,
          licenseEndDate: null,
          proofFileIds: [],
        },
  );
  const [changeKind, setChangeKind] = useState<
    "extend" | "shorten" | "scope_change" | "correction"
  >("extend");
  const [reason, setReason] = useState("");
  const [proofs, setProofs] = useState<{ fileId: string; originalName: string | null }[]>(() =>
    copyright.proofFiles.map((v) => ({ fileId: v.fileId, originalName: v.originalName })),
  );
  const [revisionProofs, setRevisionProofs] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [dates, setDates] = useState<DateRangeFieldProps["value"]>(null);
  const set = (value: Partial<CopyrightBody>) =>
    setDraft((previous) => ({ ...previous, ...value }));
  async function submit() {
    if (revision) {
      const { lockVersion: _version, ...facts } = draft;
      const body = CopyrightRevisionCreateBodySchema.parse({
        lockVersion: copyright.lockVersion,
        changeKind,
        copyright: facts,
        reason,
        revisionProofFileIds: revisionProofs,
        confirm: { prevEndDate: copyright.licenseEndDate },
      });
      // Snapshot schema is strict: only the copyright facts are sent inside the revision.
      if (
        await intent.submit(body, (key, signal) =>
          api.reviseCopyright(drama.dramaId, body, key, signal),
        )
      ) {
        onSaved();
        onClose();
      }
    } else {
      const body = CopyrightReplaceBodySchema.parse(draft);
      if (
        await intent.submit(body, (key, signal) => api.copyright(drama.dramaId, body, key, signal))
      ) {
        onSaved();
        onClose();
      }
    }
  }
  return (
    <ContentDialog
      title={revision ? "提交版权变更" : "保存版权信息"}
      intent={intent}
      onClose={onClose}
      disabled={!initial.success || (revision && (!confirmed || !copyright.licenseEndDate))}
      submit={submit}
    >
      <p>
        版权版本 {copyright.lockVersion} · 原授权止日 {copyright.licenseEndDate ?? "未填写"}
        。与剧目基础版本分别确认。
      </p>
      {!initial.success ? (
        <Alert
          type="warning"
          title="当前版权包含本版本不支持的枚举，请联系管理员核对后再编辑，不能清空后覆盖。"
        />
      ) : null}
      {revision ? (
        <>
          <FormField label="变更类型">
            {(field) => (
              <Select
                {...field}
                value={changeKind}
                onChange={setChangeKind}
                options={[
                  { value: "extend", label: "续期" },
                  { value: "shorten", label: "缩短" },
                  { value: "scope_change", label: "范围变更" },
                  { value: "correction", label: "资料更正" },
                ]}
              />
            )}
          </FormField>
          <FormField label="变更原因" value={reason} maxLength={200}>
            {(field) => (
              <Input.TextArea
                {...field}
                value={reason}
                maxLength={200}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </FormField>
        </>
      ) : null}
      <FormField label="权利来源">
        {(field) => (
          <Select
            {...field}
            allowClear
            value={draft.source}
            onChange={(source) => set({ source: source ?? null })}
            options={[
              { value: "own", label: "自有版权" },
              { value: "licensed", label: "取得授权" },
            ]}
          />
        )}
      </FormField>
      <FormField label="平台">
        {() => (
          <Checkbox.Group
            value={draft.platforms}
            options={[
              { value: "douyin", label: "抖音" },
              { value: "wechat_channels", label: "视频号" },
            ]}
            onChange={(values) =>
              set({ platforms: CopyrightReplaceBodySchema.shape.platforms.parse(values) })
            }
          />
        )}
      </FormField>
      <FormField label="地域" value={draft.territory ?? ""} maxLength={50}>
        {(field) => (
          <Input
            {...field}
            value={draft.territory ?? ""}
            maxLength={50}
            onChange={(e) => set({ territory: e.target.value || null })}
          />
        )}
      </FormField>
      <FormField label="许可权利">
        {() => (
          <div className="content-checkboxes">
            {(
              [
                { key: "hasNetworkRight", label: "信息网络传播权" },
                { key: "canSublicense", label: "可转授权" },
                { key: "canEditEmbed", label: "可剪辑嵌入广告" },
                { key: "canAdapt", label: "可改编" },
              ] as const
            ).map(({ key, label }) => (
              <Checkbox
                key={key}
                checked={draft[key]}
                onChange={(e) => set({ [key]: e.target.checked })}
              >
                {label}
              </Checkbox>
            ))}
          </div>
        )}
      </FormField>
      <p>
        当前草稿授权期：{draft.licenseStartDate ?? "未填写"} 至 {draft.licenseEndDate ?? "未填写"}
        。选择新日期会整体替换起止日。
      </p>
      <FormField label="修改授权起止日期（北京时间）">
        {(field) => (
          <DateRangeField
            {...field}
            value={dates}
            allowEmpty={[true, true]}
            onChange={(values) => {
              setDates(values);
              set({
                licenseStartDate: values?.[0]?.format("YYYY-MM-DD") ?? null,
                licenseEndDate: values?.[1]?.format("YYYY-MM-DD") ?? null,
              });
            }}
          />
        )}
      </FormField>
      <FormField label="权属证明（最多10份）">
        {() => (
          <>
            <FileLinks
              api={api}
              files={proofs}
              remove={(id) => {
                setProofs((values) => values.filter((v) => v.fileId !== id));
                set({ proofFileIds: draft.proofFileIds.filter((v) => v !== id) });
                setRevisionProofs((values) => values.filter((v) => v !== id));
              }}
            />
            <ContentUpload
              api={api}
              category="drama_license_doc"
              disabled={proofs.length >= 10}
              onChange={(id) => {
                if (id && !draft.proofFileIds.includes(id)) {
                  setProofs((values) => [...values, { fileId: id, originalName: "本次上传证明" }]);
                  set({ proofFileIds: [...draft.proofFileIds, id] });
                  if (revision) setRevisionProofs((values) => [...values, id]);
                }
              }}
            />
          </>
        )}
      </FormField>
      {revision ? (
        <>
          <FormField label="本次变更依据（至少1份）">
            {(field) => (
              <Select
                {...field}
                mode="multiple"
                value={revisionProofs}
                options={proofs.map((v, index) => ({
                  value: v.fileId,
                  label: v.originalName ?? `权属证明 ${index + 1}`,
                }))}
                onChange={setRevisionProofs}
              />
            )}
          </FormField>
          <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}>
            已核对原止日 {copyright.licenseEndDate}；确认以当前草稿提交新版权快照
          </Checkbox>
          <p>缩短授权若影响现有使用，会由服务端拒绝；本页保留原草稿和具体原因。</p>
        </>
      ) : null}
    </ContentDialog>
  );
}
