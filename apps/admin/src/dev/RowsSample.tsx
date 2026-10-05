// 整行可点的表格的样例页：点一行，在右侧抽屉里看只读的补充详情（规范 第 5.3 节“抽屉”的用法）；
// 行里另有文字链与行内按钮，各管各的，不带着整行的动作一起触发；筛选条右侧放一个分段控件。
// 给冒烟核对三件要在浏览器里才量得出的事：行内控件的点击与回车不冒泡成整行的动作、分段控件与抽屉用键盘走到时的样子。
// 数据是写在本文件里的夹具，不走接口；只有“正在看的凭证”进地址（行里的文字链是一条真的链接）。
import { formatMoneyFixed } from "@liyoxi/shared/format/money";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Alert, Button, Drawer, Segmented } from "antd";
import { useState } from "react";

import { InfoList } from "../components/InfoList";
import { PageHeader } from "../components/PageHeader";
import { QueryTablePage, type QueryColumn } from "../components/QueryTablePage";
import { StatusTag } from "../components/StatusTag";
import { readTableSearch } from "../lib/table-search";

import { DEV_FIXTURE_MARK } from "./mark";

// 不直接 import 路由对象：路由文件反过来动态引入本页，直接引会成环
const route = getRouteApi("/dev/rows");

interface Payment {
  id: string;
  payer: string;
  orderNo: string;
  amountFen: number;
  confirmed: boolean;
}

const PAYMENTS: readonly Payment[] = [
  {
    id: "pay-1",
    payer: "成都晴天洗衣有限公司",
    orderNo: "DG2610050001",
    amountFen: 300000,
    confirmed: false,
  },
  {
    id: "pay-2",
    payer: "青柠茶饮（个体工商户）",
    orderNo: "DG2610050002",
    amountFen: 1280000,
    confirmed: false,
  },
  {
    id: "pay-3",
    payer: "好运来便利店",
    orderNo: "DG2610040007",
    amountFen: 80000,
    confirmed: true,
  },
];

type Scope = "all" | "pending" | "confirmed";

const SCOPES: readonly { value: Scope; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待确认" },
  { value: "confirmed", label: "已确认" },
];

export function RowsSample() {
  const { voucher } = route.useSearch();
  const [search, setSearch] = useState(() => readTableSearch({}));
  const [scope, setScope] = useState<Scope>("all");
  const [opened, setOpened] = useState<Payment | null>(null);
  const [rowHits, setRowHits] = useState(0);
  const [buttonHits, setButtonHits] = useState(0);

  const items = PAYMENTS.filter(
    (payment) => scope === "all" || payment.confirmed === (scope === "confirmed"),
  );

  const columns: QueryColumn<Payment>[] = [
    { key: "payer", title: "付款方", render: (payment) => payment.payer },
    { key: "orderNo", title: "订购单号", width: 150, render: (payment) => payment.orderNo },
    {
      key: "status",
      title: "状态",
      width: 88,
      render: (payment) => (
        <StatusTag tone={payment.confirmed ? "success" : "warning"}>
          {payment.confirmed ? "已确认" : "待确认"}
        </StatusTag>
      ),
    },
    {
      key: "amount",
      title: "金额",
      width: 120,
      align: "right",
      render: (payment) => formatMoneyFixed(payment.amountFen),
    },
    {
      key: "action",
      title: "操作",
      width: 190,
      align: "right",
      render: (payment) => (
        <span style={{ display: "inline-flex", gap: 12, alignItems: "center" }}>
          <Link className="lyx-link" to="/dev/rows" search={{ voucher: payment.id }}>
            查看凭证
          </Link>
          <Button
            size="small"
            type="primary"
            disabled={payment.confirmed}
            onClick={() => setButtonHits((count) => count + 1)}
          >
            确认收款
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div data-fixture={DEV_FIXTURE_MARK} style={{ display: "contents" }}>
      <PageHeader
        title="对公付款单"
        subtitle="样例页：整行可点的表格。点一行在右侧抽屉里看详情；行里的“查看凭证”“确认收款”各管各的。数据是夹具。"
      />
      <Alert
        type="info"
        data-testid="rows-log"
        title={`整行动作 ${rowHits} 次 · 行内按钮 ${buttonHits} 次 · 正在看的凭证：${typeof voucher === "string" ? voucher : "无"}`}
      />
      <QueryTablePage<Payment>
        label="对公付款单"
        search={search}
        onSearchChange={setSearch}
        columns={columns}
        rowKey={(payment) => payment.id}
        query={{ status: "success", items, total: items.length }}
        onRetry={() => {}}
        onRowClick={(payment) => {
          setRowHits((count) => count + 1);
          setOpened(payment);
        }}
        toolbar={
          <Segmented<Scope>
            aria-label="收款状态"
            options={[...SCOPES]}
            value={scope}
            onChange={setScope}
          />
        }
      />
      <Drawer open={opened !== null} title="付款单详情" onClose={() => setOpened(null)}>
        {opened ? (
          <InfoList
            labelWidth={84}
            items={[
              { label: "付款方", value: opened.payer },
              { label: "订购单号", value: opened.orderNo },
              { label: "金额", value: formatMoneyFixed(opened.amountFen) },
              { label: "状态", value: opened.confirmed ? "已确认" : "待确认" },
            ]}
          />
        ) : null}
      </Drawer>
    </div>
  );
}
