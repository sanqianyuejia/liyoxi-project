import { AGREEMENT_CONSENT_SCENE, AdminAgreementConsentListQuerySchema } from "@liyoxi/contract";
import { appDateTimeFormat } from "@liyoxi/shared/format/datetime";
import { maskPhone, maskUscc } from "@liyoxi/shared/mask";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Input, Select } from "antd";
import { useEffect, useRef, useState } from "react";
import { DateRangeField } from "../../../components/DateRangeField";
import { FormField } from "../../../components/FormField";
import { QueryTablePage, type QueryColumn } from "../../../components/QueryTablePage";
import { ReadOnlyValue } from "../../../components/ReadOnlyValue";
import { ErrorState } from "../../../components/StateBlock";
import { DETAIL_QUERY, LIST_QUERY } from "../../../lib/query";
import { readTableSearch, writeTableSearch } from "../../../lib/table-search";
import type { AgreementApi, AgreementItem, ConsentDetail, ConsentItem } from "./api";
import {
  CONSENT_KEYS,
  agreementSearch,
  consentQuery,
  failureText,
  type AgreementSearch,
} from "./model";

const at = (value: string) => appDateTimeFormat.dateTime(new Date(value));
const SCENE_LABELS: Readonly<Record<string, string>> = {
  login: "首次登录",
  reconsent: "重新同意",
  member_join: "加入成员",
  plan_purchase: "套餐购买",
  topup: "积分加购",
  order_submit: "提交订购",
  ad_request: "提交广告",
};
export function evidenceText(value: string | null): string {
  return (value ?? "—")
    .slice(0, 512)
    .replace(/\b1\d{10}\b/g, maskPhone)
    .replace(/\b[0-9A-Z]{18}\b/g, maskUscc)
    .replace(/\bBearer\s+\S+/gi, "Bearer [已隐藏]");
}
function ConsentFilters({
  search,
  agreements,
  onChange,
}: {
  search: AgreementSearch;
  agreements: readonly AgreementItem[];
  onChange: (value: AgreementSearch) => void;
}) {
  const [fields, setFields] = useState(search);
  const set = (key: string, value: string | undefined) =>
    setFields((old) => ({ ...old, [key]: value ?? "" }));
  const inputs = [
    ["consentNo", "同意记录编号"],
    ["no", "关联单据编号"],
    ["agreementVersionId", "协议版本ID"],
    ["merchantUserId", "商家用户ID"],
    ["entityId", "主体ID"],
    ["storeId", "门店ID"],
    ["bizId", "关联单据ID"],
  ] as const;
  const [error, setError] = useState<string>();
  function apply() {
    if (fields.bizId && !fields.bizType) {
      setError("关联单据ID须同时选择单据类型");
      return;
    }
    if (
      fields.consentedFrom &&
      fields.consentedTo &&
      (fields.consentedFrom > fields.consentedTo ||
        Date.parse(fields.consentedTo) - Date.parse(fields.consentedFrom) > 365 * 86400000)
    ) {
      setError("日期须为正序且最多366天");
      return;
    }
    const candidate = Object.fromEntries(
      CONSENT_KEYS.flatMap((key) => {
        const value = fields[key]?.trim();
        return value ? [[key, value]] : [];
      }),
    );
    if (!AdminAgreementConsentListQuerySchema.safeParse(candidate).success) {
      setError("筛选条件无效，请核对编号、对象ID与日期");
      return;
    }
    setError(undefined);
    onChange(agreementSearch({ ...candidate, tab: "evidence", page: "1" }));
  }
  return (
    <section aria-label="同意记录筛选" className="lyx-agreement-filters">
      <div className="lyx-agreement-filter-grid">
        <FormField label="协议">
          {(props) => (
            <Select
              {...props}
              allowClear
              value={fields.agreementKey || undefined}
              options={agreements.map((a) => ({ value: a.agreementKey, label: a.name }))}
              onChange={(v) => set("agreementKey", v)}
            />
          )}
        </FormField>
        <FormField label="签署场景">
          {(props) => (
            <Select
              {...props}
              allowClear
              value={fields.scene || undefined}
              options={AGREEMENT_CONSENT_SCENE.values.map((value) => ({
                value,
                label: SCENE_LABELS[value] ?? value,
              }))}
              onChange={(v) => set("scene", v)}
            />
          )}
        </FormField>
        <FormField label="签署方式">
          {(props) => (
            <Select
              {...props}
              allowClear
              value={fields.method || undefined}
              options={[
                { value: "checkbox", label: "勾选同意" },
                { value: "by_action", label: "行为同意" },
                { value: "prior_consent", label: "沿用既有同意" },
              ]}
              onChange={(v) => set("method", v)}
            />
          )}
        </FormField>
        <FormField label="关联单据类型">
          {(props) => (
            <Select
              {...props}
              allowClear
              value={fields.bizType || undefined}
              options={[
                { value: "billing_order", label: "付款单" },
                { value: "drama_order", label: "短剧订购单" },
                { value: "ad", label: "广告" },
              ]}
              onChange={(v) => set("bizType", v)}
            />
          )}
        </FormField>
        {inputs.map(([key, label]) => (
          <FormField key={key} label={label}>
            {(props) => (
              <Input
                {...props}
                value={fields[key] ?? ""}
                maxLength={key === "no" ? 40 : 36}
                onChange={(e) => set(key, e.target.value)}
                onPressEnter={apply}
              />
            )}
          </FormField>
        ))}
        <FormField label="签署日期（北京时间，含两端）">
          {(props) => (
            <DateRangeField
              {...props}
              placeholder={[fields.consentedFrom || "开始日期", fields.consentedTo || "结束日期"]}
              onChange={(_dates, text) =>
                setFields((old) => ({ ...old, consentedFrom: text[0], consentedTo: text[1] }))
              }
            />
          )}
        </FormField>
      </div>
      <p className="lyx-agreement-muted">
        未给编号或对象ID时，服务端默认查询近30天；单侧日期由服务端补界。没有关联单据不表示解除日期限制。
      </p>
      {error ? <Alert type="error" title={error} /> : null}
      <div className="lyx-agreement-actions">
        <Button type="primary" onClick={apply}>
          查询
        </Button>
        <Button onClick={() => onChange(agreementSearch({ tab: "evidence" }))}>重置</Button>
      </div>
    </section>
  );
}
function Evidence({
  row,
  download,
  busy,
}: {
  row: ConsentDetail;
  download: () => void;
  busy: boolean;
}) {
  return (
    <>
      {!row.isContentHashConsistent ? (
        <Alert type="error" title="正文摘要不一致，请联系管理员核查" />
      ) : null}
      <div className="lyx-agreement-evidence">
        <ReadOnlyValue label="同意记录编号" value={row.consentNo} />
        <ReadOnlyValue label="协议 / 版本" value={`${row.agreementName} · ${row.versionLabel}`} />
        <ReadOnlyValue label="签署时刻" value={at(row.consentedAt)} />
        <ReadOnlyValue
          label="签署场景 / 方式"
          value={`${evidenceText(typeof row.scene === "string" ? row.scene : null)} / ${typeof row.method === "string" ? row.method : "未知"}`}
        />
        <ReadOnlyValue label="手机号（脱敏）" value={row.phoneMask} />
        <ReadOnlyValue label="操作人（脱敏）" value={row.operatorNameMask ?? "—"} />
        <ReadOnlyValue
          label="主体 / 门店"
          value={`${row.entityName ?? "—"} / ${row.storeName ?? "—"}`}
        />
        <ReadOnlyValue label="统一社会信用代码（脱敏）" value={row.usccMask ?? "—"} />
        <ReadOnlyValue label="关联单据" value={row.bizNo ?? row.bizId ?? "—"} />
        <ReadOnlyValue label="IP（脱敏）" value={row.ipMask} />
        <ReadOnlyValue
          label="微信快照"
          value={row.hasOpenidSnapshot ? "已保留 OpenID 快照（不展示明文）" : "未取得 OpenID 快照"}
        />
        <ReadOnlyValue label="AppID" value={evidenceText(row.appid)} />
        <ReadOnlyValue label="User-Agent" value={evidenceText(row.userAgent)} />
        <ReadOnlyValue
          label="设备"
          value={
            Object.entries(row.device)
              .map(([key, value]) => `${key}: ${evidenceText(value ?? null)}`)
              .join("；") || "—"
          }
        />
        <ReadOnlyValue label="正文 SHA-256" value={row.contentSha256} />
        <ReadOnlyValue label="请求编号" value={row.requestId} />
      </div>
      <Button
        aria-label="下载该签署版本PDF"
        aria-busy={busy}
        disabled={busy}
        loading={busy}
        onClick={download}
      >
        下载该签署版本PDF
      </Button>
    </>
  );
}
export function AgreementConsents({
  api,
  actor,
  search,
  agreements,
  onChange,
  openUrl,
}: {
  api: AgreementApi;
  actor: string;
  search: AgreementSearch;
  agreements: readonly AgreementItem[];
  onChange: (value: AgreementSearch) => void;
  openUrl: (url: string) => void;
}) {
  const query = consentQuery(search),
    scope = JSON.stringify([actor, query]);
  const [selected, setSelected] = useState<{ scope: string; id: string }>(),
    [downloadError, setDownloadError] = useState<string>(),
    [downloading, setDownloading] = useState(false);
  const selectedId = selected?.scope === scope ? selected.id : undefined;
  const lifetime = useRef(0);
  useEffect(
    () => () => {
      lifetime.current++;
    },
    [scope, selectedId],
  );
  function pick(id?: string) {
    lifetime.current++;
    setSelected(id ? { scope, id } : undefined);
    setDownloading(false);
    setDownloadError(undefined);
  }
  const list = useQuery({
    queryKey: ["admin", "agreement-consents", actor, query],
    queryFn: ({ signal }) => api.consents(query, signal),
    ...LIST_QUERY,
    placeholderData: undefined,
  });
  const detail = useQuery({
    queryKey: ["admin", "agreement-consent", actor, selectedId],
    queryFn: ({ signal }) => api.consent(selectedId!, signal),
    enabled: Boolean(selectedId),
    ...DETAIL_QUERY,
  });
  const columns: readonly QueryColumn<ConsentItem>[] = [
    { key: "consentNo", title: "同意编号", render: (row) => row.consentNo, width: 120 },
    {
      key: "agreementName",
      title: "协议 / 版本",
      render: (row) => (
        <>
          {row.agreementName}
          <div>{row.versionLabel}</div>
        </>
      ),
    },
    {
      key: "phoneMask",
      title: "签署人",
      render: (row) => (
        <>
          {row.phoneMask}
          <div>{row.operatorNameMask ?? "—"}</div>
        </>
      ),
      mask: true,
      width: 150,
    },
    {
      key: "entityName",
      title: "主体 / 门店",
      render: (row) => (
        <>
          {row.entityName ?? "—"}
          <div>{row.storeName ?? "—"}</div>
        </>
      ),
    },
    { key: "bizNo", title: "关联单据", render: (row) => row.bizNo ?? "—", width: 140 },
    {
      key: "consentedAt",
      title: "签署时间",
      render: (row) => at(row.consentedAt),
      sortField: "consentedAt",
      width: 170,
    },
  ];
  async function download() {
    if (!detail.data || downloading) return;
    const captured = lifetime.current;
    setDownloading(true);
    setDownloadError(undefined);
    try {
      const versions = await api.get(detail.data.agreementKey),
        file = versions.versions.find(
          (v) => v.agreementVersionId === detail.data.agreementVersionId,
        )?.pdfFile;
      if (captured !== lifetime.current) return;
      if (!file) throw new Error("该签署版本的PDF不可用");
      const signed = await api.download(file.fileId);
      if (captured === lifetime.current) openUrl(signed.url);
    } catch (error) {
      if (captured === lifetime.current) setDownloadError(failureText(error));
    } finally {
      if (captured === lifetime.current) setDownloading(false);
    }
  }
  return (
    <>
      <ConsentFilters key={scope} search={search} agreements={agreements} onChange={onChange} />
      <QueryTablePage
        label="协议同意记录"
        search={readTableSearch(
          search,
          CONSENT_KEYS.filter((k) => !["page", "pageSize", "sort"].includes(k)),
        )}
        onSearchChange={(next) =>
          onChange(agreementSearch({ ...writeTableSearch(next), tab: "evidence" }))
        }
        columns={columns}
        rowKey={(row) => row.agreementConsentId}
        onRowClick={(row) => pick(row.agreementConsentId)}
        selectedRowKey={selectedId}
        query={
          list.isPending
            ? { status: "loading" }
            : list.isError
              ? { status: "error", message: list.error.message }
              : { status: "success", items: list.data.items, total: list.data.total }
        }
        refreshing={list.isFetching}
        onRetry={() => void list.refetch()}
        empty={{ title: "暂无同意记录" }}
      />
      <Drawer
        open={Boolean(selectedId)}
        title="同意记录证据"
        width={640}
        onClose={() => pick()}
        destroyOnHidden
      >
        {detail.isPending ? (
          <div aria-busy="true">证据加载中…</div>
        ) : detail.isError ? (
          <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />
        ) : detail.data ? (
          <Evidence row={detail.data} busy={downloading} download={() => void download()} />
        ) : null}
        {downloadError ? <Alert type="error" title={downloadError} /> : null}
      </Drawer>
    </>
  );
}
