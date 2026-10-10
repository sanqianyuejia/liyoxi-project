// 菜单登记：短剧库（D7 第 5.2 节；画板名照 routemap.json 的 screens；里程碑与工作包照计划 第 8.3 节）。
// 页面包合并时把自己那一页的 implemented 改成 true；只许 import type（见 ../menu-types.ts）。
import type { AdminModule } from "../menu-types";

const drama: AdminModule = {
  key: "drama",
  title: "短剧库",
  icon: "play-square",
  order: 2,
  pages: [
    {
      key: "drama.list",
      title: "短剧列表",
      path: "/dramas",
      module: "drama",
      release: null,
      milestone: "M3",
      workPackage: "W3-12",
      implemented: true,
      screen: "Dramas",
      kind: "board",
      skeleton: "query-table",
      inMenu: true,
    },
    {
      key: "drama.edit",
      title: "编辑短剧",
      path: "/dramas/$id",
      module: "drama",
      release: null,
      milestone: "M3",
      workPackage: "W3-12",
      implemented: true,
      screen: "DramaEdit",
      kind: "board",
      skeleton: "detail",
      inMenu: false,
      parent: "drama.list",
    },
  ],
};

export default drama;
