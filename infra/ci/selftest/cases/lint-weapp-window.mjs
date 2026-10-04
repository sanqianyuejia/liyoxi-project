// W0-01 的门禁：lint 禁用项（小程序禁浏览器全局对象）。
export default {
  gate: "lint：小程序禁浏览器全局对象",
  mutation: "apps/weapp 的页面里用 window",
  reason: "no-restricted-globals",
  run(ctx) {
    return ctx.node(
      "node_modules/eslint/bin/eslint.js",
      ["--stdin", "--stdin-filename", "apps/weapp/src/pages/index/index.tsx"],
      { input: "export function href(): string {\n  return window.location.href;\n}\n" },
    );
  },
};
