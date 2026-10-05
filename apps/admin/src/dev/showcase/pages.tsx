// 陈列页的两组：框架（规范 第 5.1 节）与五类页面的构件（规范 第 5.2 节）。
// 三种页面骨架整页的样子在各自的样例页里（/dev/table 等），这里放链接，并把骨架里的小构件单独摆出来。
// 数据是写在本文件里的夹具，不走接口。
import { formatMoneyFixed } from "@liyoxi/shared/format/money";
import { Button } from "antd";
import { useState } from "react";

import { CheckList } from "../../components/CheckList";
import { InfoList } from "../../components/InfoList";
import { PageHeader } from "../../components/PageHeader";
import { QueryTablePage, type QueryColumn } from "../../components/QueryTablePage";
import { StatusTag } from "../../components/StatusTag";
import { Tabs } from "../../components/Tabs";
import { readTableSearch } from "../../lib/table-search";

import { Demo, Remark } from "./parts";

/** 五类页面各在哪看。href 为空的是还没有构件的 */
export const PAGE_KINDS: readonly { kind: string; href: string | null; note: string }[] = [
  {
    kind: "筛选表格页",
    href: "/dev/table",
    note: "页签带计数、筛选条、可排序的表头、翻页；改筛选与翻页时地址跟着变",
  },
  {
    kind: "筛选表格页：整行可点",
    href: "/dev/rows",
    note: "点一行在右侧抽屉里看详情；行里的文字链与按钮各管各的；筛选条里有分段控件",
  },
  {
    kind: "队列工作台",
    href: "/dev/queue",
    note: "左侧队列、右侧详情卡与核对清单；处理完一条自动进入下一条",
  },
  {
    kind: "详情页",
    href: "/dev/detail/st-01",
    note: "页头带状态胶囊、多页签、侧栏信息卡；带二次确认与上传两个构件",
  },
  {
    kind: "表单",
    href: "/dev/form",
    note: "一张比一屏长的表单；提交有错时滚到第一个出错的字段",
  },
  { kind: "列表加右侧详情栏", href: null, note: "还没有构件：G2-0 的构件包" },
  { kind: "报表页", href: null, note: "还没有构件：指标卡、图表封装在 G2-0 的构件包及 M6、M7" },
];

export function FrameBody() {
  return (
    <>
      <Demo title="外壳就是现在这一页的侧栏与顶栏">
        <Remark>
          侧栏：点开一个分组看二级菜单与选中项；同一时刻只展开当前所在的分组。菜单角标要等接口接上才显示；V1.1
          的菜单缺省不显示，在浏览器控制台执行 localStorage[&quot;lyx.dev.releases&quot;] =
          &quot;release.partner&quot; 后刷新可以看到带 V1.1 小标记的菜单。
        </Remark>
        <Remark>
          顶栏：这一页不占菜单位置，所以没有面包屑；面包屑与菜单选中的样子到下面“五类页面”一组链出去的样例页里看。
        </Remark>
      </Demo>
      <Demo title="页头：标题加副标题，右侧操作按钮高 36">
        <div className="lyx-showcase-frame">
          <PageHeader
            title="商家列表"
            subtitle="商家以门店为单位；同一经营主体名下的门店共用套餐与积分。"
            extra={
              <>
                <Button>导出</Button>
                <Button type="primary">新建商家</Button>
              </>
            }
          />
        </div>
      </Demo>
      <Demo title="详情页的页头：状态胶囊（高 24）加属性胶囊，右侧操作按钮高 40">
        <div className="lyx-showcase-frame">
          <PageHeader
            title="晴天洗衣"
            subtitle="成都晴天洗涤服务有限公司 · 成华区"
            tags={
              <>
                <StatusTag tone="success" size="large">
                  已通过
                </StatusTag>
                <span className="lyx-pill">生活服务 / 洗衣</span>
              </>
            }
            extra={
              <>
                <Button size="large" danger>
                  禁用账号
                </Button>
                <Button size="large" type="primary">
                  调整积分
                </Button>
              </>
            }
          />
        </div>
      </Demo>
    </>
  );
}

interface Row {
  id: string;
  name: string;
  entity: string;
  status: { tone: "success" | "warning" | "danger"; label: string };
  due: string;
  paidFen: number;
}

const ROWS: readonly Row[] = [
  {
    id: "r1",
    name: "晴天洗衣",
    entity: "成都晴天洗涤服务有限公司",
    status: { tone: "success", label: "已通过" },
    due: "10-12 到期",
    paidFen: 300000,
  },
  {
    id: "r2",
    name: "青柠茶饮",
    entity: "青柠茶饮（个体工商户）",
    status: { tone: "warning", label: "待审核" },
    due: "今天到期",
    paidFen: 1280050,
  },
  {
    id: "r3",
    name: "好运来便利店",
    entity: "成都好运来商贸有限公司",
    status: { tone: "danger", label: "已驳回" },
    due: "已超时 2 天",
    paidFen: 80000,
  },
];

const COLUMNS: QueryColumn<Row>[] = [
  {
    key: "store",
    title: "商家（双行单元格）",
    render: (row) => (
      <div className="lyx-cell-2">
        <span className="lyx-cell-2__main lyx-cell-2__main--strong">{row.name}</span>
        <span className="lyx-cell-2__sub">{row.entity}</span>
      </div>
    ),
  },
  {
    key: "status",
    title: "状态",
    width: 96,
    render: (row) => <StatusTag tone={row.status.tone}>{row.status.label}</StatusTag>,
  },
  { key: "due", title: "时效", width: 120, render: (row) => row.due },
  {
    key: "paid",
    title: "累计实付",
    width: 130,
    align: "right",
    sortField: "paidFen",
    render: (row) => formatMoneyFixed(row.paidFen),
  },
  {
    key: "action",
    title: "操作",
    width: 220,
    align: "right",
    render: () => (
      <span className="lyx-showcase-inline">
        <a className="lyx-link" href="/dev/detail/st-01">
          详情
        </a>
        <button type="button" className="lyx-link lyx-link--danger">
          禁用
        </button>
        <Button size="small" type="primary">
          确认收款
        </Button>
      </span>
    ),
  },
];

