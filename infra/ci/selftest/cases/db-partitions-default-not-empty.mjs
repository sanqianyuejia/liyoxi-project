// W0-06b 的门禁：分区断言（pnpm db:partitions:assert）。往兜底分区写一行之后，断言必须不成立。
// 兜底分区里有数据，说明有事件落到了没建分区的月份（14 分组 第 2.9 节）。
// 断言只看兜底分区在不在、不看它空不空时，这一例会红。
// 两个库怎么来的、要什么环境，见 ../lib/db-structure.mjs 开头。
import { checkMutated } from "../lib/db-structure.mjs";

export default {
  gate: "分区断言（db:partitions:assert）",
  mutation: "往兜底分区写一行（发生时间落在没有分区的月份）",
  reason:
    /- (\w+)：兜底分区 \1_default 里有数据，应为空\n[\s\S]*分区断言不成立[\s\S]*反例动的是：\1\n/,
  run: (ctx) => checkMutated(ctx, "infra/ci/db-partition-assert.mjs", (picks) => [picks.parent]),
};
