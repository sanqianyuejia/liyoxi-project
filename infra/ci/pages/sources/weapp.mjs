// 页面清单的数据源：商家端小程序。读 apps/weapp/src/pages.ts（app.config 的路由也由它拼出）。
// 写法见 sources/admin.mjs 开头。
// 两处是迁就已有用例（infra/ci/test/admin-ci.test.ts 的“页面清单”），改那份用例算放松类门禁改动，所以在这边让：
//   order 取 40，排在后台与下载页之后（admin.mjs 开头写的是小程序 10）：排前面，后台与下载页的节号各加一，
//     用例钉着“### 2.1 画板页”“## 3. 电脑端下载页”；
//   表里“工作包”在“里程碑”前面：用例在“下载页”一节之后的全文里按“| M6 | G6-B |”数下载页的页面，
//     小程序的“扫码确认”也是 M6、G6-B，列序相同就会被数进去。

import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PAGES_FILE = "apps/weapp/src/pages.ts";
const yes = (value) => (value ? "是" : "否");

export default {
  key: "weapp",
  order: 40,
  title: "商家端小程序",
  async load({ root }) {
    const { WEAPP_PAGES } = await import(pathToFileURL(join(root, PAGES_FILE)).href);
    if (!Array.isArray(WEAPP_PAGES)) throw new Error(`${PAGES_FILE} 要导出 WEAPP_PAGES`);
    const routes = new Set();
    for (const page of WEAPP_PAGES) {
      if (routes.has(page.route)) throw new Error(`小程序路由重复：${page.route}`);
      routes.add(page.route);
      const prefix = page.pkg === "main" ? "pages/" : `${page.pkg}/`;
      if (!page.route.startsWith(prefix) || !page.route.endsWith("/index")) {
        throw new Error(
          `小程序路由 ${page.route} 与它的分包 ${page.pkg} 对不上，或不以 /index 结尾`,
        );
      }
      if (page.implemented && page.placeholder) {
        throw new Error(`小程序页面 ${page.route} 已实现，就不该还标着占位`);
      }
    }
    const pages = WEAPP_PAGES.map((page) => ({ ...page, key: page.route }));
    const skipped = pages.filter((page) => page.milestone === "V1.1");
    const placeholders = pages.filter((page) => page.placeholder);
    const packages = new Set(pages.filter((page) => page.pkg !== "main").map((page) => page.pkg));
    return {
      origin: `\`${PAGES_FILE}\``,
      pages,
      intro: [
        `路由 ${pages.length} 个：主包 ${pages.filter((page) => page.pkg === "main").length} 页，分包 ${packages.size} 个（D7 第 4.1 节）。V1.0 不做的 ${skipped.length} 个只登记。全局配置的页面、分包、预下载由这份清单拼出，只输出已建的页。`,
        "",
        `“已实现”指页面包已交付。M0 的占位页（${placeholders.length} 个，进构建、能打开）不算已实现，在“备注”里标出。“工作包”一栏：已拆包的写编号，未拆包的写工作包组（如 G2-B），拆包 PR 改成编号。`,
      ],
      sections: [
        {
          title: `页面（${pages.length}）`,
          columns: ["包", "页面", "路由", "画板", "编号", "工作包", "里程碑", "已实现", "备注"],
          rows: pages.map((page) => [
            page.pkg === "main" ? "主包" : `\`${page.pkg}\``,
            page.title,
            `\`${page.route}\``,
            page.screen ?? "—",
            page.code ?? "—",
            page.workPackage,
            page.milestone === "V1.1" ? "V1.0 不做" : page.milestone,
            yes(page.implemented),
            [page.placeholder ? "M0 占位页" : "", page.note ?? ""].filter(Boolean).join("；"),
          ]),
        },
      ],
    };
  },
};
