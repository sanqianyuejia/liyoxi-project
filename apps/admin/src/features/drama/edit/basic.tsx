import {
  DramaBasicBodySchema,
  DramaCommercialBodySchema,
  DramaCastBodySchema,
} from "@liyoxi/contract";
import { Alert, Button, Checkbox, Input, InputNumber, Select } from "antd";
import { useState } from "react";
import { FormField } from "../../../components/FormField";
import { ReadOnlyValue } from "../../../components/ReadOnlyValue";
import type { DramaApi, DramaDetail, Dictionary, BasicBody, CommercialBody } from "./api";
import { ContentDialog } from "./form";
import { createContentIntent, DRAMA_CLASS_OPTIONS, PLACEMENT_LABELS } from "./model";
import { ContentUpload } from "./media";

export function BasicDialog({
  api,
  drama,
  dictionary,
  onClose,
  onSaved,
}: {
  api: DramaApi;
  drama: DramaDetail;
  dictionary: Dictionary;
  onClose(): void;
  onSaved(): void;
}) {
  const [intent] = useState(() => createContentIntent("drama-basic"));
  const knownClass = DRAMA_CLASS_OPTIONS.some((v) => v.value === drama.dramaClass);
  const [draft, setDraft] = useState<BasicBody>(() => ({
    lockVersion: drama.lockVersion,
    title: drama.title,
    posterFileId: drama.posterFileId,
    totalEpisodes: drama.totalEpisodes,
    episodeDurationSec: drama.episodeDurationSec,
    genreCodes: drama.genres.map((v) => v.code),
    sellingTagCodes: drama.sellingTags.map((v) => v.code),
    producerName: drama.producerName,
    castNames: drama.castNames,
    synopsis: drama.synopsis,
    dramaClass: knownClass
      ? DramaBasicBodySchema.shape.dramaClass.parse(drama.dramaClass)
      : undefined,
    isAiGenerated: drama.isAiGenerated,
  }));
  const set = (next: Partial<BasicBody>) => setDraft((value) => ({ ...value, ...next }));
  return (
    <ContentDialog
      title="编辑基础信息"
      intent={intent}
      onClose={onClose}
      submit={async () => {
        const body = DramaBasicBodySchema.parse(draft);
        if (
          await intent.submit(body, (key, signal) => api.basic(drama.dramaId, body, key, signal))
        ) {
          onSaved();
          onClose();
        }
      }}
    >
      <p>本次草稿基于版本 {drama.lockVersion}；刷新详情不会替换确认版本。</p>
      <FormField label="剧名" value={draft.title} maxLength={20}>
        {(field) => (
          <Input
            {...field}
            value={draft.title}
            maxLength={20}
            onChange={(e) => set({ title: e.target.value })}
          />
        )}
      </FormField>
      <FormField label="封面">
        {() => (
          <>
            <ContentUpload
              api={api}
              category="poster"
              onChange={(posterFileId) => set({ posterFileId })}
            />
            <p>{draft.posterFileId ? "已引用封面文件" : "未选择封面"}</p>
            <Button onClick={() => set({ posterFileId: null })}>移除封面引用</Button>
          </>
        )}
      </FormField>
      <div className="content-form-grid">
        <FormField label="总集数">
          {(field) => (
            <InputNumber
              {...field}
              min={1}
              max={999}
              value={draft.totalEpisodes}
              onChange={(totalEpisodes) => set({ totalEpisodes })}
            />
          )}
        </FormField>
        <FormField label="参考单集时长（秒）">
          {(field) => (
            <InputNumber
              {...field}
              min={1}
              precision={0}
              value={draft.episodeDurationSec}
              onChange={(episodeDurationSec) => set({ episodeDurationSec })}
            />
          )}
        </FormField>
      </div>
      <FormField label="题材">
        {(field) => (
          <Select
            {...field}
            mode="multiple"
            value={draft.genreCodes}
            options={dictionary
              .filter((v) => v.typeKey === "genre")
              .map((v) => ({
                value: v.code,
                label: `${v.name}${v.isEnabled ? "" : "（已停用）"}`,
                disabled: !v.isEnabled && !draft.genreCodes?.includes(v.code),
              }))}
            onChange={(genreCodes: string[]) => set({ genreCodes })}
          />
        )}
      </FormField>
      <FormField label="卖点标签（最多3个）">
        {(field) => (
          <Select
            {...field}
            mode="multiple"
            maxCount={3}
            value={draft.sellingTagCodes}
            options={dictionary
              .filter((v) => v.typeKey === "selling_tag")
              .map((v) => ({
                value: v.code,
                label: v.name,
                disabled: !v.isEnabled && !draft.sellingTagCodes?.includes(v.code),
              }))}
            onChange={(sellingTagCodes: string[]) => set({ sellingTagCodes })}
          />
        )}
      </FormField>
      <FormField label="剧目类别">
        {(field) => (
          <Select
            {...field}
            allowClear
            disabled={!!drama.dramaClass && !knownClass}
            value={draft.dramaClass}
            options={DRAMA_CLASS_OPTIONS}
            onChange={(value) =>
              set({ dramaClass: DramaBasicBodySchema.shape.dramaClass.parse(value ?? null) })
            }
          />
        )}
      </FormField>
      {!knownClass && drama.dramaClass ? (
        <Alert
          type="warning"
          title={`当前类别 ${drama.dramaClass} 暂不支持编辑；保存其他字段不会修改它。`}
        />
      ) : null}
      <FormField label="出品方" value={draft.producerName ?? ""} maxLength={50}>
        {(field) => (
          <Input
            {...field}
            value={draft.producerName ?? ""}
            maxLength={50}
            onChange={(e) => set({ producerName: e.target.value || null })}
          />
        )}
      </FormField>
      <FormField label="主演" value={draft.castNames ?? ""} maxLength={100}>
        {(field) => (
          <Input
            {...field}
            value={draft.castNames ?? ""}
            maxLength={100}
            onChange={(e) => set({ castNames: e.target.value || null })}
          />
        )}
      </FormField>
      <FormField label="简介" value={draft.synopsis ?? ""} maxLength={300}>
        {(field) => (
          <Input.TextArea
            {...field}
            value={draft.synopsis ?? ""}
            maxLength={300}
            rows={4}
            onChange={(e) => set({ synopsis: e.target.value || null })}
          />
        )}
      </FormField>
      <Checkbox
        checked={draft.isAiGenerated}
        onChange={(e) => set({ isAiGenerated: e.target.checked })}
      >
        原片为 AI 制作
      </Checkbox>
    </ContentDialog>
  );
}
export function CommercialDialog({
  api,
  drama,
  dictionary,
  onClose,
  onSaved,
}: {
  api: DramaApi;
  drama: DramaDetail;
  dictionary: Dictionary;
  onClose(): void;
  onSaved(): void;
}) {
  const [intent] = useState(() => createContentIntent("drama-commercial"));
  const knownTier = drama.heatTier === null || ["S", "A", "B", "C"].includes(drama.heatTier);
  const knownPlacements = drama.allowedPlacements.every((v) => v in PLACEMENT_LABELS);
  const [draft, setDraft] = useState<CommercialBody>(() => ({
    lockVersion: drama.lockVersion,
    heatTier: knownTier
      ? DramaCommercialBodySchema.shape.heatTier.parse(drama.heatTier)
      : undefined,
    manualBoost: drama.manualBoost,
    industryCodes: drama.industries.map((v) => v.code),
    targetAudience: drama.targetAudience,
    allowedPlacements: knownPlacements
      ? DramaCommercialBodySchema.shape.allowedPlacements.parse(drama.allowedPlacements)
      : undefined,
  }));
  const set = (next: Partial<CommercialBody>) => setDraft((value) => ({ ...value, ...next }));
  return (
    <ContentDialog
      title="编辑商务信息"
      intent={intent}
      onClose={onClose}
      submit={async () => {
        const body = DramaCommercialBodySchema.parse(draft);
        if (
          await intent.submit(body, (key, signal) =>
            api.commercial(drama.dramaId, body, key, signal),
          )
        ) {
          onSaved();
          onClose();
        }
      }}
    >
      <FormField label="等级">
        {(field) => (
          <Select
            {...field}
            allowClear
            disabled={!knownTier}
            value={draft.heatTier}
            options={["S", "A", "B", "C"].map((value) => ({ value, label: `${value}级` }))}
            onChange={(value) =>
              set({ heatTier: DramaCommercialBodySchema.shape.heatTier.parse(value ?? null) })
            }
          />
        )}
      </FormField>
      <FormField label="手工加权（0–100）">
        {(field) => (
          <InputNumber
            {...field}
            min={0}
            max={100}
            precision={0}
            value={draft.manualBoost}
            onChange={(value) => set({ manualBoost: value ?? 0 })}
          />
        )}
      </FormField>
      <FormField label="适投行业">
        {(field) => (
          <Select
            {...field}
            mode="multiple"
            value={draft.industryCodes}
            options={dictionary
              .filter((v) => v.typeKey === "industry")
              .map((v) => ({
                value: v.code,
                label: v.name,
                disabled: !v.isEnabled && !draft.industryCodes?.includes(v.code),
              }))}
            onChange={(industryCodes: string[]) => set({ industryCodes })}
          />
        )}
      </FormField>
      <FormField label="目标人群" value={draft.targetAudience ?? ""} maxLength={100}>
        {(field) => (
          <Input
            {...field}
            value={draft.targetAudience ?? ""}
            maxLength={100}
            onChange={(e) => set({ targetAudience: e.target.value || null })}
          />
        )}
      </FormField>
      <FormField label="允许投放位置">
        {() => (
          <Checkbox.Group
            disabled={!knownPlacements}
            value={draft.allowedPlacements}
            options={Object.entries(PLACEMENT_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={(values) =>
              set({
                allowedPlacements: DramaCommercialBodySchema.shape.allowedPlacements.parse(values),
              })
            }
          />
        )}
      </FormField>
      {!knownTier || !knownPlacements ? (
        <Alert type="warning" title="当前存在新版枚举，本页保留该字段，只保存支持的其他字段。" />
      ) : null}
      <ReadOnlyValue
        label="已开放位置"
        value={drama.openPlacementSlots.map((v) => PLACEMENT_LABELS[v] ?? v).join(" / ") || "无"}
        reason="来自服务端，不由本页决定"
      />
      <ReadOnlyValue
        label="试订集数 / 正文编辑策略"
        value={`${drama.trialEpisodeCount ?? "—"} / ${drama.bodyEditPolicy}`}
      />
    </ContentDialog>
  );
}
export function CastDialog({
  api,
  drama,
  onClose,
  onSaved,
}: {
  api: DramaApi;
  drama: DramaDetail;
  onClose(): void;
  onSaved(): void;
}) {
  const [intent] = useState(() => createContentIntent("drama-cast"));
  const [roles, setRoles] = useState(() => drama.roles.map((v) => ({ ...v })));
  return (
    <ContentDialog
      title="角色简介"
      intent={intent}
      onClose={onClose}
      submit={async () => {
        const body = DramaCastBodySchema.parse({ lockVersion: drama.lockVersion, roles });
        if (
          await intent.submit(body, (key, signal) => api.cast(drama.dramaId, body, key, signal))
        ) {
          onSaved();
          onClose();
        }
      }}
    >
      {roles.map((role, index) => (
        <section className="content-form-row" key={index}>
          <FormField label={`角色 ${index + 1} 名称`}>
            {(field) => (
              <Input
                {...field}
                maxLength={20}
                value={role.name}
                onChange={(e) =>
                  setRoles((values) =>
                    values.map((v, i) => (i === index ? { ...v, name: e.target.value } : v)),
                  )
                }
              />
            )}
          </FormField>
          <FormField label="演员">
            {(field) => (
              <Input
                {...field}
                maxLength={20}
                value={role.actor ?? ""}
                onChange={(e) =>
                  setRoles((values) =>
                    values.map((v, i) =>
                      i === index ? { ...v, actor: e.target.value || null } : v,
                    ),
                  )
                }
              />
            )}
          </FormField>
          <FormField label="人物说明">
            {(field) => (
              <Input.TextArea
                {...field}
                maxLength={100}
                value={role.desc}
                onChange={(e) =>
                  setRoles((values) =>
                    values.map((v, i) => (i === index ? { ...v, desc: e.target.value } : v)),
                  )
                }
              />
            )}
          </FormField>
          <Button danger onClick={() => setRoles((values) => values.filter((_, i) => i !== index))}>
            删除角色 {index + 1}
          </Button>
        </section>
      ))}
      <Button
        disabled={roles.length >= 8}
        onClick={() => setRoles((values) => [...values, { name: "", actor: null, desc: "" }])}
      >
        添加角色（最多8位）
      </Button>
    </ContentDialog>
  );
}
