// 菜单登记：客服（D7 第 5.2 节；画板名照 routemap.json 的 screens；里程碑与工作包照计划 第 8.3 节）。
// 页面包合并时把自己那一页的 implemented 改成 true；只许 import type（见 ../menu-types.ts）。
import type { AdminModule } from "../menu-types";

const service: AdminModule = {
  key: "service",
  title: "客服",
  icon: "headset",
  order: 8,
  pages: [
    {
      key: "service.tickets",
      title: "工单池",
      path: "/service/tickets",
      module: "service",
      release: null,
      badgeKey: "service.tickets",
      milestone: "M7",
      workPackage: "G7-A",
      implemented: false,
      screen: "Service",
      kind: "board",
      skeleton: "query-table",
      inMenu: true,
    },
    {
      key: "service.ticket_detail",
      title: "工单详情",
      path: "/service/tickets/$ticketNo",
      module: "service",
      release: null,
      milestone: "M7",
      workPackage: "G7-A",
      implemented: false,
      screen: "ServiceDetail",
      kind: "board",
      skeleton: "detail",
      inMenu: false,
      parent: "service.tickets",
    },
  ],
};

export default service;
