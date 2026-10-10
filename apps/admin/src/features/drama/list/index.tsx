import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useRouteContext } from "@tanstack/react-router";
import { Button } from "antd";
import { useContext, useMemo, useState } from "react";
import { PageHeader } from "../../../components/PageHeader";
import {
  QueryTablePage,
  type QueryColumn,
  type QueryState,
} from "../../../components/QueryTablePage";
import { StatusTag } from "../../../components/StatusTag";
import { AccessContext, Can } from "../../../lib/permissions";
import { LIST_QUERY, DETAIL_QUERY, DICT_QUERY } from "../../../lib/query";
import { writeTableSearch } from "../../../lib/table-search";
import { createDramaApi } from "../edit/api";
import { contentScope, statusLabel, pointsText } from "../edit/model";
import { createDramaListApi } from "./api";
import { dramaQuery, dramaSearch } from "./model";
import { ListingDialog, NewDramaDialog } from "./dialogs";
import "./drama-list.css";

const route = getRouteApi("/dramas");
export function DramaListPage() {
  return <DramaListWorkspace key={contentScope(useContext(AccessContext))} />;
}
function DramaListWorkspace() {
  const { services } = useRouteContext({ from: "__root__" });
  const scope = contentScope(useContext(AccessContext));
  const api = useMemo(() => createDramaListApi(services), [services]);
  const reads = useMemo(() => createDramaApi(services), [services]);
  const navigate = route.useNavigate();
  const search = dramaSearch(route.useSearch());
  const list = useQuery({
    queryKey: ["drama", "list", scope, dramaQuery(search)],
    queryFn: ({ signal }) => api.list(dramaQuery(search), signal),
    ...LIST_QUERY,
  });
  const summary = useQuery({
    queryKey: ["drama", "summary", scope],
    queryFn: ({ signal }) => api.summary(signal),
    ...DETAIL_QUERY,
  });
  const dict = useQuery({
    queryKey: ["drama", "dict", scope],
    queryFn: ({ signal }) => reads.dict("genre,industry", signal),
    ...DICT_QUERY,
  });
  const [creating, setCreating] = useState(false);
  const [command, setCommand] = useState<{ id: string; action: "shelve" | "delist" }>();
  const open = (id: string) =>
    void navigate({
      to: "/dramas/$id",
      params: { id },
      search: { tab: "basic", returnTo: `${window.location.pathname}${window.location.search}` },
    });
  const refresh = () => {
    void list.refetch();
    void summary.refetch();
  };
  type Row = NonNullable<typeof list.data>["items"][number];
  const columns: QueryColumn<Row>[] = [
    {
      key: "title",
      title: "短剧",
      render: (row) => (
        <div className="drama-list-title">
          {row.posterUrl ? (
            <img alt="" src={row.posterUrl.url} />
          ) : (
            <span className="drama-list-poster">剧</span>
          )}
          <span className="lyx-cell-2">
            <strong>{row.title}</strong>
            <span className="lyx-cell-2__sub">
              {row.totalEpisodes ?? "—"} 集 ·{" "}
              {row.genres.map((v) => v.name).join(" / ") || "未选题材"}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: "heat",
      title: "等级 / 积分价",
      width: 130,
      render: (row) => (
        <div className="lyx-cell-2">
          <strong>
            {row.heatTier ?? "—"} · {pointsText(row.listPricePoints)}
          </strong>
          <span className="lyx-cell-2__sub">
            {row.priceMode === "custom" ? `模板 ${pointsText(row.templatePoints)}` : "按模板定价"}
          </span>
        </div>
      ),
    },
    {
      key: "license",
      title: "授权期",
      width: 150,
      render: (row) => (
        <div className="lyx-cell-2">
          <span>{row.licenseEndDate ?? "未填写"}</span>
          <span className="lyx-cell-2__sub">
            {row.stopOrderDate ? `${row.stopOrderDate} 起停订` : "—"}
          </span>
        </div>
      ),
    },
    {
      key: "stats",
      title: "上线 / 本月订购",
      width: 125,
      align: "right",
      render: (row) =>
        row.status === "draft" ? "—" : `${row.liveItems ?? "—"} / ${row.ordersMtd ?? "—"}`,
    },
    {
      key: "status",
      title: "状态",
      width: 100,
      render: (row) => (
        <StatusTag tone={row.status === "listed" ? "success" : "neutral"}>
          {row.archivedAt ? "已归档" : statusLabel(row.status)}
        </StatusTag>
      ),
    },
    {
      key: "actions",
      title: "操作",
      width: 140,
      render: (row) => (
        <>
          <Button type="link" onClick={() => open(row.dramaId)}>
            编辑 / 查看
          </Button>
          {row.actions.includes("shelve") ? (
            <Button type="link" onClick={() => setCommand({ id: row.dramaId, action: "shelve" })}>
              上架
            </Button>
          ) : row.actions.includes("delist") ? (
            <Button
              type="link"
              danger
              onClick={() => setCommand({ id: row.dramaId, action: "delist" })}
            >
              下架
            </Button>
          ) : null}
        </>
      ),
    },
  ];
  const query: QueryState<Row> = list.isPending
    ? { status: "loading" }
    : list.isError
      ? { status: "error", message: list.error.message }
      : { status: "success", items: list.data.items, total: list.data.total };
  return (
    <div className="drama-list">
      <PageHeader
        title="短剧库"
        subtitle={
          summary.data
            ? `已上架 ${summary.data.counts.listed} 部 · 草稿 ${summary.data.counts.draft} 部 · 已下架 ${summary.data.counts.delisted} 部 · ${summary.data.expiringWindowDays} 天内到期 ${summary.data.expiringSoon} 部`
            : summary.isError
              ? "汇总读取失败，请重新加载"
              : "正在读取汇总…"
        }
        extra={
          <Can module="drama" need="e">
            <Button type="primary" size="large" onClick={() => setCreating(true)}>
              新建短剧
            </Button>
          </Can>
        }
      />
      <QueryTablePage
        label="短剧列表"
        search={search}
        onSearchChange={(next) => void navigate({ search: writeTableSearch(next) })}
        tabs={[
          { key: "all", label: "全部" },
          { key: "listed", label: "已上架" },
          { key: "draft", label: "草稿" },
          { key: "delisted", label: "已下架" },
        ]}
        defaultTab="all"
        keywordPlaceholder="搜索剧名"
        filters={[
          {
            key: "genreCode",
            placeholder: "全部题材",
            options: (dict.data ?? [])
              .filter((v) => v.typeKey === "genre")
              .map((v) => ({ value: v.code, label: v.name })),
          },
          {
            key: "industryCode",
            placeholder: "全部行业",
            options: (dict.data ?? [])
              .filter((v) => v.typeKey === "industry" && v.parentCode === null)
              .map((v) => ({ value: v.code, label: v.name })),
          },
          {
            key: "isOrderable",
            placeholder: "订购状态",
            options: [
              { value: "true", label: "可订购" },
              { value: "false", label: "不可订购" },
            ],
          },
          {
            key: "isArchived",
            placeholder: "归档状态",
            options: [
              { value: "false", label: "未归档" },
              { value: "true", label: "已归档" },
            ],
          },
          {
            key: "heatTier",
            placeholder: "全部等级",
            options: ["S", "A", "B", "C"].map((value) => ({ value, label: `${value} 级` })),
          },
          {
            key: "dramaClass",
            placeholder: "全部类别",
            options: [
              { value: "class_1", label: "一类" },
              { value: "class_2", label: "二类" },
              { value: "class_3", label: "三类" },
            ],
          },
          {
            key: "isExpiringSoon",
            placeholder: "授权期",
            options: [{ value: "true", label: "仅看即将到期" }],
          },
        ]}
        columns={columns}
        rowKey={(row) => row.dramaId}
        query={query}
        refreshing={list.isFetching}
        onRetry={refresh}
        onRowClick={(row) => open(row.dramaId)}
        toolbar={
          <Button disabled title="M7 导出能力尚未开放">
            导出
          </Button>
        }
      />
      {creating ? (
        <NewDramaDialog
          api={api}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            refresh();
            open(id);
          }}
        />
      ) : null}
      {command ? (
        <ListingDialog
          key={`${command.id}-${command.action}`}
          api={api}
          id={command.id}
          action={command.action}
          onClose={() => setCommand(undefined)}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}
