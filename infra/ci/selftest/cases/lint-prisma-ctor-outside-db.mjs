// W0-07b 的门禁：lint 禁用项（packages/db 之外不得 new PrismaClient）。反例不入库，从标准输入喂给 ESLint。
export default {
  gate: "lint：Prisma 客户端只由 packages/db 的工厂构造",
  mutation: "packages/services 的业务模块里直接 new PrismaClient()",
  reason: /Prisma 客户端只由 createPrismaClient 构造[\s\S]*no-restricted-syntax/,
  run(ctx) {
    return ctx.node(
      "node_modules/eslint/bin/eslint.js",
      ["--stdin", "--stdin-filename", "packages/services/src/billing/db.ts"],
      {
        input:
          'import { PrismaClient } from "@liyoxi/db";\n\n' +
          "export const prisma = new PrismaClient();\n",
      },
    );
  },
};
