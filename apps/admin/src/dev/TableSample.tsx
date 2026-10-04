// 筛选表格骨架的样例页：页面只填页签、筛选项、列定义、取数与行操作。
import { formatInteger, formatMoneyFixed } from "@liyoxi/shared/format/money";
import { appDateTimeFormat } from "@liyoxi/shared/format/datetime";
import { statusToneByEnum } from "@liyoxi/shared/design/status-tone";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";

import { PageHeader } from "../components/PageHeader";
import { QueryTablePage, type QueryColumn, type QueryState } from "../components/QueryTablePage";
import { StatusTag } from "../components/StatusTag";
import { LIST_QUERY } from "../lib/query";
import { readTableSearch, toListQuery, writeTableSearch } from "../lib/table-search";
import { rootRoute } from "../routes/__root";

import { DEV_FIXTURE_MARK } from "./mark";
import { SampleApiError, sampleClient } from "./sample-api";
import type { SampleStore } from "./sample-data";

// 不直接 import 路由对象：路由文件反过来动态引入本页，直接引会成环
const route = getRouteApi("/dev/table");

const FILTER_KEYS = ["region", "source"] as const;

const columns: QueryColumn<SampleStore>[] = [
  {
    key: "store",
    title: "商家",
    render: (store) => (
      <div className="lyx-cell-2">
        <span className="lyx-cell-2__main lyx-cell-2__main--strong">{store.name}</span>
        <span className="lyx-cell-2__sub">{store.entityName}</span>
      </div>
    ),
  },
  {
    key: "region",
    title: "区域 · 品类",
    width: 150,
    render: (store) => (
      <div className="lyx-cell-2">
        <span className="lyx-cell-2__main">{store.region}</span>
        <span className="lyx-cell-2__sub">{store.category}</span>
      </div>
    ),
  },
  {
    key: "status",
    title: "审核状态",
    width: 88,
    render: (store) => {
      const tone = statusToneByEnum("store.qualification_status", store.qualificationStatus)?.admin;
      return tone ? <StatusTag tone={tone.tone}>{tone.label}</StatusTag> : null;
    },
  },
  {
    key: "source",
    title: "来源",
    width: 84,
    render: (store) => (store.source === "sales" ? "销售" : "自然流量"),
  },
  { key: "manager", title: "交付经理", width: 84, render: (store) => store.manager ?? "未分配" },
  {
    key: "plan",
    title: "套餐",
    width: 116,
    render: (store) => (
      <div className="lyx-cell-2">
        <span className="lyx-cell-2__main">{store.planName}</span>
        <span className="lyx-cell-2__sub">
          {appDateTimeFormat.date(store.planExpireDay).slice(5)} 到期
        </span>
      </div>
    ),
  },
  {
    key: "points",
    title: "可用积分",
    width: 104,
    align: "right",
    sortField: "availablePoints",
    render: (store) => <span className="lyx-num">{formatInteger(store.availablePoints)}</span>,
  },
  {
    key: "paid",
    title: "累计实付",
    width: 116,
    align: "right",
    sortField: "paidFen",
    render: (store) => <span className="lyx-num">{formatMoneyFixed(store.paidFen)}</span>,
  },
  {
    key: "lastOrder",
    title: "最近订购",
    width: 104,
    render: (store) => (
      <span className="lyx-num">{appDateTimeFormat.dateTime(store.lastOrderAt)}</span>
    ),
  },
  {
    key: "action",
    title: "操作",
    width: 64,
    align: "right",
    render: (store) => (
      <Link className="lyx-link" to="/dev/detail/$storeId" params={{ storeId: store.id }}>
        详情
      </Link>
    ),
  },
];

export function TableSample() {
  const { services } = rootRoute.useRouteContext();
  const navigate = route.useNavigate();
  const search = readTableSearch(route.useSearch(), FILTER_KEYS);
  const client = sampleClient(services);
  const listQuery = toListQuery(search);

  const list = useQuery({
    queryKey: ["samples", "stores", "list", listQuery],
    queryFn: async () => {
      const { data, error } = await client.GET("/admin/samples/stores", {
        params: { query: listQuery },
      });
      if (!data) throw new SampleApiError(error);
      return data.data;
    },
    ...LIST_QUERY,
  });
  // 页签计数由 summary 接口给，查询参数与列表相同（除页签与分页外，约定 C83）
  const { tab: _tab, page: _page, pageSize: _pageSize, sort: _sort, ...summaryQuery } = listQuery;
  const summary = useQuery({
    queryKey: ["samples", "stores", "summary", summaryQuery],
    queryFn: async () => {
      const { data, error } = await client.GET("/admin/samples/stores/summary", {
        params: { query: summaryQuery },
      });
      if (!data) throw new SampleApiError(error);
      return data.data;
    },
    ...LIST_QUERY,
  });

  const query: QueryState<SampleStore> =
    list.status === "pending"
      ? { status: "loading" }
      : list.status === "error"
        ? { status: "error", message: list.error.message }
        : { status: "success", items: list.data.items, total: list.data.total };

  return (
    <div data-fixture={DEV_FIXTURE_MARK} style={{ display: "contents" }}>
      <PageHeader
        title="商家列表"
        subtitle="样例页：筛选表格骨架，数据是夹具。商家以门店为单位；同一经营主体名下的门店共用套餐与积分。"
      />
      <QueryTablePage<SampleStore>
        label="商家列表"
        tabs={[
          { key: "all", label: "全部", count: summary.data?.all },
          { key: "pending", label: "待审核", count: summary.data?.pending },
          { key: "verified", label: "已通过", count: summary.data?.verified },
        ]}
        search={search}
        onSearchChange={(next) => void navigate({ search: writeTableSearch(next) })}
        keywordPlaceholder="商家、主体名称"
        filters={[
          {
            key: "region",
            placeholder: "全部区域",
            options: ["成华区", "武侯区", "金牛区", "锦江区", "高新区"].map((value) => ({
              value,
              label: value,
            })),
          },
          {
            key: "source",
            placeholder: "全部来源",
            options: [
              { value: "sales", label: "销售" },
              { value: "organic", label: "自然流量" },
            ],
          },
        ]}
        columns={columns}
        rowKey={(store) => store.id}
        query={query}
        refreshing={list.isFetching && list.status !== "pending"}
        onRetry={() => void list.refetch()}
        rowTone={(store) => (store.qualificationStatus === "rejected" ? "danger" : undefined)}
      />
    </div>
  );
}
