// 页面清单的数据源：电脑端下载页。读 apps/portal/src/pages.ts。写法见 sources/admin.mjs 开头。

import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PAGES_FILE = "apps/portal/src/pages.ts";
const yes = (value) => (value ? "是" : "否");

export default {
  key: "portal",
  order: 30,
  title: "电脑端下载页",
  async load({ root }) {
    const { PORTAL_PAGES } = await import(pathToFileURL(join(root, PAGES_FILE)).href);
    if (!Array.isArray(PORTAL_PAGES)) throw new Error(`${PAGES_FILE} 要导出 PORTAL_PAGES`);
    const keys = new Set();
    for (const page of PORTAL_PAGES) {
      if (keys.has(page.key)) throw new Error(`下载页页面的键重复：${page.key}`);
      keys.add(page.key);
    }
    return {
      origin: `\`${PAGES_FILE}\``,
      pages: PORTAL_PAGES,
      intro: [
        "下载页是单独的 Vite 应用，没有原型；M0 只有空壳，页面都在 M6（D7 第 6 节；计划 第 8.3 节）。",
      ],
      sections: [
        {
          title: `页面（${PORTAL_PAGES.length}）`,
          columns: ["页面", "地址", "要先有会话", "里程碑", "工作包", "已实现", "备注"],
          rows: PORTAL_PAGES.map((page) => [
            page.title,
            page.path ? `\`${page.path}\`` : "—",
            yes(page.needsSession),
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
