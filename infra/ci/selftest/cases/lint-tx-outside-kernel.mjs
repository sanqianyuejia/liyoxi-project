// W0-07 的门禁：lint 禁用项（kernel 之外不得出现 $transaction）。反例不入库，从标准输入喂给 ESLint。
export default {
  gate: "lint：开事务只有 kernel 一个入口",
  mutation: "packages/services 的业务模块里直接调 prisma.$transaction",
  reason: /开事务只有 kernel 的 tx\.run 一个入口[\s\S]*no-restricted-syntax/,
  run(ctx) {
    return ctx.node(
      "node_modules/eslint/bin/eslint.js",
      ["--stdin", "--stdin-filename", "packages/services/src/billing/pay.ts"],
      {
        input:
          "export const pay = (prisma: { $transaction: (fn: () => Promise<void>) => Promise<void> }) =>\n" +
          "  prisma.$transaction(async () => {});\n",
      },
    );
  },
};
