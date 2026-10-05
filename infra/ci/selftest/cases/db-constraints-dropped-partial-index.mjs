// W0-06b 的门禁：约束清单比对（pnpm db:constraints:check）。跑完全部迁移的库上删一个部分索引之后，
// 比对必须失败，指到被删的那个索引，数量也对不上（计划 第 6.3 节退出 ④ 的两个结构反例之一）。
// 比对不再看索引、或数量改成写死在脚本里而不跟快照走时，这一例会红。
// 两个库怎么来的、要什么环境，见 ../lib/db-structure.mjs 开头。
import { checkMutated } from "../lib/db-structure.mjs";

export default {
  gate: "约束清单比对（db:constraints:check）",
  mutation: "跑完全部迁移的库上 DROP INDEX 一个部分索引",
  reason:
    /- 【索引】(\w+)：快照有，库里没有\n[\s\S]*- 【计数】部分索引：快照 \d+；库里 \d+\n[\s\S]*约束清单比对未通过[\s\S]*反例动的是：\1\n/,
  run: (ctx) => checkMutated(ctx, "infra/ci/db-constraints.mjs", (picks) => [picks.index]),
};
