// W0-06b 的门禁：分区断言（pnpm db:partitions:assert）。跑完全部迁移的库上删掉最远的那个月的分区之后，
// 断言必须不成立，并指到少的那个月。分区子表不进结构快照，少一个只有这道断言看得出。
// 断言不再核对未来 3 个月、或只数子表个数不看月份时，这一例会红。
// 两个库怎么来的、要什么环境，见 ../lib/db-structure.mjs 开头。
import { checkMutated } from "../lib/db-structure.mjs";

export default {
  gate: "分区断言（db:partitions:assert）",
  mutation: "跑完全部迁移的库上删掉未来第 3 个月的分区",
  reason:
    /- \w+：分区 (\w+) 不存在（当月与未来 3 个月都要有）\n[\s\S]*分区断言不成立[\s\S]*反例动的是：\1\n/,
  run: (ctx) => checkMutated(ctx, "infra/ci/db-partition-assert.mjs", (picks) => [picks.month]),
};
