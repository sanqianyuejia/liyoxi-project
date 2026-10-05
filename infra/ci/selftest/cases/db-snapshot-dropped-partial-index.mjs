// W0-06b 的门禁：结构快照（pnpm db:snapshot:check 比的那一份）。跑完全部迁移的库上删一个部分索引之后，
// 拿这个库与入库的快照比必须失败，并指到被删的那个索引（计划 第 6.3 节退出 ④ 的两个结构反例之一）。
// Prisma 看不出手写的部分索引少了（ADR-045）；快照不再收索引、或只比数量不比名字时，这一例会红。
// 两个库怎么来的、要什么环境，见 ../lib/db-structure.mjs 开头。
import { checkMutated } from "../lib/db-structure.mjs";

export default {
  gate: "结构快照（db:snapshot:check）",
  mutation: "跑完全部迁移的库上 DROP INDEX 一个部分索引",
  reason: /结构快照有差异[\s\S]*- 【索引】(\w+)：快照有，库里没有\n[\s\S]*反例动的是：\1\n/,
  run: (ctx) => checkMutated(ctx, "infra/ci/db-snapshot.mjs", (picks) => [picks.index]),
};
