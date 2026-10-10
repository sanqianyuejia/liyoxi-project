import {
  BannerJumpSchema,
  BANNER_PAGE_LABELS,
  HomeBannerCreateBodySchema,
  HomeBannerUpdateBodySchema,
} from "@liyoxi/contract";
import { maxUploadBytes } from "@liyoxi/shared/uploads";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Input, Modal, Select } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateRangeField } from "../../../components/DateRangeField";
import { FormField } from "../../../components/FormField";
import { UploadField } from "../../../components/UploadField";
import { createProductionUpload } from "../../delivery/ticket-detail/upload";
import { DICT_QUERY } from "../../../lib/query";
import type { UploadFn } from "../../../lib/upload";
import { useModuleLevel } from "../../../lib/permissions";
import { createSiteIntent } from "./model";
import {
  fieldErrors,
  siteError,
  versionConflict,
  type Banner,
  type BannerBody,
  type SiteApi,
} from "./api";
import { SiteErrors } from "./site-editor";

type BannerUploadScope = {
  api: SiteApi;
  adapter: ReturnType<typeof createProductionUpload>;
  controller: AbortController;
};
const rule = {
  accept: [".jpg", ".jpeg", ".png"],
  maxSizeMb: Number(maxUploadBytes("banner", "png", "admin")) / 1024 / 1024,
};
const timeLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "长期有效";
export function BannerEditor({
  api,
  banner,
  close,
  saved,
}: {
  api: SiteApi;
  banner?: Banner;
  close(): void;
  saved(): Promise<void>;
}) {
  const editable = useModuleLevel("ops") === "e";
  const writable = useRef(editable);
  useEffect(() => {
    writable.current = editable;
  }, [editable]);
  const [draft, setDraft] = useState<BannerBody>(() => ({
    title: banner?.title ?? "",
    imageFileId: banner?.imageFileId ?? "",
    jumpKind: banner?.jumpKind ?? "none",
    jumpTarget: banner?.jumpTarget ?? null,
    startAt: banner?.startAt ?? "",
    endAt: banner?.endAt ?? null,
    isEnabled: banner?.isEnabled ?? true,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false),
    [uploadingApi, setUploadingApi] = useState<SiteApi>(),
    [conflict, setConflict] = useState(false),
    [query, setQuery] = useState("");
  const [pageParams, setPageParams] = useState(() =>
    JSON.stringify(banner?.jumpKind === "page" ? (banner.jumpTarget?.params ?? {}) : {}, null, 2),
  );
  const [intent] = useState(() => createSiteIntent(banner ? "banner-edit" : "banner-create"));
  const mounted = useRef(true),
    posting = useRef(false);
  const uploadSlot = useRef<BannerUploadScope | undefined>(undefined);
  const pendingUpload = useRef<{ slot: BannerUploadScope } | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    const adapter = createProductionUpload(api, { category: "banner" }),
      controller = new AbortController();
    uploadSlot.current = { api, adapter, controller };
    return () => {
      mounted.current = false;
      controller.abort();
      adapter.dispose();
      if (uploadSlot.current?.adapter === adapter) uploadSlot.current = undefined;
      if (pendingUpload.current?.slot.adapter === adapter) pendingUpload.current = undefined;
    };
  }, [api]);
  const upload = useMemo<UploadFn>(
    () => async (file, hooks) => {
      const slot = uploadSlot.current;
      if (
        !mounted.current ||
        !writable.current ||
        !slot ||
        slot.api !== api ||
        slot.controller.signal.aborted
      )
        throw new DOMException("上传已取消", "AbortError");
      const pending = { slot };
      pendingUpload.current = pending;
      setUploadingApi(api);
      try {
        return await slot.adapter.upload(file, hooks);
      } finally {
        if (pendingUpload.current === pending) {
          pendingUpload.current = undefined;
          if (mounted.current) setUploadingApi(undefined);
        }
      }
    },
    [api],
  );
  const dramas = useQuery({
    queryKey: ["ops", "banner-dramas", query],
    queryFn: ({ signal }) => api.dramas(query, signal),
    ...DICT_QUERY,
  });
  const mall = useQuery({
    queryKey: ["ops", "banner-mall"],
    queryFn: ({ signal }) => api.get("mall", signal),
    ...DICT_QUERY,
  });
  const update = (patch: Partial<BannerBody>) => {
    if (mounted.current && writable.current) {
      setDraft((current) => ({ ...current, ...patch }));
      setErrors({});
      setMessage(undefined);
    }
  };
  async function submit() {
    const slot = uploadSlot.current;
    if (
      !mounted.current ||
      !writable.current ||
      !slot ||
      slot.controller.signal.aborted ||
      pendingUpload.current ||
      posting.current ||
      conflict
    )
      return;
    if (!draft.imageFileId) {
      setErrors({ imageFileId: "请先上传 Banner 图片" });
      return;
    }
    let input = draft;
    if (draft.jumpKind === "page") {
      try {
        input = {
          ...draft,
          jumpTarget: { route: draft.jumpTarget?.route, params: JSON.parse(pageParams) as unknown },
        };
      } catch {
        setErrors({ jumpTarget: "页面参数须为合法 JSON" });
        return;
      }
    }
    const jump = BannerJumpSchema.safeParse({
      jumpKind: input.jumpKind,
      jumpTarget: input.jumpTarget ?? null,
    });
    const parsed = banner
      ? HomeBannerUpdateBodySchema.safeParse({ ...input, lockVersion: banner.lockVersion })
      : HomeBannerCreateBodySchema.safeParse(input);
    if (!jump.success || !parsed.success) {
      setErrors(
        Object.fromEntries(
          [
            ...(!jump.success ? jump.error.issues : []),
            ...(!parsed.success ? parsed.error.issues : []),
          ].map((issue) => [issue.path.join("."), issue.message]),
        ),
      );
      return;
    }
    posting.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const key = intent.key(parsed.data);
      if (banner)
        await api.updateBanner(
          banner.homeBannerId,
          { ...input, lockVersion: banner.lockVersion },
          key,
          slot.controller.signal,
        );
      else await api.createBanner(input, key, slot.controller.signal);
      if (!mounted.current) return;
      intent.done();
      await saved();
      close();
    } catch (error) {
      if (!mounted.current) return;
      setErrors(fieldErrors(error));
      setConflict(versionConflict(error));
      setMessage(
        versionConflict(error)
          ? "Banner 已变化，草稿已保留。请关闭并重新打开当前行后核对修改。"
          : siteError(error),
      );
      if (versionConflict(error)) await saved();
    } finally {
      posting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const categories =
    mall.data && "categories" in mall.data.published.content
      ? mall.data.published.content.categories
      : [];
  return (
    <Modal
      open
      title={banner ? "编辑 Banner" : "新增 Banner"}
      footer={null}
      width={600}
      onCancel={() => {
        if (!busy) close();
      }}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
    >
      <p className="lyx-confirm__desc">
        图片通过正式上传入库。生效区间与跳转目标由服务端再次校验。
      </p>
      <fieldset disabled={busy || !editable} className="lyx-site-stack lyx-config-page__fields">
        <FormField label="标题" value={draft.title} maxLength={30} error={errors.title}>
          {(props) => (
            <Input
              {...props}
              value={draft.title}
              maxLength={30}
              onChange={(event) => update({ title: event.target.value })}
            />
          )}
        </FormField>
        {banner?.imageUrl && draft.imageFileId === banner.imageFileId ? (
          <img className="lyx-site-thumb" src={banner.imageUrl.url} alt={banner.title} />
        ) : null}
        <FormField label="Banner 图片" error={errors.imageFileId}>
          {() => (
            <UploadField
              rule={rule}
              upload={upload}
              disabled={busy || !editable}
              onChange={(id) => update({ imageFileId: id ?? "" })}
              text="上传 Banner 图片"
            />
          )}
        </FormField>
        <FormField label="跳转类型">
          {(props) => (
            <Select
              {...props}
              value={draft.jumpKind}
              onChange={(jumpKind: BannerBody["jumpKind"]) =>
                update({ jumpKind, jumpTarget: null })
              }
              options={[
                { value: "drama", label: "短剧详情" },
                { value: "mall", label: "商城分类" },
                { value: "page", label: "小程序页面" },
                { value: "none", label: "不跳转" },
              ]}
            />
          )}
        </FormField>
        {draft.jumpKind === "drama" ? (
          <FormField label="跳转短剧" error={errors.jumpTarget}>
            {(props) => (
              <Select
                {...props}
                showSearch
                filterOption={false}
                onSearch={setQuery}
                loading={dramas.isFetching}
                value={
                  typeof draft.jumpTarget?.dramaId === "string"
                    ? draft.jumpTarget.dramaId
                    : undefined
                }
                options={dramas.data?.items.map((row) => ({
                  value: row.dramaId,
                  label: row.title,
                }))}
                onChange={(dramaId: string) => update({ jumpTarget: { dramaId } })}
              />
            )}
          </FormField>
        ) : null}
        {draft.jumpKind === "mall" ? (
          <FormField label="跳转分类" error={errors.jumpTarget}>
            {(props) => (
              <Select
                {...props}
                value={
                  typeof draft.jumpTarget?.categoryKey === "string"
                    ? draft.jumpTarget.categoryKey
                    : undefined
                }
                options={categories
                  .filter((row) => row.visible)
                  .map((row) => ({ value: row.key, label: row.name }))}
                onChange={(categoryKey: string) => update({ jumpTarget: { categoryKey } })}
              />
            )}
          </FormField>
        ) : null}
        {draft.jumpKind === "page" ? (
          <>
            <FormField label="小程序页面" error={errors.jumpTarget}>
              {(props) => (
                <Select
                  {...props}
                  value={
                    typeof draft.jumpTarget?.route === "string" ? draft.jumpTarget.route : undefined
                  }
                  options={Object.entries(BANNER_PAGE_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  onChange={(route: string) => update({ jumpTarget: { route, params: {} } })}
                />
              )}
            </FormField>
            <FormField label="页面参数 JSON" error={errors["jumpTarget.params"]}>
              {(props) => (
                <Input.TextArea
                  {...props}
                  rows={3}
                  value={pageParams}
                  onChange={(event) => {
                    setPageParams(event.target.value);
                    setMessage(undefined);
                  }}
                />
              )}
            </FormField>
            <p className="lyx-site-help">
              按所选页面填写正式参数；如积分钱包为空对象。未知页面或额外参数会被拒绝。
            </p>
          </>
        ) : null}
        <FormField label="生效时间（北京时间）" error={errors.startAt ?? errors.endAt}>
          {() => (
            <DateRangeField
              showTime
              format="YYYY-MM-DD HH:mm"
              allowEmpty={[false, true]}
              placeholder={[
                draft.startAt ? timeLabel(draft.startAt) : "开始时间",
                timeLabel(draft.endAt ?? null),
              ]}
              onChange={(_, values) =>
                update({
                  startAt: values[0]
                    ? new Date(`${values[0].replace(" ", "T")}:00+08:00`).toISOString()
                    : "",
                  endAt: values[1]
                    ? new Date(`${values[1].replace(" ", "T")}:00+08:00`).toISOString()
                    : null,
                })
              }
            />
          )}
        </FormField>
        <p className="lyx-site-help">
          当前时间窗：{draft.startAt ? timeLabel(draft.startAt) : "未选择"} 至{" "}
          {timeLabel(draft.endAt ?? null)}
        </p>
        <Checkbox
          checked={draft.endAt == null}
          onChange={(event) => {
            if (event.target.checked) update({ endAt: null });
          }}
        >
          长期有效（不设置结束时间）
        </Checkbox>
        <Checkbox
          checked={draft.isEnabled}
          onChange={(event) => update({ isEnabled: event.target.checked })}
        >
          启用
        </Checkbox>
        {dramas.isError || mall.isError ? (
          <p role="alert">引用读取失败：{siteError(dramas.error ?? mall.error)}</p>
        ) : null}
        <SiteErrors errors={errors} />
        {message ? <p role="alert">{message}</p> : null}
      </fieldset>
      <div className="lyx-confirm__footer">
        <Button size="large" disabled={busy} onClick={close}>
          取消
        </Button>
        <Button
          size="large"
          type="primary"
          loading={busy}
          disabled={conflict || !editable || uploadingApi === api}
          onClick={() => void submit()}
        >
          {banner ? "保存 Banner" : "新增 Banner"}
        </Button>
      </div>
    </Modal>
  );
}
