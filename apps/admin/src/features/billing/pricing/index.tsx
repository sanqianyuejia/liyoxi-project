import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useRouteContext } from "@tanstack/react-router";
import { Alert, Button } from "antd";
import { useContext, useMemo, useState } from "react";
import { PageHeader } from "../../../components/PageHeader";
import {
  QueryTablePage,
  type QueryColumn,
  type QueryState,
} from "../../../components/QueryTablePage";
import { ReadOnlyValue } from "../../../components/ReadOnlyValue";
import { AccessContext, canAction } from "../../../lib/permissions";
import { DETAIL_QUERY, LIST_QUERY, DICT_QUERY } from "../../../lib/query";
import { writeTableSearch, type TableSearch } from "../../../lib/table-search";
import { contentScope, pointsText, statusLabel } from "../../drama/edit/model";
import { createPricingApi, type PriceRow, type PriceRevision } from "./api";
import { PriceDialog, WithdrawPriceDialog } from "./dialogs";
import { pricingQuery, pricingSearch, priceSummaryQuery, PRICE_REASONS } from "./model";
import "./pricing.css";
const route = getRouteApi("/billing/pricing");
const tabs = [
  { key: "dramas", label: "单剧积分价" },
  { key: "history", label: "调价记录" },
  { key: "templates", label: "等级模板（只读）" },
];
export function PricingPage() {
  return <PricingWorkspace key={contentScope(useContext(AccessContext))} />;
}
function PricingWorkspace() {
  const { services } = useRouteContext({ from: "__root__" });
  const access = useContext(AccessContext);
  const scope = contentScope(access);
  const api = useMemo(() => createPricingApi(services), [services]);
  const search = pricingSearch(route.useSearch());
  const navigate = route.useNavigate();
  const [editing, setEditing] = useState<PriceRow>();
  const [withdrawing, setWithdrawing] = useState<PriceRevision>();
  const list = useQuery({
    queryKey: ["pricing", "list", scope, pricingQuery(search)],
    queryFn: ({ signal }) => api.list(pricingQuery(search), signal),
    enabled: search.tab === "dramas",
    ...LIST_QUERY,
  });
  const summary = useQuery({
    queryKey: ["pricing", "summary", scope, priceSummaryQuery(search)],
    queryFn: ({ signal }) => api.summary(priceSummaryQuery(search), signal),
    enabled: search.tab === "dramas",
    ...DETAIL_QUERY,
  });
  const history = useQuery({
    queryKey: ["pricing", "history", scope, pricingQuery(search)],
    queryFn: ({ signal }) => api.history(pricingQuery(search), signal),
    enabled: search.tab === "history",
    ...LIST_QUERY,
  });
  const tiers = useQuery({
    queryKey: ["pricing", "tiers", scope],
    queryFn: ({ signal }) => api.tiers(signal),
    enabled: search.tab === "templates",
    ...DICT_QUERY,
  });
  const refresh = () => {
    void list.refetch();
    void summary.refetch();
    if (search.tab === "history") void history.refetch();
  };
  const canEdit = canAction(access, "billing.price.edit");
  const priceColumns: QueryColumn<PriceRow>[] = [
    {
      key: "title",
      title: "短剧 / 等级",
      sortField: "title",
      render: (row) => (
        <div className="lyx-cell-2">
          <strong>{row.title}</strong>
          <span className="lyx-cell-2__sub">
            {row.heatTier ?? "未评级"} · {statusLabel(row.status)}
            {row.archivedAt ? " · 已归档" : ""}
          </span>
        </div>
      ),
    },
    {
      key: "template",
      title: "模板价 T",
      align: "right",
      width: 100,
      render: (row) => pointsText(row.templatePoints),
    },
    {
      key: "price",
      title: "积分价 P",
      align: "right",
      width: 125,
      sortField: "listPricePoints",
      render: (row) => (
        <div className="lyx-cell-2">
          <strong>{pointsText(row.listPricePoints)}</strong>
          <span className="lyx-cell-2__sub">
            {row.priceMode === "custom"
              ? "单剧调整"
              : row.priceMode === "template"
                ? "模板"
                : "未定价"}
          </span>
        </div>
      ),
    },
    {
      key: "plans",
      title: "套餐实扣",
      render: (row) => (
        <div className="pricing-plan-values">
          {row.planPrices.map((plan) => (
            <span key={plan.planId}>
              {plan.planName}：{pointsText(plan.discountedPoints)}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "license",
      title: "授权止日 / 停订日",
      width: 165,
      render: (row) => (
        <div className="lyx-cell-2">
          <span>{row.licenseEndDate ?? "—"}</span>
          <span className="lyx-cell-2__sub">{row.stopOrderDate ?? "—"}</span>
        </div>
      ),
    },
    {
      key: "effective",
      title: "生效 / 待生效",
      width: 180,
      render: (row) => (
        <div className="lyx-cell-2">
          <span>{row.pricedSince ?? "未生效"}</span>
          {row.pendingRevision ? (
            <span className="lyx-cell-2__sub">
              待生效 {pointsText(row.pendingRevision.newPoints)} · {row.pendingRevision.effectiveAt}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "actions",
      title: "操作",
      width: 105,
      render: (row) =>
        canEdit && row.canCreatePriceRevision ? (
          <Button type="link" onClick={() => setEditing(row)}>
            调价
          </Button>
        ) : (
          <span title={row.priceLockReason ?? "无调价权限"}>只读</span>
        ),
    },
  ];
  const historyColumns: QueryColumn<PriceRevision>[] = [
    { key: "title", title: "短剧", render: (row) => row.dramaTitle },
    {
      key: "change",
      title: "调价",
      width: 160,
      render: (row) => `${pointsText(row.prevPoints)} → ${pointsText(row.newPoints)}`,
    },
    {
      key: "reason",
      title: "原因 / 备注",
      render: (row) => (
        <div className="lyx-cell-2">
          <span>
            {PRICE_REASONS.find((v) => v.value === row.reasonCode)?.label ?? row.reasonCode}
          </span>
          <span className="lyx-cell-2__sub">{row.note ?? "—"}</span>
        </div>
      ),
    },
    {
      key: "effective",
      title: "生效时间",
      sortField: "effectiveAt",
      width: 180,
      render: (row) => row.effectiveAt,
    },
    {
      key: "state",
      title: "状态",
      width: 90,
      render: (row) =>
        row.state === "pending"
          ? "待生效"
          : row.state === "effective"
            ? "已生效"
            : row.state === "withdrawn"
              ? "已撤销"
              : row.state,
    },
    { key: "actor", title: "操作人", width: 110, render: (row) => row.createdBy.name },
    {
      key: "actions",
      title: "操作",
      width: 100,
      render: (row) =>
        canEdit && row.actions.includes("withdraw") ? (
          <Button type="link" danger onClick={() => setWithdrawing(row)}>
            撤销
          </Button>
        ) : (
          "—"
        ),
    },
  ];
  const priceState: QueryState<PriceRow> = list.isPending
    ? { status: "loading" }
    : list.isError
      ? { status: "error", message: list.error.message }
      : { status: "success", items: list.data.items, total: list.data.total };
  const historyState: QueryState<PriceRevision> = history.isPending
    ? { status: "loading" }
    : history.isError
      ? { status: "error", message: history.error.message }
      : { status: "success", items: history.data.items, total: history.data.total };
  const changeSearch = (next: TableSearch) => void navigate({ search: writeTableSearch(next) });
  return (
    <div className="pricing-page">
      <PageHeader
        title="单剧积分价"
        subtitle={
          summary.data && search.tab === "dramas"
            ? `已上架 ${summary.data.listed} 部 · 单剧调整 ${summary.data.customPriced} 部 · 本月订购 ${summary.data.ordersMonth} · 最短可订 ${summary.data.minLicenseMonths} 个月`
            : "模板价与套餐实扣均以服务端事实为准"
        }
      />
      {search.tab === "templates" ? (
        <section className="lyx-card pricing-templates">
          <div role="tablist" aria-label="定价页签">
            {tabs.map((tab) => (
              <Button
                key={tab.key}
                type={tab.key === "templates" ? "primary" : "default"}
                role="tab"
                aria-selected={tab.key === "templates"}
                onClick={() => changeSearch({ ...search, tab: tab.key, page: 1, filters: {} })}
              >
                {tab.label}
              </Button>
            ))}
          </div>
          <h2>等级积分价模板</h2>
          {tiers.isPending ? (
            <p aria-busy="true">读取模板…</p>
          ) : tiers.isError ? (
            <Alert
              type="error"
              title={tiers.error.message}
              action={<Button onClick={() => void tiers.refetch()}>重试</Button>}
            />
          ) : (
            <div className="pricing-tier-grid">
              {tiers.data.items.map((tier) => (
                <ReadOnlyValue
                  key={tier.tier}
                  label={`${tier.tier} 级`}
                  value={`${pointsText(tier.points)} 积分`}
                  reason={`${tier.templateDramaCount} 部按模板 · 生效 ${tier.effectiveAt}`}
                />
              ))}
            </div>
          )}
          <p>模板仅查看。模板批量管理随 M4 开放，本页不提供伪执行入口。</p>
        </section>
      ) : search.tab === "history" ? (
        <QueryTablePage
          label="调价记录"
          tabs={tabs}
          defaultTab="dramas"
          search={search}
          onSearchChange={changeSearch}
          filters={[
            {
              key: "state",
              placeholder: "全部状态",
              options: [
                { value: "pending", label: "待生效" },
                { value: "effective", label: "已生效" },
                { value: "withdrawn", label: "已撤销" },
              ],
            },
          ]}
          columns={historyColumns}
          rowKey={(row) => row.dramaPriceRevisionId}
          query={historyState}
          refreshing={history.isFetching}
          onRetry={() => void history.refetch()}
        />
      ) : (
        <QueryTablePage
          label="单剧积分价"
          tabs={tabs}
          defaultTab="dramas"
          search={search}
          onSearchChange={changeSearch}
          keywordPlaceholder="搜索剧名"
          filters={[
            {
              key: "heatTier",
              placeholder: "全部等级",
              options: ["S", "A", "B", "C"].map((value) => ({ value, label: `${value} 级` })),
            },
            {
              key: "priceMode",
              placeholder: "全部定价模式",
              options: [
                { value: "custom", label: "单剧价" },
                { value: "template", label: "模板价" },
              ],
            },
            {
              key: "status",
              placeholder: "全部状态",
              options: [
                { value: "listed", label: "已上架" },
                { value: "draft", label: "草稿" },
                { value: "delisted", label: "已下架" },
              ],
            },
          ]}
          columns={priceColumns}
          rowKey={(row) => row.dramaId}
          query={priceState}
          refreshing={list.isFetching}
          onRetry={refresh}
        />
      )}
      {summary.isError && search.tab === "dramas" ? (
        <Alert
          type="warning"
          title="定价汇总读取失败"
          action={<Button onClick={() => void summary.refetch()}>重试</Button>}
        />
      ) : null}
      {editing ? (
        <PriceDialog
          api={api}
          row={editing}
          onClose={() => setEditing(undefined)}
          onSaved={refresh}
        />
      ) : null}
      {withdrawing ? (
        <WithdrawPriceDialog
          api={api}
          revision={withdrawing}
          onClose={() => setWithdrawing(undefined)}
          onSaved={() => {
            void history.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
