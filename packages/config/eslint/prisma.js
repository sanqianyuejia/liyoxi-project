// 数据库客户端构造入口规则片段（W0-07b；业主清单 #27-7；01 第 4.2 节）：Prisma 客户端只由
// packages/db 的 createPrismaClient 构造，别处不得 new PrismaClient。连接数上限与三个会话超时只在工厂里下发，
// 绕开工厂等于绕开这些设置。@liyoxi/db 的入口把 PrismaClient 这个类也导出了（类型上要用），所以靠 lint 拦构造。
//
// 管的范围是 apps 与 packages 下的源码，packages/db 自己不在其内（工厂就在那里）。
// 这条规则与事务入口规则（tx.js）用的是同一条 ESLint 规则 no-restricted-syntax：同一个文件上后写的配置
// 会整条盖掉前面的。所以分两组给：
//   prismaCtorWithTx*   事务入口规则管得到的文件，两组条目拼在一起，事务入口那两条照旧生效
//   prismaCtorOnly*     事务入口规则不管的 kernel 与 testing，只带本片段的条目
import { txEntryFiles, txEntryRestrictedSyntax } from "./tx.js";

const message =
  "Prisma 客户端只由 createPrismaClient 构造（@liyoxi/db 的工厂）：装配基础设施时调它，把连接参数传进去，不要 new PrismaClient。";

/** 后面的包要再禁别的语法，把自己的条目与这里的拼在一起 */
export const prismaCtorRestrictedSyntax = [
  { selector: "NewExpression[callee.name='PrismaClient']", message },
  { selector: "NewExpression[callee.property.name='PrismaClient']", message },
];

/** 事务入口规则管得到的文件 */
export const prismaCtorWithTxFiles = txEntryFiles;
export const prismaCtorWithTxRules = {
  "no-restricted-syntax": ["error", ...txEntryRestrictedSyntax, ...prismaCtorRestrictedSyntax],
};

/** 事务入口规则不管、本规则要管的两处 */
export const prismaCtorOnlyFiles = [
  "packages/services/src/{kernel,testing}/**/*.{ts,tsx,js,jsx,mjs,cjs}",
];
export const prismaCtorOnlyRules = {
  "no-restricted-syntax": ["error", ...prismaCtorRestrictedSyntax],
};
