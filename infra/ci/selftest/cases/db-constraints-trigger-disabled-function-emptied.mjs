// W0-06b 的门禁：约束清单比对（pnpm db:constraints:check），对的是“已经部署的库被人动过”这种情形：
// 一个触发器被停用（定义没变，只是不再触发）、另一个触发器调的函数被换成空函数（名字、参数没变）。
// 只增表靠触发器拦改删；角色与授权的核对（pnpm db:verify-grants）只看授权，查不出这两种，留给了本包。
// 比对不再连启停一起比、或函数只比名字不比函数体时，这一例会红。
// 两个库怎么来的、要什么环境，见 ../lib/db-structure.mjs 开头。
import { checkMutated } from "../lib/db-structure.mjs";

export default {
  gate: "约束清单比对（db:constraints:check）",
  mutation: "跑完全部迁移的库上停用一个触发器，把另一个触发器调的函数换成空函数",
  reason:
    /- 【触发器】(\w+\.\w+) 的 enabled 不同：快照 "O"；库里 "D"\n[\s\S]*- 【函数】(\w+\(\)) 的 definition 不同：[\s\S]*反例动的是：\1\n反例动的是：\2\n/,
  run: (ctx) =>
    checkMutated(ctx, "infra/ci/db-constraints.mjs", (picks) => [
      picks.trigger.join("."),
      picks.fn,
    ]),
};
