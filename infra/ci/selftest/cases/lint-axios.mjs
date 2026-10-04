// W0-01 的门禁：lint 禁用项（全仓禁 axios）。反例不入库，从标准输入喂给 ESLint。
export default {
  gate: "lint：全仓禁 axios",
  mutation: "packages/shared 里引 axios",
  reason: "no-restricted-imports",
  run(ctx) {
    return ctx.node(
      "node_modules/eslint/bin/eslint.js",
      ["--stdin", "--stdin-filename", "packages/shared/src/http.ts"],
      { input: 'import axios from "axios";\n\nexport const get = axios.get;\n' },
    );
  },
};
