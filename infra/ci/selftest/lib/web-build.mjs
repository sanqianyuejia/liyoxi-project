// 构建产物检查（apps/admin/scripts/check-build.mjs）的反例共用的一份“合格产物”：
// 构建号、生产模式、带哈希的文件名都齐。各反例在它上面改一处。

export const BUILD = "0123456789ab";

/** 一份合格的产物目录内容；overrides 里的同名文件盖掉缺省的 */
export function goodDist(overrides = {}) {
  return {
    "build.json": JSON.stringify({ app: "admin", build: BUILD, mode: "production" }),
    "index.html": [
      "<!doctype html><html><head>",
      '<script type="module" crossorigin src="/assets/index-Ab12Cd34.js"></script>',
      `<meta name="lyx-build" content="${BUILD}">`,
      '</head><body><div id="root"></div></body></html>',
    ].join("\n"),
    "assets/index-Ab12Cd34.js": 'console.log("app");\n',
    ...overrides,
  };
}
