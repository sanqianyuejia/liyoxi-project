import { appDateTimeFormat } from "@liyoxi/shared/format/datetime";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useRouteContext } from "@tanstack/react-router";
import { Alert, Button, Select, Table, type TableColumnsType } from "antd";
import { useContext, useEffect, useState } from "react";
import { MasterDetailPage, type MasterDetailState } from "../../../components/MasterDetailPage";
import { PageHeader } from "../../../components/PageHeader";
import { Tabs } from "../../../components/Tabs";
import { EmptyState, ErrorState } from "../../../components/StateBlock";
import { clickableRowProps } from "../../../components/QueryTablePage";
import { AccessContext, type AccessSnapshot } from "../../../lib/permissions";
import { DETAIL_QUERY, LIST_QUERY } from "../../../lib/query";
import { AuditFailure, createAuditApi, type AuditItem } from "./api";
import {
  AUDIT_KEY,
  actorKey,
  approxSummary,
  auditQuery,
  auditSearch,
  canSeeAccess,
  categoryLabel,
  changeFilter,
  cursorScope,
  type AuditSearch,
} from "./model";
import { safeText } from "./display";
import { AuditFilters } from "./filters";
import { AuditDetailPanel } from "./detail";
import "./logs.css";
const route = getRouteApi("/sys/logs");
export function AuditLogsPage() {
  const access = useContext(AccessContext);
  // 员工或权限身份改变时私有选择/游标栈随整页重建，缓存键同时隔离。
  return <AuditLogsContent key={actorKey(access)} access={access} />;
}
function AuditLogsContent({ access }: { access: AccessSnapshot | null }) {
  const { services } = useRouteContext({ from: "__root__" }),
    navigate = route.useNavigate(),
    search = auditSearch(route.useSearch()),
    query = auditQuery(search),
    api = createAuditApi(services);
  const identity = actorKey(access),
    [histories, setHistories] = useState<Record<string, Record<string, string | undefined>>>({}),
    [notice, setNotice] = useState<string>();
  const scope = cursorScope(search),
    history = histories[scope] ?? {};
  const list = useQuery({
    queryKey: [...AUDIT_KEY, identity, "list", query],
    queryFn: () => api.list(query),
    ...LIST_QUERY,
    placeholderData: undefined,
  });
  const detail = useQuery({
    queryKey: [...AUDIT_KEY, identity, "detail", search.id],
    queryFn: () => api.get(search.id!),
    enabled: Boolean(search.id),
    ...DETAIL_QUERY,
  });
  const change = (next: AuditSearch) => void navigate({ search: next });
  const filter = (patch: Record<string, string | undefined>) => {
    setHistories({});
    setNotice(undefined);
    change(changeFilter(search, patch));
  };
  const selectionInvalid =
    [detail.error, list.error].some(
      (failure) =>
        failure instanceof AuditFailure &&
        ["AUTH_REQUIRED", "SESSION_INVALID", "PERMISSION_DENIED", "NOT_FOUND"].includes(
          failure.code,
        ),
    ) || Boolean(detail.data && detail.data.stream !== query.stream);
  useEffect(() => {
    if (search.id && selectionInvalid) {
      const next = { ...search };
      delete next.id;
      void navigate({ search: next, replace: true }).then(() =>
        setNotice("记录不存在或无权查看，请重新选择记录"),
      );
    }
  }, [selectionInvalid, search, navigate]);
  const select = (id: string | undefined) => {
    setNotice(undefined);
    const next = { ...search };
    if (id) next.id = id;
    else delete next.id;
    change(next);
  };
  let state: MasterDetailState | undefined;
  if (search.id && !selectionInvalid)
    state = detail.isPending
      ? { key: search.id, status: "loading" }
      : detail.isError
        ? { key: search.id, status: "error", message: detail.error.message }
        : detail.data
          ? {
              key: search.id,
              status: "ready",
              content: <AuditDetailPanel detail={detail.data} access={access} />,
            }
          : { key: search.id, status: "empty" };
  const columns: TableColumnsType<AuditItem> = [
    {
      key: "createdAt",
      title: "时间",
      width: 132,
      render: (_, row) => <span>{appDateTimeFormat.dateTime(new Date(row.createdAt))}</span>,
    },
    {
      key: "actor",
      title: "操作人",
      width: 106,
      render: (_, row) => (
        <span className="lyx-cell-2">
          {safeText(row.actor.name)}
          <span className="lyx-cell-2__sub">{safeText(row.actor.role)}</span>
        </span>
      ),
    },
    { key: "category", title: "类别", width: 112, render: (_, row) => categoryLabel(row.category) },
    {
      key: "summary",
      title: (
        <span>
          操作内容<span className="lyx-column-mask">已脱敏</span>
        </span>
      ),
      render: (_, row) => (
        <span className="lyx-cell-2">
          {safeText(row.summary)}
          <span className="lyx-cell-2__sub">{safeText(row.target?.label ?? row.logNo)}</span>
        </span>
      ),
    },
  ];
  return (
    <>
      <PageHeader title="操作日志" subtitle="查询关键操作与访问留痕，时间按北京时间显示" />
      {canSeeAccess(access) ? (
        <Tabs
          label="审计记录流"
          activeKey={query.stream ?? "ops"}
          items={[
            { key: "ops", label: "操作日志" },
            { key: "access", label: "PII / 敏感签发留痕" },
          ]}
          onChange={(stream) => filter({ stream, category: undefined })}
        />
      ) : null}
      <AuditFilters
        key={`${identity}:${query.stream}:${search.q ?? ""}`}
        search={search}
        onChange={filter}
      />
      {notice ? <Alert type="warning" title={notice} /> : null}
      <MasterDetailPage
        label="审计日志主从视图"
        selectedKey={search.id}
        onSelect={select}
        detail={state}
        detailTitle="日志详情"
        onRetry={() => void detail.refetch()}
        list={({ selectedKey, onSelect }) => (
          <section className="lyx-card lyx-audit-list" aria-label="日志列表">
            {list.isPending ? (
              <p aria-busy="true">日志加载中</p>
            ) : list.isError ? (
              list.error instanceof AuditFailure && list.error.code === "PERMISSION_DENIED" ? (
                <EmptyState title="无权查看访问留痕" description="访问留痕仅超级管理员可查看" />
              ) : (
                <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
              )
            ) : list.data ? (
              <>
                {list.data.items.length ? (
                  <Table<AuditItem>
                    className="lyx-table"
                    tableLayout="fixed"
                    columns={columns}
                    dataSource={list.data.items}
                    rowKey="auditLogId"
                    pagination={false}
                    loading={list.isFetching}
                    rowClassName={(row) =>
                      row.auditLogId === selectedKey
                        ? "lyx-row--clickable lyx-row--selected"
                        : "lyx-row--clickable"
                    }
                    onRow={(row) => ({
                      ...clickableRowProps(() => onSelect(row.auditLogId)),
                      "aria-selected": row.auditLogId === selectedKey,
                    })}
                  />
                ) : (
                  <EmptyState
                    title={
                      Object.keys(query).some((key) => !["stream", "limit"].includes(key))
                        ? "没有符合条件的日志"
                        : "暂无日志"
                    }
                  />
                )}
                <div className="lyx-audit-pager">
                  <span>{approxSummary(list.data.totalApprox)}</span>
                  <Select
                    aria-label="每页条数"
                    value={query.limit ?? 20}
                    options={[10, 20, 50, 100].map((value) => ({ value, label: `${value} 条` }))}
                    onChange={(value: number) => filter({ limit: String(value) })}
                  />
                  <Button
                    disabled={!search.cursor || list.isFetching}
                    onClick={() => {
                      const previous = history[search.cursor ?? ""];
                      const next = { ...search };
                      delete next.id;
                      if (previous) next.cursor = previous;
                      else delete next.cursor;
                      change(next);
                    }}
                  >
                    {Object.hasOwn(history, search.cursor ?? "") ? "上一页" : "返回首页"}
                  </Button>
                  <Button
                    disabled={!list.data.hasMore || !list.data.nextCursor || list.isFetching}
                    onClick={() => {
                      setHistories((value) => ({
                        ...value,
                        [scope]: { ...value[scope], [list.data!.nextCursor!]: search.cursor },
                      }));
                      const next: AuditSearch = { ...search, cursor: list.data!.nextCursor! };
                      delete next.id;
                      change(next);
                    }}
                  >
                    下一页
                  </Button>
                </div>
              </>
            ) : null}
          </section>
        )}
      />
    </>
  );
}