const CHECK_ITEMS = [
  { key: "license", label: "营业执照在有效期内" },
  { key: "name", label: "主体名称与证照一致" },
  { key: "scope", label: "经营范围与品类相符" },
];

export function PagesBody() {
  const [tab, setTab] = useState("pending");
  const [search, setSearch] = useState(() => readTableSearch({}));
  const [filtered, setFiltered] = useState(() => readTableSearch({ q: "不存在的商家" }));
  const [checked, setChecked] = useState<string[]>(["license"]);

  return (
    <>
      <Demo title="五类页面各在哪看（整页的样子在样例页里）">
        <ul className="lyx-showcase-links">
          {PAGE_KINDS.map((item) => (
            <li key={item.kind}>
              {item.href ? (
                <a className="lyx-link" href={item.href}>
                  {item.kind}
                </a>
              ) : (
                <span className="lyx-showcase-links__todo">{item.kind}</span>
              )}
              <span className="lyx-showcase-links__note">{item.note}</span>
            </li>
          ))}
        </ul>
      </Demo>
      <Demo title="页签：高 46，选中带 2px 主色下划线，计数徽标；未开放的置灰、不可点">
        <div className="lyx-card">
          <Tabs
            label="示例页签"
            activeKey={tab}
            onChange={setTab}
            items={[
              { key: "all", label: "全部", count: 128 },
              { key: "pending", label: "待审核", count: 6 },
              { key: "verified", label: "已通过", count: 122 },
              { key: "partner", label: "服务商（V1.1）", disabled: true },
            ]}
          />
        </div>
      </Demo>
      <Demo title="表格卡：筛选条、表头、双行单元格、行强调、操作列、分页">
        <QueryTablePage<Row>
          label="示例表格"
          search={search}
          onSearchChange={setSearch}
          keywordPlaceholder="商家、主体名称"
          filters={[
            {
              key: "region",
              placeholder: "全部区域",
              options: [
                { value: "chenghua", label: "成华区" },
                { value: "wuhou", label: "武侯区" },
              ],
            },
          ]}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          query={{ status: "success", items: ROWS, total: ROWS.length }}
          onRetry={() => {}}
          rowTone={(row) => (row.status.tone === "danger" ? "danger" : undefined)}
        />
        <Remark>
          第三行是异常行（浅红底）。规范 第 5.2 节“时效文字”（已超时用红字 600、今天到期用主色字
          600）还没有对应的类，页面包用到时走构件 PR 补。
        </Remark>
      </Demo>
      <Demo title="筛选无结果：写“没有符合条件的……”，带“重置筛选”">
        <QueryTablePage<Row>
          label="筛选无结果的示例"
          search={filtered}
          onSearchChange={setFiltered}
          keywordPlaceholder="商家、主体名称"
          columns={COLUMNS}
          rowKey={(row) => row.id}
          query={{ status: "success", items: [], total: 0 }}
          onRetry={() => {}}
          empty={{ title: "暂无商家", filteredTitle: "没有符合条件的商家" }}
        />
      </Demo>
      <Demo title="核对清单：每项高 40，勾选后变绿底绿边；右边是只读的">
        <div className="lyx-showcase-columns">
          <CheckList items={CHECK_ITEMS} checked={checked} onChange={setChecked} />
          <CheckList
            items={CHECK_ITEMS}
            checked={["license", "name"]}
            onChange={() => {}}
            readOnly
          />
        </div>
      </Demo>
      <Demo title="信息分组：标签宽 64、84、110 三档">
        <div className="lyx-showcase-columns">
          <InfoList
            items={[
              { label: "联系人", value: "周晴" },
              { label: "手机号", value: "138****5678" },
              { label: "区域", value: "成华区" },
            ]}
          />
          <InfoList
            labelWidth={84}
            items={[
              { label: "主体名称", value: "成都晴天洗涤服务有限公司" },
              { label: "信用代码", value: "91510104MA6B****2R" },
              { label: "累计实付", value: formatMoneyFixed(300000) },
            ]}
          />
          <InfoList
            labelWidth={110}
            items={[
              { label: "最近一次订购", value: "09-28 10:12" },
              { label: "套餐到期日", value: "2026-10-12" },
              { label: "服务经理", value: "未分配" },
            ]}
          />
        </div>
      </Demo>
      <Demo title="详情页侧栏信息卡（宽 340）与底部操作条（按钮高 40，左侧放提示）">
        <div className="lyx-showcase-columns">
          <section className="lyx-card lyx-side-card lyx-showcase-aside">
            <h3 className="lyx-side-card__title">套餐与积分</h3>
            <InfoList
              labelWidth={84}
              items={[
                { label: "当前套餐", value: "标准版 · ¥3,000 / 月" },
                { label: "可用积分", value: "2,160 积分" },
              ]}
            />
          </section>
          <div className="lyx-card lyx-showcase-panel">
            <div className="lyx-action-bar">
              <span className="lyx-action-bar__hint lyx-action-bar__hint--block">
                还有 2 项没有核对
              </span>
              <Button size="large" danger>
                驳回
              </Button>
              <Button size="large" type="primary" disabled>
                审核通过
              </Button>
            </div>
          </div>
        </div>
      </Demo>
    </>
  );
}
