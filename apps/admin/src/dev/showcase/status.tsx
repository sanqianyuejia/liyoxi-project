// 陈列页的四组：自建组件清单（规范 第 5.5 节）、状态取色（第 6 节）、图标（第 9.1 节）、补充状态（第 12 节）。
import { ICON_NAMES } from "@liyoxi/shared/design/icons";
import { STATUS_TONE_GROUPS, TONES } from "@liyoxi/shared/design/status-tone";
import { Button, Checkbox, Input, Switch } from "antd";
import { useState } from "react";

import { Icon } from "../../components/Icon";
import { QueryTablePage } from "../../components/QueryTablePage";
import { EmptyState, ErrorState, FullPageNotice } from "../../components/StateBlock";
import { StatusTag } from "../../components/StatusTag";
import { readTableSearch } from "../../lib/table-search";

import { Demo, Remark } from "./parts";

/**
 * 规范 第 5.5 节点名的自建组件，与第 5.2、5.3 节另写了规格的几样：做了的写在哪看，没做的写归属。
 * 出处：docs/plan/status/W0-28.md 偏差第 23 条。
 */
export const CUSTOM_COMPONENTS: readonly { name: string; done: boolean; where: string }[] = [
  { name: "PageHeader 页头", done: true, where: "本页“框架”一组" },
  { name: "StatusTag 与状态字典", done: true, where: "本页“状态取色”一组" },
  { name: "FilterBar 筛选横条", done: true, where: "并在筛选表格骨架里：本页“五类页面”一组" },
  { name: "QueueWorkbench 队列工作台", done: true, where: "样例页 /dev/queue" },
  { name: "CheckList 核对清单", done: true, where: "本页“五类页面”一组" },
  {
    name: "ConfirmDialog 二次确认",
    done: true,
    where: "本页“弹层与反馈”一组（没有原因单选那一部分）",
  },
  { name: "InfoList 信息分组", done: true, where: "本页“五类页面”一组" },
  { name: "SimplePager 简化分页", done: true, where: "本页“五类页面”一组的表格卡底部" },
  { name: "KpiCard、TodoCard、StatInline 指标展示", done: false, where: "G2-0 的构件包" },
  { name: "ReasonChips 原因单选、胶囊单选", done: false, where: "G2-0 的构件包" },
  { name: "RadioCard 单选卡", done: false, where: "G2-0 的构件包" },
  { name: "MonthSwitcher 月份切换", done: false, where: "G2-0 的构件包" },
  { name: "CompareTable 并排比对表、DiffBlock 变更前后", done: false, where: "G2-0 的构件包" },
  { name: "Stepper 横向步骤进度", done: false, where: "G2-0 的构件包" },
  { name: "LogList 三列日志行", done: false, where: "G2-0 的构件包" },
  { name: "只读值、中性款提示条、橙色强调信息块、驳回弹窗", done: false, where: "G2-0 的构件包" },
  { name: "主从页的可点行选中样式（左侧色条）", done: false, where: "G2-0 的构件包" },
  { name: "图表封装", done: false, where: "G2-0 的构件包及 M6、M7" },
  {
    name: "业务专用：上线日历、客服会话流、竖版视频预览、证照预览",
    done: false,
    where: "用到它的页面包",
  },
];

export function CustomBody() {
  return (
    <Demo title="规范点了名的自建组件">
      <ul className="lyx-showcase-links">
        {CUSTOM_COMPONENTS.map((item) => (
          <li key={item.name}>
            <StatusTag tone={item.done ? "success" : "neutral"}>
              {item.done ? "已做" : "未做"}
            </StatusTag>
            <span>{item.name}</span>
            <span className="lyx-showcase-links__note">{item.where}</span>
          </li>
        ))}
      </ul>
    </Demo>
  );
}

/** 后台出现的状态：业务对象 → 各状态的色调与叫法。字典里后台不出现的状态不列 */
export function adminToneRows(): {
  key: string;
  object: string;
  states: { state: string; tone: (typeof TONES)[number]; label: string }[];
}[] {
  return STATUS_TONE_GROUPS.map((group) => ({
    key: group.key,
    object: group.object,
    states: group.entries.flatMap((entry) =>
      entry.admin ? [{ state: entry.state, tone: entry.admin.tone, label: entry.admin.label }] : [],
    ),
  })).filter((group) => group.states.length > 0);
}

