// 菜单登记：工作台（D7 第 5.2 节；画板名照 routemap.json 的 screens；里程碑与工作包照计划 第 8.3 节）。
// 页面包合并时把自己那一页的 implemented 改成 true；只许 import type（见 ../menu-types.ts）。
import type { AdminModule } from "../menu-types";

const workbench: AdminModule = {
  key: "workbench",
  title: "工作台",
  icon: "grid",
  order: 1,
  pages: [
    {
      key: "workbench.main",
      title: "工作台",
      path: "/",
      module: "workbench",
      release: null,
      milestone: "M7",
      workPackage: "G7-B",
      implemented: false,
      screen: "Main",
      kind: "board",
      skeleton: "dashboard",
      inMenu: true,
    },
    {
      key: "approval.mine",
      title: "我的待审批",
      path: "/approvals",
      module: "workbench",
      release: null,
      badgeKey: "approval.mine",
      milestone: "M2",
      workPackage: "G2-A",
      implemented: false,
      screen: "我的待审批",
      kind: "no-board",
      skeleton: "query-table",
      inMenu: false,
      parent: "workbench.main",
      note: "无画板页：地址与是否进菜单文档没写，先按登记值；页面包实现时定，并把 inMenu 改过来。M2 只含已落地的审批类型，M4、M5 各补一段",
    },
  ],
};

export default workbench;
