// 菜单登记：交付（D7 第 5.2 节；画板名照 routemap.json 的 screens；里程碑与工作包照计划 第 8.3 节）。
// 页面包合并时把自己那一页的 implemented 改成 true；只许 import type（见 ../menu-types.ts）。
import type { AdminModule } from "../menu-types";

const delivery: AdminModule = {
  key: "delivery",
  title: "交付",
  icon: "box",
  order: 6,
  pages: [
    {
      key: "delivery.tickets",
      title: "工单池",
      path: "/delivery/tickets",
      module: "delivery",
      release: null,
      badgeKey: "delivery.tickets",
      milestone: "M1",
      workPackage: "W1-19",
      implemented: false,
      screen: "Tickets",
      kind: "board",
      skeleton: "query-table",
      inMenu: true,
    },
    {
      key: "delivery.ticket_detail",
      title: "工单详情",
      path: "/delivery/tickets/$ticketNo",
      module: "delivery",
      release: null,
      milestone: "M1",
      workPackage: "W1-19",
      implemented: false,
      screen: "TicketDetail",
      kind: "board",
      skeleton: "detail",
      inMenu: false,
      parent: "delivery.tickets",
      note: "主路径表单（无画板）在 W1-19，余下表单在 G5-C",
    },
    {
      key: "delivery.ad_tasks",
      title: "广告制作任务",
      path: "/delivery/ad-tasks",
      module: "delivery",
      release: null,
      badgeKey: "delivery.ad_tasks",
      milestone: "M5",
      workPackage: "G5-C",
      implemented: false,
      screen: "AdTasks",
      kind: "board",
      skeleton: "queue-workbench",
      inMenu: true,
    },
  ],
};

export default delivery;
