// W0-07b 的门禁：lint 禁用项（packages/db 之外不得 new PrismaClient），kernel 里的一例：
// 事务入口规则不管 kernel，这一例钉住本规则在那里照样生效。反例不入库，从标准输入喂给 ESLint。
export default {
  gate: "lint：Prisma 客户端只由 packages/db 的工厂构造（kernel）",
  mutation: "packages/services 的 kernel 里装配时写 new db.PrismaClient()",
  reason: /Prisma 客户端只由 createPrismaClient 构造[\s\S]*no-restricted-syntax/,
  run(ctx) {
    return ctx.node(
      "node_modules/eslint/bin/eslint.js",
      ["--stdin", "--stdin-filename", "packages/services/src/kernel/context.ts"],
      {
        input:
          'import * as db from "@liyoxi/db";\n\n' +
          "export const prisma = new db.PrismaClient();\n",
      },
    );
  },
};
