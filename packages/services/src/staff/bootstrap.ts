// 命令行引导（W1-01a；D4 第 6.4 节；03 分组 第 2.3 节状态机“命令行引导”一行；x01 第 4.6 节 staff:bootstrap）：
// 建第一位超级管理员。只在库里没有启用的超级管理员时可执行；建出来是“待激活”（active、没有口令），
// 激活码只在返回值里出现一次，由命令行打到终端。之后的账号都从后台界面新增。
//   并发：事务开头取一把咨询锁，两次引导排队；后到的进到守卫时看得到先到的那一位，被拒。
//   留痕：经 flow.transition 写状态历史、ops 审计（操作人是系统，任务名 cli.staff.bootstrap）、出站事件 staff.created。
import { AppError, createIdentityContext, uuidv7 } from "../kernel/index.js";
import { normalizePhone, sealPhone } from "../security/index.js";
import { issueActivationCode } from "./activation.js";
import { findStaffByPhone, hasActiveSuperAdmin } from "./repo.js";
import type { StaffAuthContext } from "./types.js";

/** 引导命令写审计与状态历史时的任务名 */
export const BOOTSTRAP_JOB = "cli.staff.bootstrap";

export interface BootstrapResult {
  readonly staffId: string;
  readonly staffNo: number;
  /** 激活码明文：只出现这一次 */
  readonly activationCode: string;
  readonly activationExpiresAt: Date;
}

export async function bootstrap(
  ctx: StaffAuthContext,
  input: { name: string; phone: string },
): Promise<BootstrapResult> {
  const name = input.name.trim();
  const phone = normalizePhone(input.phone);
  if (Array.from(name).length < 1 || Array.from(name).length > 10) {
    throw new AppError("VALIDATION_FAILED", { message: "姓名要 1 到 10 个字" });
  }
  if (!/^1\d{10}$/.test(phone)) {
    throw new AppError("VALIDATION_FAILED", { message: "手机号要是 11 位中国大陆手机号" });
  }
  const now = ctx.clock.now();
  const identity = createIdentityContext({ actor: { type: "system", job: BOOTSTRAP_JOB } });

  return ctx.tx.run(async (handle) => {
    await handle.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('lyx:staff:bootstrap'))");
    if (await hasActiveSuperAdmin(handle)) {
      throw new AppError("STATE_NOT_ALLOWED", {
        message: "库里已经有启用的超级管理员，引导命令不再执行；之后的账号从后台界面新增",
      });
    }
    if ((await findStaffByPhone(handle, ctx.keyring, phone)) !== null) {
      throw new AppError("STAFF_PHONE_TAKEN");
    }
    const group = await handle.staffGroup.findFirst({
      where: { staffRoleKey: "super_admin", isDefault: true },
      select: { id: true },
    });
    const sealed = sealPhone(ctx.keyring, "staff.phone_enc", phone);
    const staff = await handle.staff.create({
      data: {
        id: uuidv7(),
        name,
        phoneEnc: sealed.enc,
        phoneBidx: sealed.bidx,
        phoneMask: sealed.mask,
        phoneLast4: sealed.last4,
        staffRoleKey: "super_admin",
        staffGroupId: group?.id ?? null,
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    });
    await ctx.flow.transition(handle, identity, {
      machine: "staff",
      stateField: "status",
      id: staff.id,
      event: "staff.bootstrap",
      created: true,
      audit: {
        stream: "ops",
        category: "staff_authz",
        action: "sys.staff.bootstrap",
        summary: `命令行引导：建立第一位超级管理员 ${name}（工号 ${staff.staffNo}）`,
        target: { type: "staff", id: staff.id, label: name },
        before: null,
        after: { name, staffRoleKey: "super_admin", phone: sealed.mask, status: "active" },
        fields: ["name", "staffRoleKey", "phone", "status"],
      },
      emit: { type: "staff.created", payload: { v: 1, staffId: staff.id, roleKey: "super_admin" } },
    });
    const activation = await issueActivationCode(handle, {
      staffId: staff.id,
      purpose: "activate",
      delivery: "manual",
      createdByStaffId: null,
      now,
    });
    return {
      staffId: staff.id,
      staffNo: staff.staffNo,
      activationCode: activation.code,
      activationExpiresAt: activation.expiresAt,
    };
  });
}