export function StatusBody() {
  return (
    <>
      <Demo title="六种色调（紫色是后台的补充分类色）；右边是详情页页头里的大一号" row>
        {TONES.map((tone) => (
          <StatusTag key={tone} tone={tone}>
            {tone}
          </StatusTag>
        ))}
        <StatusTag tone="success" size="large">
          已通过
        </StatusTag>
        <StatusTag tone="warning" size="large">
          待审核
        </StatusTag>
      </Demo>
      <Demo title="状态取色表的后台一列：逐个业务对象，顺序同规范 第 6.2 节">
        <dl className="lyx-showcase-tones">
          {adminToneRows().map((group) => (
            <div key={group.key} className="lyx-showcase-tones__row">
              <dt>{group.object}</dt>
              <dd>
                {group.states.map((item) => (
                  <StatusTag key={item.state} tone={item.tone}>
                    {item.label}
                  </StatusTag>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </Demo>
    </>
  );
}

export function IconsBody() {
  return (
    <>
      <Demo title="尺寸 18（菜单）、16、14；颜色跟随文字色" row>
        <Icon name="store" size={18} />
        <Icon name="store" size={16} />
        <Icon name="store" size={14} />
        <span className="lyx-showcase-tint lyx-showcase-tint--primary">
          <Icon name="flame" />
        </span>
        <span className="lyx-showcase-tint lyx-showcase-tint--success">
          <Icon name="check-circle" />
        </span>
        <span className="lyx-showcase-tint lyx-showcase-tint--danger">
          <Icon name="alert-circle" />
        </span>
      </Demo>
      <Demo title={`图标集里的全部图标（${ICON_NAMES.length} 个，两端共用）`}>
        <ul className="lyx-showcase-icons">
          {ICON_NAMES.map((name) => (
            <li key={name}>
              <Icon name={name} size={18} />
              <span>{name}</span>
            </li>
          ))}
        </ul>
      </Demo>
    </>
  );
}

export function StatesBody() {
  const [search, setSearch] = useState(() => readTableSearch({}));
  return (
    <>
      <Demo
        title="聚焦：用 Tab 键从左往右走一遍。输入框是描边变主色加浅色光晕，其余是主色聚焦环"
        row
      >
        <Input placeholder="输入框" style={{ width: 180 }} />
        <Button type="primary">主按钮</Button>
        <Button>次按钮</Button>
        <a className="lyx-link" href="/dev/table">
          文字链
        </a>
        <Checkbox>复选框</Checkbox>
        <Switch aria-label="开关" />
      </Demo>
      <Demo title="悬停：把鼠标移到上面一行与表格行上看">
        <Remark>
          表格行悬停是浅底（bg-subtle）；主按钮底加深；次按钮描边变主色；文字链加下划线。侧栏菜单项悬停现在只把字变白、没有底色（W0-28
          偏差第 6 条，见看样清单）。
        </Remark>
      </Demo>
      <Demo title="首次加载：表格显示 5 行骨架">
        <QueryTablePage<{ id: string }>
          label="加载中的示例"
          search={search}
          onSearchChange={setSearch}
          columns={[]}
          rowKey={(row) => row.id}
          query={{ status: "loading" }}
          onRetry={() => {}}
        />
      </Demo>
      <Demo title="加载失败：说明加“重新加载”按钮；空状态：标题 15px / 600 加 13px 说明，无插图">
        <div className="lyx-showcase-columns">
          <section className="lyx-card lyx-showcase-fill">
            <ErrorState onRetry={() => {}} />
          </section>
          <section className="lyx-card lyx-showcase-fill">
            <EmptyState title="暂无商家" description="商家入驻并提交资质后会出现在这里" />
          </section>
        </div>
      </Demo>
      <Demo title="整页说明：没有访问权限、页面不存在">
        <div className="lyx-showcase-columns">
          <section className="lyx-card lyx-showcase-fill">
            <FullPageNotice
              title="没有访问权限"
              description="你的账号没有这个页面的权限，需要的话请联系管理员开通。"
              action={<Button>返回工作台</Button>}
            />
          </section>
          <section className="lyx-card lyx-showcase-fill">
            <FullPageNotice
              title="页面不存在"
              description="地址可能写错了，或者页面已经下线。"
              action={<Button>返回工作台</Button>}
            />
          </section>
        </div>
        <Remark>
          FullPageNotice
          的标题是页面一级的标题，这里为了并排看放进了卡片；真实的样子直接访问一个不存在的地址看。登录页、用户菜单、我的待审批在
          W1-02 及之后的包。
        </Remark>
      </Demo>
    </>
  );
}
