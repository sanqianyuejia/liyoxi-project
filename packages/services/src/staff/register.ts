// staff 模块的登记（W0-24 补；断言是 W0-21 写的）：staff.I8，后台角色恰是契约登记的 8 个。
// 依据：03 分组 第 2.1 节；15 分组 第 3 节（staff_role 是自然键表，对象用 subject_key = 角色键）。
// 调度在 invariant.full。staff 的其余检查项随 W1-01b。
import { defineRegistration, runSqlAssertion } from "../kernel/index.js";
import type { InvariantViolation, Tx } from "../kernel/index.js";

import { staffSeedAssertions } from "./invariants.js";

async function findRoleSetViolations(tx: Tx): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  for (const assertion of staffSeedAssertions()) {
    for (const row of await runSqlAssertion(tx, assertion)) {
      violations.push({
        subject: { type: "staff_role", key: row.subjectKey },
        detail: { problem: row.detail },
      });
    }
  }
  return violations;
}

export const registration = defineRegistration("staff", {
  invariants: [
    { code: "staff.I8", severity: "P2", modes: ["full"], heal: "none", run: findRoleSetViolations },
  ],
});
