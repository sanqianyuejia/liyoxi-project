// 违规上报端口 invariants.report 的实现（W0-24）。kernel 定义端口，ops 在 register.ts 登记这一份。
// 依据：15 分组 第 5.2 节。给巡检循环、补偿扫描这类自己发现违规的地方用，上报的行不属于任何一次运行。
//
//   1. 用连接池直接发一条语句：自己就是一个短事务，不加入调用方的事务，也不经 tx.run——
//      调用方在事务里照样能报，它的事务回滚了，违规照样留下。
//   2. 按该编号登记的自愈策略写（去重、auto_healed_at、自动关闭与运行里的口径相同）；编号没登记的按 none。
//   3. 抛错由 kernel 的外壳（invariantsOf）吞掉并记日志，不抛给调用方。没绑运行时也按抛错算。
import type { Invariants } from "../../kernel/index.js";
import { requireOps } from "../binding.js";
import { writeViolations } from "./store.js";

export const reportingInvariants: Invariants = {
  async report(input) {
    const ops = requireOps("invariants.report");
    await writeViolations(
      ops.db,
      {
        runId: null,
        code: input.code,
        module: input.module,
        severity: input.severity,
        heal: ops.assembly.invariant(input.code)?.heal ?? "none",
        now: ops.clock.now(),
      },
      [
        {
          detail: input.detail,
          ...(input.subject === undefined ? {} : { subject: input.subject }),
          ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
          ...(input.healed === undefined ? {} : { healed: input.healed }),
        },
      ],
    );
  },
};
