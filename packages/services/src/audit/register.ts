// audit 模块的登记（W0-24 补；检查项是 W0-14 写的）：两条每日校验 audit.I2、audit.I3。
// 依据：03 分组 第 2.10 节“不变量”；15 分组 第 3 节（对象是 audit_log 的一行，用 subject_id）。
// 调度在 invariant.full。audit.I1（敏感操作与审计配对）随 M1。
import { defineRegistration } from "../kernel/index.js";
import type { InvariantRegistration } from "../kernel/index.js";
import { AUDIT_INVARIANTS } from "./invariants.js";
import type { AuditInvariantCheck } from "./invariants.js";

const toRegistration = (check: AuditInvariantCheck): InvariantRegistration => ({
  code: check.code,
  severity: check.severity,
  modes: check.modes,
  heal: "none",
  run: async (tx, scope) =>
    (await check.run(tx, scope.since === undefined ? {} : { since: scope.since })).map(
      (violation) => ({
        subject: { type: violation.subjectType, id: violation.subjectId },
        detail: violation.detail,
      }),
    ),
});

export const registration = defineRegistration("audit", {
  invariants: AUDIT_INVARIANTS.map(toRegistration),
});
