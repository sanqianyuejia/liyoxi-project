// W0-07 的门禁：lint 禁用项（kernel 之外不得出现 $transaction），应用层的一例，用方括号的写法。
// 反例不入库，从标准输入喂给 ESLint。
export default {
  gate: "lint：开事务只有 kernel 一个入口（应用层）",
  mutation: 'apps/api 的路由里写 db["$transaction"]',
  reason: /开事务只有 kernel 的 tx\.run 一个入口[\s\S]*no-restricted-syntax/,
  run(ctx) {
    return ctx.node(
      "node_modules/eslint/bin/eslint.js",
      ["--stdin", "--stdin-filename", "apps/api/src/routes/pay.ts"],
      {
        input:
          "export const begin = (db: Record<string, (fn: () => void) => void>) =>\n" +
          '  db["$transaction"]?.(() => {});\n',
      },
    );
  },
};
