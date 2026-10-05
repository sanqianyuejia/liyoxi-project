// 事务入口规则片段（W0-07；01 第 5 节调用规则 2；ADR-005）：开事务只有 kernel 的 tx.run 一个入口，
// kernel 之外不得出现 $transaction。prisma.$transaction、tx.$transaction、prisma["$transaction"] 都算。
//
// 管的范围是 apps 与 packages 下的源码，三处除外：
//   packages/services/src/kernel/    入口本身
//   packages/services/src/testing/   测试支架：进程中断的场景夹具要绕开入口直接开事务
//   packages/db/                     数据访问层自己：客户端工厂的用例在这里，它引不到 services
// files 里的一组（内层数组）要同时满足：第一个模式圈范围，后面三个取反把上面三处划出去。

/** 不得出现 $transaction 的路径 */
export const txEntryFiles = [
  [
    "{apps,packages}/**/*.{ts,tsx,js,jsx,mjs,cjs}",
    "!packages/services/src/kernel/**",
    "!packages/services/src/testing/**",
    "!packages/db/**",
  ],
];

const message =
  "开事务只有 kernel 的 tx.run 一个入口：用例函数调 tx.run，往下传 tx；要局部回滚用 savepoint（01 第 5 节调用规则 2）。";

/** 后面的包要再禁别的语法，把自己的条目与这里的拼在一起：同一条规则后写的配置会整条盖掉前面的 */
export const txEntryRestrictedSyntax = [
  { selector: "MemberExpression[property.name='$transaction']", message },
  { selector: "MemberExpression[property.value='$transaction']", message },
];

export const txEntryRules = {
  "no-restricted-syntax": ["error", ...txEntryRestrictedSyntax],
};
