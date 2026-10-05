// W0-06b 的门禁：结构快照（pnpm db:snapshot:check 比的那一份）。跑完全部迁移的库上把一列的类型改掉之后，
// 拿这个库与入库的快照比必须失败，并指到那一列（计划 第 6.3 节退出 ④ 的两个结构反例之一）。
// 快照不再收列、或只比列名不比类型时，这一例会红。
// 两个库怎么来的、要什么环境，见 ../lib/db-structure.mjs 开头。
import { checkMutated } from "../lib/db-structure.mjs";

export default {
  gate: "结构快照（db:snapshot:check）",
  mutation: "跑完全部迁移的库上 ALTER TABLE … ALTER COLUMN … TYPE（一列 integer 改成 bigint）",
  reason:
    /结构快照有差异[\s\S]*- 【列】(\w+\.\w+) 的 type 不同：快照 "integer"；库里 "bigint"\n[\s\S]*反例动的是：\1\n/,
  run: (ctx) => checkMutated(ctx, "infra/ci/db-snapshot.mjs", (picks) => [picks.column.join(".")]),
};
