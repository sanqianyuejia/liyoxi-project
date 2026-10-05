// staff 模块的登记：
//   1. 不变量 staff.I8（W0-24 补；断言是 W0-21 写的）：后台角色恰是契约登记的 8 个。
//      依据：03 分组 第 2.1 节；15 分组 第 3 节（staff_role 是自然键表，对象用 subject_key = 角色键）。
//      调度在 invariant.full。staff 的其余检查项随 W1-01b。
//   2. 状态机 staff.status 的登记（W1-01a）：随迁列，“命令行引导”“新增”三行的守卫。启用、禁用三行的守卫随 G2-A
//     （在那之前这三行迁移即抛 FlowError：行标了守卫而没有登记实现，不放行）。
//   3. 清理项三条（W1-01a；15 分组 第 5.3 节；任务书 第 10 节第 9 项）：会话过期或吊销满 30 天、激活码已用或过期满 30 天，
//      每日；待确认的动态口令密钥生成满 1 小时未确认即清空，每小时。调度在 ops.retention（W0-24）。
import { chainKey, machinePort, rowKey } from "../flow/index.js";
import type { MachineBinding } from "../flow/index.js";
import { defineRegistration, implementKeyed, runSqlAssertion } from "../kernel/index.js";
import type { CleanupContext, InvariantViolation, Tx } from "../kernel/index.js";
import { BOOTSTRAP_JOB } from "./bootstrap.js";
import { DEMO_SEED_JOB } from "./demo-seed.js";
import { staffSeedAssertions } from "./invariants.js";
import { hasActiveSuperAdmin } from "./repo.js";

const DAY_MS = 24 * 60 * 60_000;
/** 会话、激活码过了期（或吊销、已用）之后再留多少天 */
export const STAFF_CREDENTIAL_RETENTION_DAYS = 30;
/** 待确认的动态口令密钥最多留多久 */
export const TOTP_PENDING_TTL_MS = 60 * 60_000;

export const staffStatusBinding: MachineBinding = {
  // 库的 CHECK 把这几列与 disabled 状态绑在一起（ck_staff_disabled_fields）：禁用、启用时与状态同一条 UPDATE 写
  companions: ["disabled_at", "disabled_reason", "disabled_by_staff_id", "handover_to_staff_id"],
  guards: {
    // 命令行引导：只有引导命令能发；库里没有别的启用的超级管理员（本行刚插入，不算自己）
    [rowKey("03:217", "staff.bootstrap")]: async (tx, facts) =>
      facts.ctx.actor.type === "system" &&
      facts.ctx.actor.job === BOOTSTRAP_JOB &&
      !(await hasActiveSuperAdmin(tx, facts.subjectId)),
    // 新增（立即启用、暂不启用）：操作人是员工。权限点 sys.staff.manage 由路由的鉴权链判；手机号未占用由 uq_staff_phone_bidx 兜底。
    // “立即启用”一行另认演示种子（系统任务 cli.db.seed.demo；它自己在 prod 下拒绝执行）
    [rowKey("03:218", "staff.create")]: (_tx, facts) =>
      Promise.resolve(
        facts.ctx.actor.type === "staff" ||
          (facts.ctx.actor.type === "system" && facts.ctx.actor.job === DEMO_SEED_JOB),
      ),
    [rowKey("03:219", "staff.create")]: (_tx, facts) =>
      Promise.resolve(facts.ctx.actor.type === "staff"),
  },
};

/** 删过期或吊销满 30 天的会话；单轮至多 ctx.limit 行 */
export async function purgeStaffSessions(tx: Tx, ctx: CleanupContext): Promise<number> {
  const before = new Date(ctx.now.getTime() - STAFF_CREDENTIAL_RETENTION_DAYS * DAY_MS);
  return tx.$executeRawUnsafe(
    `DELETE FROM staff_session WHERE id IN (
       SELECT id FROM staff_session
        WHERE absolute_expires_at < $1::timestamptz OR revoked_at < $1::timestamptz
        ORDER BY absolute_expires_at
        LIMIT $2::int
          FOR UPDATE SKIP LOCKED
     )`,
    before,
    ctx.limit,
  );
}

/** 删已用或过期满 30 天的激活码（作废的码创建后 24 小时内即过期，随过期一起删） */
export async function purgeStaffActivations(tx: Tx, ctx: CleanupContext): Promise<number> {
  const before = new Date(ctx.now.getTime() - STAFF_CREDENTIAL_RETENTION_DAYS * DAY_MS);
  return tx.$executeRawUnsafe(
    `DELETE FROM staff_activation WHERE id IN (
       SELECT id FROM staff_activation
        WHERE expires_at < $1::timestamptz OR used_at < $1::timestamptz
        ORDER BY expires_at
        LIMIT $2::int
          FOR UPDATE SKIP LOCKED
     )`,
    before,
    ctx.limit,
  );
}

/** 清空生成满 1 小时还没确认的动态口令密钥 */
export async function clearStaleTotpPending(tx: Tx, ctx: CleanupContext): Promise<number> {
  return tx.$executeRawUnsafe(
    `UPDATE staff SET totp_pending_secret_enc = NULL, totp_pending_at = NULL, updated_at = $1::timestamptz
      WHERE id IN (
       SELECT id FROM staff
        WHERE totp_pending_at < $2::timestamptz
        ORDER BY id
        LIMIT $3::int
          FOR NO KEY UPDATE SKIP LOCKED
     )`,
    ctx.now,
    new Date(ctx.now.getTime() - TOTP_PENDING_TTL_MS),
    ctx.limit,
  );
}

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
  portImplementations: [
    implementKeyed(machinePort, chainKey("staff", "status"), staffStatusBinding),
  ],
  cleanups: [
    { name: "staff.staff_session", every: "day", run: purgeStaffSessions },
    { name: "staff.staff_activation", every: "day", run: purgeStaffActivations },
    { name: "staff.totp_pending", every: "hour", run: clearStaleTotpPending },
  ],
});
