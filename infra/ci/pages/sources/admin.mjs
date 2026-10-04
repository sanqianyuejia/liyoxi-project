// 页面清单的数据源：运营管理后台。读 apps/admin/src/lib/menu/ 下的菜单登记文件（一个模块一个文件，
// _base.ts 是不属于任何模块的页面），与后台运行时用的是同一批文件。
//
// 数据源的写法（后来的端照这个加一个文件）：默认导出 { key, order, title, load }。
//   order   各端在 pages.md 里的先后：小程序 10、后台 20、下载页 30
//   load({ root }) 返回 { origin, intro, pages, sections }：
//     origin    登记文件在哪（写进文件头的“来源”）
//     intro     这一节开头的几行说明
//     pages     全部页面，每项至少有 key、milestone、implemented、entryHidden，汇总表按它数
//     sections  [{ title, note?, columns, rows }]，一段一张表

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MENU_DIR = "apps/admin/src/lib/menu";
const SKELETONS = {
  "query-table": "筛选表格",
  "queue-workbench": "审核工作台",
  detail: "详情页",
  "master-detail": "主从页",
  config: "配置页",
  report: "报表页",
  dashboard: "仪表盘",
  calendar: "月历页",
  form: "表单弹层",
  overlay: "弹层或抽屉",
  plain: "—",
};
const yes = (value) => (value ? "是" : "否");
const code = (value) => (value ? `\`${value}\`` : "—");

async function loadMenu(root) {
  const dir = join(root, MENU_DIR);
  const modules = [];
  let base = null;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const loaded = (await import(pathToFileURL(join(dir, file)).href)).default;
    if (!loaded || !Array.isArray(loaded.pages)) {
      throw new Error(`${MENU_DIR}/${file} 要默认导出带 pages 的登记`);
    }
    if (file.startsWith("_")) base = loaded;
    else modules.push(loaded);
  }
  if (!base) throw new Error(`${MENU_DIR}/_base.ts 不在`);
  return { modules: modules.sort((a, b) => a.order - b.order), base };
}

export default {
  key: "admin",
  order: 20,
  title: "运营管理后台",
  async load({ root }) {
    const { modules, base } = await loadMenu(root);
    const titleOf = new Map(modules.map((module) => [module.key, module.title]));
    const pages = [...modules.flatMap((module) => module.pages), ...base.pages];
    const keys = new Set();
    for (const page of pages) {
      if (keys.has(page.key)) throw new Error(`后台页面的键重复：${page.key}`);
      keys.add(page.key);
    }
    const moduleName = (page) => (page.module ? titleOf.get(page.module) : "—");
    const boards = pages.filter((page) => page.kind === "board");
    const noBoards = pages.filter((page) => page.kind === "no-board");
    const others = pages.filter((page) => page.kind === "basic" || page.kind === "shell");
    return {
      origin: `\`${MENU_DIR}/\`（菜单登记表，一个模块一个文件）`,
      pages,
      intro: [
        `菜单登记表是菜单、面包屑、路由守卫、角标的唯一来源（D7 第 5.2 节）。画板 ${boards.length} 个：V1.0 ${boards.filter((page) => page.milestone !== "V1.1").length} 个，V1.1 ${boards.filter((page) => page.milestone === "V1.1").length} 个只登记、带开关键、默认不显示。无画板业务页 ${noBoards.length} 个。`,
        "",
        "“工作包”一栏：已拆包的写编号，未拆包的写工作包组（如 G2-A），拆包 PR 改成编号。",
      ],
      sections: [
        {
          title: `画板页（${boards.length}）`,
          columns: [
            "模块",
            "页面",
            "地址",
            "画板",
            "骨架",
            "进菜单",
            "开关",
            "里程碑",
            "工作包",
            "已实现",
          ],
          rows: boards.map((page) => [
            moduleName(page),
            page.title,
            code(page.path),
            page.screen,
            SKELETONS[page.skeleton] ?? page.skeleton,
            yes(page.inMenu),
            code(page.release),
            page.milestone,
            page.workPackage,
            yes(page.implemented),
          ]),
        },
        {
          title: `无画板业务页（${noBoards.length}）`,
          note: "不补稿，按规范 第 12 节实现，PR 附截图（计划 第 4.2 节 Q5 的默认）。地址与是否进菜单在登记时拿不准的，见“备注”。",
          columns: ["模块", "页面", "地址", "骨架", "入口", "里程碑", "工作包", "已实现", "备注"],
          rows: noBoards.map((page) => [
            moduleName(page),
            page.title,
            code(page.path),
            SKELETONS[page.skeleton] ?? page.skeleton,
            page.entryHidden ? "入口隐藏" : page.inMenu ? "菜单" : "页面内",
            page.milestone,
            page.workPackage,
            yes(page.implemented),
            page.note ?? "",
          ]),
        },
        {
          title: `基础页与外壳部件（${others.length}）`,
          columns: ["种类", "页面", "地址", "里程碑", "工作包", "已实现", "备注"],
          rows: others.map((page) => [
            page.kind === "basic" ? "基础页" : "外壳部件",
            page.title,
            code(page.path),
            page.milestone,
            page.workPackage,
            yes(page.implemented),
            page.note ?? "",
          ]),
        },
      ],
    };
  },
};
