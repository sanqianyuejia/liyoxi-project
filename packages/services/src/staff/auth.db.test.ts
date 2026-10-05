import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { STAFF_LOCK_ALERT_RULE } from "../audit/index.js";
import { assembleServices } from "../assembly.js";
import { chainKey, machinePort } from "../flow/index.js";
import { createIdentityContext } from "../kernel/index.js";
import {
  createSampleFlow,
  createTestStaffAuth,
  signInAsStaff,
  totpNow,
  useSeededDatabase,
} from "../testing/index.js";
import type { TestStaffAuth } from "../testing/index.js";
import { SAMPLE_FLOW_EVENT } from "../testing/index.js";
import {
  eventsOf,
  failureOf,
  META,
  nextPhone,
  PASSWORD,
  provisionStaff,
  SLOW,
} from "./__fixtures__/staff.js";
import { issueActivationCode } from "./activation.js";
import { LOCK_MS } from "./lockout.js";
import {
  clearStaleTotpPending,
  purgeStaffActivations,
  purgeStaffSessions,
  staffStatusBinding,
} from "./register.js";
import { DEFAULT_STAFF_GROUP_NAMES, seed } from "./seed.js";
import {
  revokeStaffSessions,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  STEP_UP_TTL_MS,
} from "./session.js";
import { deviceCookieMatches, issueDeviceCookie, issueTicket } from "./ticket.js";

// 任务书 W1-01a 第 7 节验收 4、6、7 与引导用例：连真库，库带种子（8 个角色与各自的默认组）。
// 几个 describe 共用一个库与一只时钟：时钟只往前拨。

const db = useSeededDatabase("services");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
let prisma: PrismaClient;
let t: TestStaffAuth;

beforeAll(async () => {
  prisma = await db.prisma();
  t = createTestStaffAuth(prisma);
}, SLOW);

const AUTH_FAILED = {
  error: "AUTH_FAILED",
  message: "账号或验证信息不正确，请重新输入",
  details: undefined,
};
const staffRow = (id: string) => prisma.staff.findUniqueOrThrow({ where: { id } });
/** 走完登录两步，返回建好的会话 */
async function signIn(
  who: { phone: string; password: string; secret: string },
  deviceCookie?: string,
) {
  const first = await t.staff.login({
    phone: who.phone,
    password: who.password,
    deviceCookie,
    meta: META,
  });
  return t.staff.verifyMfa({
    ticket: first.ticket as string,
    method: "totp",
    code: totpNow(who.secret, t.clock),
    deviceCookie,
    meta: META,
  });
}
/** 往前拨到下一个时间步：上一个动态口令用过了，等下一个 */
const nextStep = () => t.clock.advance(30_000);

describe("引导与激活四步（验收 4、10 的服务层部分）", { timeout: SLOW }, () => {
  const phone = nextPhone();
  let staffId = "";
  let activationCode = "";
  let secret = "";

  it("第一次引导建出待激活的超级管理员：状态历史、审计、事件、激活码各一；第二次拒绝执行", async () => {
    const result = await t.staff.bootstrap({ name: " 林晓 ", phone });
    staffId = result.staffId;
    activationCode = result.activationCode;
    expect(result.staffNo).toBeGreaterThanOrEqual(1001);
    expect(result.activationExpiresAt).toEqual(new Date(t.clock.now().getTime() + DAY));

    const staff = await prisma.staff.findUniqueOrThrow({
      where: { id: staffId },
      include: { staffGroup: true },
    });
    expect(staff).toMatchObject({
      name: "林晓",
      staffRoleKey: "super_admin",
      status: "active",
      passwordHash: null,
      totpEnrolledAt: null,
      createdByStaffId: null,
      phoneLast4: phone.slice(-4),
      staffGroup: { staffRoleKey: "super_admin", isDefault: true },
    });
    expect(staff.phoneEnc).not.toContain(phone);

    const history = await prisma.statusTransition.findMany({ where: { subjectId: staffId } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      machine: "staff",
      fromState: null,
      toState: "active",
      event: "staff.bootstrap",
      actorType: "system",
    });
    const audit = await prisma.auditLog.findMany({ where: { targetId: staffId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      stream: "ops",
      category: "staff_authz",
      action: "sys.staff.bootstrap",
      actorType: "system",
      actorId: null,
      jobName: "cli.staff.bootstrap",
    });
    expect(JSON.stringify(audit[0]?.after)).not.toContain(phone);
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: staffId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "staff.created",
      aggregateType: "staff",
      payload: {
        v: 1,
        staffId,
        roleKey: "super_admin",
        fromState: null,
        toState: "active",
        transition: "staff.bootstrap",
      },
    });
    const codes = await prisma.staffActivation.findMany({ where: { staffId } });
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({
      purpose: "activate",
      delivery: "manual",
      attempts: 0,
      usedAt: null,
      revokedAt: null,
      createdByStaffId: null,
    });

    const before = await prisma.staff.count();
    expect(
      await failureOf(t.staff.bootstrap({ name: "第二位", phone: nextPhone() })),
    ).toMatchObject({ error: "STATE_NOT_ALLOWED" });
    expect(await prisma.staff.count()).toBe(before);
    expect(await failureOf(t.staff.bootstrap({ name: "", phone }))).toMatchObject({
      error: "VALIDATION_FAILED",
    });
    expect(await failureOf(t.staff.bootstrap({ name: "林晓", phone: "1380013" }))).toMatchObject({
      error: "VALIDATION_FAILED",
    });
  });

  it("待激活的账号登录不了：与密码错同一个响应", async () => {
    expect(await failureOf(t.staff.login({ phone, password: PASSWORD, meta: META }))).toEqual(
      AUTH_FAILED,
    );
  });

  it("第 1 步：码错次数加 1，码对换到 set_password 票据（15 分钟），不改库", async () => {
    expect(await failureOf(t.staff.activate({ phone, activationCode: "ZZZZ2222" }))).toEqual(
      AUTH_FAILED,
    );
    expect(await failureOf(t.staff.activate({ phone: nextPhone(), activationCode }))).toEqual(
      AUTH_FAILED,
    );
    const live = () => prisma.staffActivation.findFirstOrThrow({ where: { staffId } });
    expect((await live()).attempts).toBe(1);
    const next = await t.staff.activate({ phone, activationCode: activationCode.toLowerCase() });
    expect(next).toMatchObject({ next: "set_password", methods: [] });
    expect(next.ticketExpiresAt).toEqual(new Date(t.clock.now().getTime() + 15 * MINUTE));
    expect(await live()).toMatchObject({ attempts: 1, usedAt: null });
  });

  it("第 2 步：口令不合规列出规则；合规则写哈希、激活码置已用、写审计，给 enroll_totp 票据；票据不能再用", async () => {
    const { ticket } = await t.staff.activate({ phone, activationCode });
    const weak = await failureOf(
      t.staff.setPassword({ ticket: ticket as string, newPassword: `a${phone}`, meta: META }),
    );
    expect(weak).toMatchObject({
      error: "PASSWORD_POLICY_VIOLATED",
      details: { rules: ["contains_phone"] },
    });
    const short = await failureOf(
      t.staff.setPassword({ ticket: ticket as string, newPassword: "abc", meta: META }),
    );
    expect(short.details).toEqual({ rules: ["min_length", "letters_and_digits"] });
    const wrongPurpose = issueTicket(t.authKeys, {
      staffId,
      purpose: "enroll_totp",
      now: t.clock.now(),
    }).ticket;
    expect(
      await failureOf(
        t.staff.setPassword({ ticket: wrongPurpose, newPassword: PASSWORD, meta: META }),
      ),
    ).toMatchObject({ error: "AUTH_TICKET_INVALID" });

    const next = await t.staff.setPassword({
      ticket: ticket as string,
      newPassword: PASSWORD,
      meta: META,
    });
    expect(next.next).toBe("enroll_totp");
    const staff = await staffRow(staffId);
    expect(staff.passwordHash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(staff.passwordChangedAt).toEqual(t.clock.now());
    expect((await prisma.staffActivation.findFirstOrThrow({ where: { staffId } })).usedAt).toEqual(
      t.clock.now(),
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: staffId, action: "sys.staff.password_set" },
    });
    expect(audit).toMatchObject({
      stream: "ops",
      category: "account_security",
      actorType: "staff",
      actorId: staffId,
      client: "admin",
      sessionId: null,
      actorName: "林晓",
      actorRole: "超级管理员",
    });
    expect(JSON.stringify([audit.summary, audit.before, audit.after, audit.meta])).not.toContain(
      PASSWORD,
    );

    // 激活码用过了：票据还没过期也不能再设一次；激活码也不能再换票据
    expect(
      await failureOf(
        t.staff.setPassword({ ticket: ticket as string, newPassword: PASSWORD, meta: META }),
      ),
    ).toMatchObject({ error: "AUTH_TICKET_INVALID" });
    expect(await failureOf(t.staff.activate({ phone, activationCode }))).toEqual(AUTH_FAILED);
    // 设了密码、还没绑动态口令：登录第一步直接给 enroll_totp 票据
    expect(await t.staff.login({ phone, password: PASSWORD, meta: META })).toMatchObject({
      next: "enroll_totp",
      methods: [],
    });
  });

  it("第 3、4 步：密钥加密暂存，重复生成覆盖；码错可重输；确认后转正、给 10 个恢复码、建会话", async () => {
    const { ticket } = await t.staff.login({ phone, password: PASSWORD, meta: META });
    const first = await t.staff.enrollTotp({ ticket: ticket as string });
    const second = await t.staff.enrollTotp({ ticket: first.ticket });
    secret = second.secret;
    expect(second.secret).not.toBe(first.secret);
    expect(second.otpauthUri).toContain(`secret=${secret}`);
    expect(second.otpauthUri).toContain(
      encodeURIComponent(`${phone.slice(0, 3)}****${phone.slice(-4)}`),
    );
    const pending = await staffRow(staffId);
    expect(pending.totpPendingSecretEnc).toMatch(/^v1:t1:/);
    expect(pending.totpPendingSecretEnc).not.toContain(secret);
    expect(pending).toMatchObject({
      totpPendingAt: t.clock.now(),
      totpSecretEnc: null,
      totpEnrolledAt: null,
    });

    // 用第一次的密钥算的码对不上（已被覆盖）；票据仍有效
    const wrong = await failureOf(
      t.staff.confirmTotp({
        ticket: second.ticket,
        code: totpNow(first.secret, t.clock),
        meta: META,
      }),
    );
    expect(wrong.error).toBe("MFA_CODE_INVALID");

    const done = await t.staff.confirmTotp({
      ticket: second.ticket,
      code: totpNow(secret, t.clock),
      meta: META,
    });
    expect(done.recoveryCodes).toHaveLength(10);
    expect(done.principal).toMatchObject({
      staff: { id: staffId, staffRoleKey: "super_admin", recoveryCodesLeft: 10, status: "active" },
      role: { key: "super_admin", name: "超级管理员" },
      group: { name: "管理员组" },
      groupMemberIds: [staffId],
      session: { authMethod: "password+totp", stepupAt: t.clock.now() },
    });
    expect(deviceCookieMatches(t.authKeys, done.deviceCookie, staffId, t.clock.now())).toBe(true);
    const staff = await staffRow(staffId);
    expect(staff).toMatchObject({
      totpEnrolledAt: t.clock.now(),
      totpPendingSecretEnc: null,
      totpPendingAt: null,
      lastLoginAt: t.clock.now(),
      lastLoginIp: META.ip,
    });
    expect(staff.totpSecretEnc).toMatch(/^v1:t1:/);
    expect(JSON.stringify(staff.recoveryCodes)).not.toContain(
      done.recoveryCodes[0]?.replace("-", "") ?? "x",
    );
    expect(await eventsOf(prisma, staffId)).toContain("login_success");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: staffId, action: "sys.staff.totp_enrolled" },
    });
    expect(audit).toMatchObject({
      category: "account_security",
      sessionId: done.principal.session.id,
      authMethod: "password+totp",
    });
    expect((await t.staff.authenticate(done.sessionToken)).staff.id).toBe(staffId);

    // 已绑定：票据还没过期，也不能再生成、再确认
    expect(await failureOf(t.staff.enrollTotp({ ticket: second.ticket }))).toMatchObject({
      error: "TOTP_ALREADY_ENROLLED",
    });
    expect(
      await failureOf(
        t.staff.confirmTotp({ ticket: second.ticket, code: totpNow(secret, t.clock), meta: META }),
      ),
    ).toMatchObject({ error: "TOTP_ALREADY_ENROLLED" });
  });

  it("已绑定过的账号：重置用的激活码只能设密码，设完回 login、不发票据；拿它去绑动态口令被拒", async () => {
    const reset = await t.tx.run((handle) =>
      issueActivationCode(handle, {
        staffId,
        purpose: "reset_password",
        delivery: "manual",
        createdByStaffId: staffId,
        now: t.clock.now(),
      }),
    );
    const { ticket } = await t.staff.activate({ phone, activationCode: reset.code });
    const next = await t.staff.setPassword({
      ticket: ticket as string,
      newPassword: "Another-2026-pw",
      meta: META,
    });
    expect(next).toEqual({ next: "login", ticket: null, ticketExpiresAt: null, methods: [] });
    const forged = issueTicket(t.authKeys, {
      staffId,
      purpose: "enroll_totp",
      now: t.clock.now(),
    }).ticket;
    expect(await failureOf(t.staff.enrollTotp({ ticket: forged }))).toMatchObject({
      error: "TOTP_ALREADY_ENROLLED",
    });
    // 新密码加原有的动态口令走正常登录
    nextStep();
    const signedIn = await signIn({ phone, password: "Another-2026-pw", secret });
    expect(signedIn.principal.staff.id).toBe(staffId);
  });

  it("激活码过期、错满 5 次、重新生成后的旧码、未启用的账号：都被拒", async () => {
    const issue = (id: string) =>
      t.tx.run((handle) =>
        issueActivationCode(handle, {
          staffId: id,
          purpose: "activate",
          delivery: "manual",
          createdByStaffId: null,
          now: t.clock.now(),
        }),
      );
    const fresh = await provisionStaff(t, prisma, { password: null, totp: false });

    // 重新生成：旧码作废，同一员工只有一个有效的码
    const old = await issue(fresh.id);
    const current = await issue(fresh.id);
    expect(
      await prisma.staffActivation.count({
        where: { staffId: fresh.id, usedAt: null, revokedAt: null },
      }),
    ).toBe(1);
    expect(
      await failureOf(t.staff.activate({ phone: fresh.phone, activationCode: old.code })),
    ).toEqual(AUTH_FAILED);

    // 错满 5 次作废（上一句已经错了 1 次）：之后对的码也不行
    for (let index = 0; index < 4; index += 1) {
      expect(
        await failureOf(t.staff.activate({ phone: fresh.phone, activationCode: "ZZZZ2222" })),
      ).toEqual(AUTH_FAILED);
    }
    const revoked = await prisma.staffActivation.findUniqueOrThrow({ where: { id: current.id } });
    expect(revoked).toMatchObject({ attempts: 5, revokedAt: t.clock.now() });
    expect(
      await failureOf(t.staff.activate({ phone: fresh.phone, activationCode: current.code })),
    ).toEqual(AUTH_FAILED);

    // 过期：24 小时整即失效
    const expiring = await issue(fresh.id);
    t.clock.advance(DAY - 1);
    expect(
      (await t.staff.activate({ phone: fresh.phone, activationCode: expiring.code })).next,
    ).toBe("set_password");
    t.clock.advance(1);
    expect(
      await failureOf(t.staff.activate({ phone: fresh.phone, activationCode: expiring.code })),
    ).toEqual(AUTH_FAILED);

    // 待启用、已禁用的账号：激活码无效
    for (const status of ["pending", "disabled"] as const) {
      const off = await provisionStaff(t, prisma, { status, password: null, totp: false });
      const code = await issue(off.id);
      expect(
        await failureOf(t.staff.activate({ phone: off.phone, activationCode: code.code })),
      ).toEqual(AUTH_FAILED);
    }
  });
});

describe("登录两步与分桶锁定（验收 4、7）", { timeout: SLOW }, () => {
  it("两步走通：第一步不写库；第二步建会话、清两个桶、记最近登录、发设备 Cookie", async () => {
    const who = await provisionStaff(t, prisma);
    await prisma.staff.update({
      where: { id: who.id },
      data: { failUntrusted: 3, failTrusted: 2 },
    });
    const first = await t.staff.login({ phone: who.phone, password: who.password, meta: META });
    expect(first).toMatchObject({ next: "mfa", methods: ["totp", "recovery"] });
    expect(first.ticketExpiresAt).toEqual(new Date(t.clock.now().getTime() + 5 * MINUTE));
    expect(await staffRow(who.id)).toMatchObject({
      failUntrusted: 3,
      failTrusted: 2,
      lastLoginAt: null,
    });
    expect(await eventsOf(prisma, who.id)).toEqual([]);

    const signedIn = await t.staff.verifyMfa({
      ticket: first.ticket as string,
      method: "totp",
      code: totpNow(who.secret, t.clock),
      meta: META,
    });
    expect(signedIn.principal).toMatchObject({
      staff: { id: who.id, recoveryCodesLeft: 10 },
      role: { key: "delivery_manager" },
      session: {
        authMethod: "password+totp",
        stepupAt: t.clock.now(),
        stepUpValidUntil: new Date(t.clock.now().getTime() + STEP_UP_TTL_MS),
      },
    });
    expect(await staffRow(who.id)).toMatchObject({
      failUntrusted: 0,
      failTrusted: 0,
      lockedUntilUntrusted: null,
      lastLoginAt: t.clock.now(),
      lastLoginIp: META.ip,
    });
    const session = await prisma.staffSession.findUniqueOrThrow({
      where: { id: signedIn.principal.session.id },
    });
    expect(session).toMatchObject({
      staffId: who.id,
      ip: META.ip,
      userAgent: META.userAgent,
      idleExpiresAt: new Date(t.clock.now().getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t.clock.now().getTime() + SESSION_ABSOLUTE_MS),
      revokedAt: null,
    });
    expect(Buffer.from(session.tokenHash).toString("base64url")).not.toBe(signedIn.sessionToken);
    expect(await eventsOf(prisma, who.id)).toEqual(["login_success"]);
  });

  it("同一时间步的动态口令重放被拒；恢复码用掉即移除、不能再用", async () => {
    const who = await provisionStaff(t, prisma);
    const code = totpNow(who.secret, t.clock);
    const first = await t.staff.login({ phone: who.phone, password: who.password, meta: META });
    await t.staff.verifyMfa({ ticket: first.ticket as string, method: "totp", code, meta: META });
    // 票据还在 5 分钟之内，同一个码再来一次
    expect(
      await failureOf(
        t.staff.verifyMfa({ ticket: first.ticket as string, method: "totp", code, meta: META }),
      ),
    ).toEqual(AUTH_FAILED);
    expect((await staffRow(who.id)).failUntrusted).toBe(1);

    const recovery = who.recoveryCodes[0] as string;
    const byRecovery = await t.staff.verifyMfa({
      ticket: first.ticket as string,
      method: "recovery",
      code: recovery.toLowerCase(),
      meta: META,
    });
    expect(byRecovery.principal).toMatchObject({
      staff: { recoveryCodesLeft: 9 },
      session: { authMethod: "password+recovery" },
    });
    expect(
      await failureOf(
        t.staff.verifyMfa({
          ticket: first.ticket as string,
          method: "recovery",
          code: recovery,
          meta: META,
        }),
      ),
    ).toEqual(AUTH_FAILED);
    expect(await eventsOf(prisma, who.id)).toEqual([
      "login_success",
      "login_fail",
      "login_success",
      "login_fail",
    ]);
    const methods = (
      await prisma.authEvent.findMany({
        where: { subjectId: who.id, event: "login_success" },
        orderBy: { seq: "asc" },
      })
    ).map((row) => row.method);
    expect(methods).toEqual(["password+totp", "password+recovery"]);
  });

  it("账号不存在、待启用、已禁用、待激活、密码错：同一个 401，逐字节相同；只有密码错计数", async () => {
    const pending = await provisionStaff(t, prisma, { status: "pending" });
    const disabled = await provisionStaff(t, prisma, { status: "disabled" });
    const fresh = await provisionStaff(t, prisma, { password: null, totp: false });
    const who = await provisionStaff(t, prisma);
    const attempts = [
      { phone: nextPhone(), password: PASSWORD },
      { phone: pending.phone, password: PASSWORD },
      { phone: disabled.phone, password: PASSWORD },
      { phone: fresh.phone, password: PASSWORD },
      { phone: who.phone, password: "Wrong-2026-pw" },
    ];
    for (const attempt of attempts) {
      expect(await failureOf(t.staff.login({ ...attempt, meta: META }))).toEqual(AUTH_FAILED);
    }
    for (const other of [pending, disabled, fresh]) {
      expect(await staffRow(other.id)).toMatchObject({ failUntrusted: 0, failTrusted: 0 });
      expect(await eventsOf(prisma, other.id)).toEqual(["login_fail"]);
    }
    expect((await staffRow(who.id)).failUntrusted).toBe(1);
    const reasons = await prisma.authEvent.findMany({
      where: { subjectId: { in: [pending.id, fresh.id, who.id] } },
      orderBy: { seq: "asc" },
    });
    expect(reasons.map((row) => (row.detail as { reason: string }).reason)).toEqual([
      "not_active",
      "not_activated",
      "bad_password",
    ]);
    // 票据无效、乱写的票据：也是同一个 401
    expect(
      await failureOf(
        t.staff.verifyMfa({ ticket: "x.y", method: "totp", code: "000000", meta: META }),
      ),
    ).toEqual(AUTH_FAILED);
  });

  it("失败 5 次锁该桶 15 分钟，另一个桶不受影响；锁定中密码正确也是同一个 401；到期后恢复", async () => {
    const who = await provisionStaff(t, prisma);
    const device = issueDeviceCookie(t.authKeys, who.id, t.clock.now());
    const wrong = () =>
      failureOf(t.staff.login({ phone: who.phone, password: "Wrong-2026-pw", meta: META }));
    const normal = await wrong();
    for (let index = 0; index < 4; index += 1) await wrong();
    const lockedAt = t.clock.now();
    expect(await staffRow(who.id)).toMatchObject({
      failUntrusted: 5,
      lockedUntilUntrusted: new Date(lockedAt.getTime() + LOCK_MS),
      failTrusted: 0,
      lockedUntilTrusted: null,
      status: "active",
    });
    expect((await eventsOf(prisma, who.id)).filter((event) => event === "locked")).toHaveLength(1);
    const lockRow = await prisma.authEvent.findFirstOrThrow({
      where: { subjectId: who.id, event: "locked" },
    });
    expect(lockRow).toMatchObject({
      method: "password",
      ip: META.ip,
      detail: {
        bucket: "untrusted",
        lockedUntil: new Date(lockedAt.getTime() + LOCK_MS).toISOString(),
      },
    });

    // 锁定中：密码正确也不行，响应与普通失败逐字节相同；不再计数，也不重复写 locked
    const whileLocked = await failureOf(
      t.staff.login({ phone: who.phone, password: who.password, meta: META }),
    );
    expect(whileLocked).toEqual(normal);
    expect(whileLocked).toEqual(AUTH_FAILED);
    const lastFail = await prisma.authEvent.findFirstOrThrow({
      where: { subjectId: who.id, event: "login_fail" },
      orderBy: { seq: "desc" },
    });
    expect(lastFail.detail).toMatchObject({ bucket: "untrusted", reason: "bucket_locked" });
    expect(await staffRow(who.id)).toMatchObject({ failUntrusted: 5 });
    expect((await eventsOf(prisma, who.id)).filter((event) => event === "locked")).toHaveLength(1);
    // 别人的、伪造的设备 Cookie 不算可信设备
    const forged = issueDeviceCookie(
      t.authKeys,
      (await provisionStaff(t, prisma)).id,
      t.clock.now(),
    );
    expect(
      await failureOf(
        t.staff.login({
          phone: who.phone,
          password: who.password,
          deviceCookie: forged,
          meta: META,
        }),
      ),
    ).toEqual(AUTH_FAILED);

    // 自己用过的浏览器（带设备 Cookie）照常登录；成功后两个桶清零
    const signedIn = await signIn(who, device);
    expect(signedIn.principal.staff.id).toBe(who.id);
    expect(await staffRow(who.id)).toMatchObject({ failUntrusted: 0, lockedUntilUntrusted: null });

    // 可信设备桶同样 5 次即锁，陌生来源桶不受影响
    for (let index = 0; index < 5; index += 1) {
      await failureOf(
        t.staff.login({
          phone: who.phone,
          password: "Wrong-2026-pw",
          deviceCookie: device,
          meta: META,
        }),
      );
    }
    expect(await staffRow(who.id)).toMatchObject({
      failTrusted: 5,
      failUntrusted: 0,
      lockedUntilUntrusted: null,
    });
    expect(
      await failureOf(
        t.staff.login({
          phone: who.phone,
          password: who.password,
          deviceCookie: device,
          meta: META,
        }),
      ),
    ).toEqual(AUTH_FAILED);
    expect(
      (await t.staff.login({ phone: who.phone, password: who.password, meta: META })).next,
    ).toBe("mfa");

    // 15 分钟到期：该桶恢复，从头计
    t.clock.advance(LOCK_MS);
    expect(
      (
        await t.staff.login({
          phone: who.phone,
          password: who.password,
          deviceCookie: device,
          meta: META,
        })
      ).next,
    ).toBe("mfa");
    await failureOf(
      t.staff.login({
        phone: who.phone,
        password: "Wrong-2026-pw",
        deviceCookie: device,
        meta: META,
      }),
    );
    expect(await staffRow(who.id)).toMatchObject({ failTrusted: 1, lockedUntilTrusted: null });
  });

  it("第二步失败累加同一个桶；同一员工当天第 3 次锁陌生来源桶时告警一次", async () => {
    const who = await provisionStaff(t, prisma);
    t.alerts.length = 0;
    const lockOnce = async () => {
      const { ticket } = await t.staff.login({
        phone: who.phone,
        password: who.password,
        meta: META,
      });
      for (let index = 0; index < 3; index += 1) {
        await failureOf(t.staff.login({ phone: who.phone, password: "Wrong-2026-pw", meta: META }));
      }
      for (let index = 0; index < 2; index += 1) {
        expect(
          await failureOf(
            t.staff.verifyMfa({
              ticket: ticket as string,
              method: "totp",
              code: "000000",
              meta: META,
            }),
          ),
        ).toEqual(AUTH_FAILED);
      }
      expect(await staffRow(who.id)).toMatchObject({ failUntrusted: 5 });
      // 锁定中：对的动态口令也不行
      expect(
        await failureOf(
          t.staff.verifyMfa({
            ticket: ticket as string,
            method: "totp",
            code: totpNow(who.secret, t.clock),
            meta: META,
          }),
        ),
      ).toEqual(AUTH_FAILED);
      t.clock.advance(LOCK_MS);
    };
    // 时钟此刻是北京时间当天下午：三轮各隔 15 分钟，都在同一天
    await lockOnce();
    await lockOnce();
    expect(t.alerts).toEqual([]);
    await lockOnce();
    expect(t.alerts).toHaveLength(1);
    expect(t.alerts[0]).toMatchObject({
      rule: STAFF_LOCK_ALERT_RULE,
      dimension: who.id,
      severity: "P2",
    });
    const methods = (
      await prisma.authEvent.findMany({ where: { subjectId: who.id, event: "locked" } })
    ).map((row) => row.method);
    expect(methods).toEqual(["password+totp", "password+totp", "password+totp"]);
  });
});

describe("会话、再验证、退出（验收 6、7）", { timeout: SLOW }, () => {
  it("空闲 60 分钟滑动、绝对 12 小时；60 秒内不重复续写", async () => {
    const who = await provisionStaff(t, prisma);
    const { sessionToken, principal } = await signIn(who);
    const start = t.clock.now().getTime();
    const sessionRow = () =>
      prisma.staffSession.findUniqueOrThrow({ where: { id: principal.session.id } });

    t.clock.advance(60_000);
    await t.staff.authenticate(sessionToken);
    expect((await sessionRow()).lastSeenAt.getTime()).toBe(start); // 刚好 60 秒：不写
    t.clock.advance(1);
    const touched = await t.staff.authenticate(sessionToken);
    expect(touched.session.idleExpiresAt.getTime()).toBe(start + 60_001 + SESSION_IDLE_MS);
    expect(await sessionRow()).toMatchObject({
      lastSeenAt: t.clock.now(),
      idleExpiresAt: touched.session.idleExpiresAt,
      updatedAt: t.clock.now(),
    });

    // 空闲：差 1 毫秒还行（并顺延），之后整 60 分钟不动即失效
    t.clock.advance(SESSION_IDLE_MS - 1);
    await t.staff.authenticate(sessionToken);
    t.clock.advance(SESSION_IDLE_MS);
    expect(await failureOf(t.staff.authenticate(sessionToken))).toMatchObject({
      error: "SESSION_INVALID",
    });

    // 绝对：一直活跃也只到 12 小时；空闲时限不越过绝对时限
    const fresh = await signIn(who);
    const began = t.clock.now().getTime();
    let last = fresh.principal.session;
    while (t.clock.now().getTime() + 50 * MINUTE < began + SESSION_ABSOLUTE_MS) {
      t.clock.advance(50 * MINUTE);
      last = (await t.staff.authenticate(fresh.sessionToken)).session;
    }
    expect(last.idleExpiresAt.getTime()).toBe(began + SESSION_ABSOLUTE_MS);
    t.clock.set(new Date(began + SESSION_ABSOLUTE_MS - 1));
    await t.staff.authenticate(fresh.sessionToken);
    t.clock.advance(1);
    expect(await failureOf(t.staff.authenticate(fresh.sessionToken))).toMatchObject({
      error: "SESSION_INVALID",
    });
    for (const junk of ["", "not-a-token", fresh.sessionToken.slice(0, -1)]) {
      expect(await failureOf(t.staff.authenticate(junk))).toMatchObject({
        error: "SESSION_INVALID",
      });
    }
  });

  it("吊销与员工行的迁移同事务：回滚都不生效；提交后旧会话下一次校验即失败", async () => {
    const who = await provisionStaff(t, prisma);
    const { sessionToken, principal } = await signIn(who);
    // 禁用那一行的守卫随 G2-A：这里用 flow 的样例登记顶上（样例守卫恒放行）
    const sample = createSampleFlow(prisma);
    sample.clock.set(t.clock.now());
    const operator = createIdentityContext({
      actor: { type: "staff", id: principal.staff.id, client: "admin" },
    });
    const disable = (fail: boolean) =>
      sample.tx.run(async (handle) => {
        const now = sample.clock.now();
        const revoked = await revokeStaffSessions(handle, {
          staffId: who.id,
          reason: "disabled",
          now,
        });
        await sample.flow.transition(handle, operator, {
          machine: "staff",
          stateField: "status",
          id: who.id,
          event: "staff.disable",
          set: { disabled_at: now, disabled_reason: "resigned" },
          audit: {
            stream: "ops",
            category: "staff_authz",
            action: "lyxtest.staff.disable",
            summary: "样例：禁用员工",
            target: { type: "staff", id: who.id },
          },
          emit: { type: SAMPLE_FLOW_EVENT, payload: { v: 1 } },
        });
        if (fail) throw new Error("回滚");
        return revoked;
      });

    await expect(disable(true)).rejects.toThrow("回滚");
    expect(await staffRow(who.id)).toMatchObject({ status: "active", disabledAt: null });
    expect((await t.staff.authenticate(sessionToken)).staff.id).toBe(who.id);

    expect(await disable(false)).toBe(1);
    expect(await failureOf(t.staff.authenticate(sessionToken))).toMatchObject({
      error: "SESSION_INVALID",
    });
    expect(
      await prisma.staffSession.findUniqueOrThrow({ where: { id: principal.session.id } }),
    ).toMatchObject({ revokedAt: t.clock.now(), revokeReason: "disabled" });
  });

  it("员工不是启用状态：没吊销的会话也校验不过", async () => {
    const who = await provisionStaff(t, prisma);
    const { sessionToken } = await signIn(who);
    await prisma.staff.update({
      where: { id: who.id },
      data: { status: "disabled", disabledAt: t.clock.now(), disabledReason: "other" },
    });
    expect(await failureOf(t.staff.authenticate(sessionToken))).toMatchObject({
      error: "SESSION_INVALID",
    });
  });

  it("再验证：码错不吊销会话、不计失败桶；码对写 stepup_at 与事件；同一时间步不能复用", async () => {
    const who = await provisionStaff(t, prisma);
    const { sessionToken, principal } = await signIn(who);
    const loginCode = totpNow(who.secret, t.clock);
    // 登录用过的码：同一个 30 秒里不能拿来再验证
    expect(
      await failureOf(t.staff.stepUp({ principal, method: "totp", code: loginCode, meta: META })),
    ).toMatchObject({ error: "MFA_CODE_INVALID" });
    expect(
      await failureOf(t.staff.stepUp({ principal, method: "totp", code: "000000", meta: META })),
    ).toMatchObject({ error: "MFA_CODE_INVALID" });
    expect(await staffRow(who.id)).toMatchObject({ failUntrusted: 0, failTrusted: 0 });
    expect((await t.staff.authenticate(sessionToken)).session.stepupAt).toEqual(
      principal.session.stepupAt,
    );

    t.clock.advance(11 * MINUTE);
    const result = await t.staff.stepUp({
      principal,
      method: "totp",
      code: totpNow(who.secret, t.clock),
      meta: META,
    });
    expect(result.stepUpValidUntil).toEqual(new Date(t.clock.now().getTime() + STEP_UP_TTL_MS));
    expect((await t.staff.authenticate(sessionToken)).session).toMatchObject({
      stepupAt: t.clock.now(),
      stepUpValidUntil: result.stepUpValidUntil,
    });
    // 恢复码也行，用掉即少一个
    await t.staff.stepUp({
      principal,
      method: "recovery",
      code: who.recoveryCodes[1] as string,
      meta: META,
    });
    expect((await t.staff.authenticate(sessionToken)).staff.recoveryCodesLeft).toBe(9);
    expect(await eventsOf(prisma, who.id)).toEqual(["login_success", "step_up", "step_up"]);
    const methods = (
      await prisma.authEvent.findMany({
        where: { subjectId: who.id, event: "step_up" },
        orderBy: { seq: "asc" },
      })
    ).map((row) => row.method);
    expect(methods).toEqual(["totp", "recovery"]);
  });

  it("退出：吊销当前会话、写 logout 事件；重复退出无副作用", async () => {
    const who = await provisionStaff(t, prisma);
    const { sessionToken, principal } = await signIn(who);
    await t.staff.logout({ principal, meta: META });
    expect(
      await prisma.staffSession.findUniqueOrThrow({ where: { id: principal.session.id } }),
    ).toMatchObject({ revokedAt: t.clock.now(), revokeReason: "logout" });
    expect(await failureOf(t.staff.authenticate(sessionToken))).toMatchObject({
      error: "SESSION_INVALID",
    });
    await t.staff.logout({ principal, meta: META });
    expect(await eventsOf(prisma, who.id)).toEqual(["login_success", "logout"]);
    // 再验证用的是已吊销的会话：按失效算
    t.clock.advance(30_000);
    expect(
      await failureOf(
        t.staff.stepUp({
          principal,
          method: "totp",
          code: totpNow(who.secret, t.clock),
          meta: META,
        }),
      ),
    ).toMatchObject({ error: "SESSION_INVALID" });
  });

  it("角色与本组成员每请求取、缓存 5 秒：改了角色名、组里加了人，5 秒后看得到", async () => {
    const group = await prisma.staffGroup.findFirstOrThrow({
      where: { staffRoleKey: "editor", isDefault: true },
    });
    const who = await provisionStaff(t, prisma, { roleKey: "editor", staffGroupId: group.id });
    const { sessionToken } = await signIn(who);
    t.staff.roles.invalidate();
    const before = await t.staff.authenticate(sessionToken);
    expect(before).toMatchObject({
      role: { name: "剪辑师" },
      group: { id: group.id, name: "剪辑组" },
      groupMemberIds: [who.id],
    });

    const peer = await provisionStaff(t, prisma, { roleKey: "editor", staffGroupId: group.id });
    await prisma.staffRole.update({ where: { key: "editor" }, data: { name: "剪辑师（改）" } });
    t.clock.advance(4_999);
    expect(await t.staff.authenticate(sessionToken)).toMatchObject({
      role: { name: "剪辑师" },
      groupMemberIds: [who.id],
    });
    t.clock.advance(1);
    const after = await t.staff.authenticate(sessionToken);
    expect(after.role.name).toBe("剪辑师（改）");
    expect([...after.groupMemberIds].sort()).toEqual([who.id, peer.id].sort());
    await prisma.staffRole.update({ where: { key: "editor" }, data: { name: "剪辑师" } });
  });

  it("signInAsStaff：直接建员工与会话行，给出的 Cookie 过得了会话校验", async () => {
    const signedIn = await signInAsStaff(prisma, {
      roleKey: "finance",
      isLead: true,
      now: t.clock.now(),
    });
    expect(signedIn.headers).toEqual({
      cookie: `lyx_admin=${signedIn.sessionToken}`,
      "x-lyx-admin": "1",
      origin: "http://localhost",
    });
    const principal = await t.staff.authenticate(signedIn.sessionToken);
    expect(principal).toMatchObject({
      staff: { id: signedIn.staff.id, staffRoleKey: "finance", isLead: true },
      role: { key: "finance" },
      group: { name: "财务组" },
      session: { id: signedIn.sessionId, authMethod: "password+totp" },
    });
  });
});

describe("清理项与登记", { timeout: SLOW }, () => {
  it("会话过期或吊销满 30 天、激活码已用或过期满 30 天才删；待确认的密钥满 1 小时清空", async () => {
    const now = t.clock.now();
    const ago = (ms: number) => new Date(now.getTime() - ms);
    // 会话：31 天前登录的（绝对时限过了 30 天多）删；29 天前的、今天的留
    const old = await signInAsStaff(prisma, { now: ago(31 * DAY) });
    const recent = await signInAsStaff(prisma, { now: ago(29 * DAY) });
    const live = await signInAsStaff(prisma, { now });
    const sessions = [old, recent, live].map((item) => item.sessionId);
    expect(await t.tx.run((handle) => purgeStaffSessions(handle, { now, limit: 100 }))).toBe(1);
    const left = await prisma.staffSession.findMany({
      where: { id: { in: sessions } },
      select: { id: true },
    });
    expect(left.map((row) => row.id).sort()).toEqual([recent.sessionId, live.sessionId].sort());

    // 激活码：过期 31 天的删；用掉 31 天的删；过期 29 天的、有效的留
    const issue = (staffId: string, at: Date) =>
      t.tx.run((handle) =>
        issueActivationCode(handle, {
          staffId,
          purpose: "activate",
          delivery: "manual",
          createdByStaffId: null,
          now: at,
        }),
      );
    const expired = await issue(old.staff.id, ago(32 * DAY));
    const kept = await issue(recent.staff.id, ago(30 * DAY));
    const valid = await issue(live.staff.id, now);
    expect(await t.tx.run((handle) => purgeStaffActivations(handle, { now, limit: 100 }))).toBe(1);
    const codes = await prisma.staffActivation.findMany({
      where: { id: { in: [expired.id, kept.id, valid.id] } },
      select: { id: true },
    });
    expect(codes.map((row) => row.id).sort()).toEqual([kept.id, valid.id].sort());

    // 待确认的密钥：61 分钟前生成的清空，59 分钟前的留着
    const stale = await provisionStaff(t, prisma, { totp: false });
    const fresh = await provisionStaff(t, prisma, { totp: false });
    await prisma.staff.update({
      where: { id: stale.id },
      data: { totpPendingSecretEnc: "v1:t1:x", totpPendingAt: ago(61 * MINUTE) },
    });
    await prisma.staff.update({
      where: { id: fresh.id },
      data: { totpPendingSecretEnc: "v1:t1:y", totpPendingAt: ago(59 * MINUTE) },
    });
    expect(await t.tx.run((handle) => clearStaleTotpPending(handle, { now, limit: 100 }))).toBe(1);
    expect(await staffRow(stale.id)).toMatchObject({
      totpPendingSecretEnc: null,
      totpPendingAt: null,
    });
    expect(await staffRow(fresh.id)).toMatchObject({ totpPendingSecretEnc: "v1:t1:y" });
  });

  it("种子：8 个角色各有一个默认组；运营改过组名的不重建、不改回", async () => {
    const groups = await prisma.staffGroup.findMany({ where: { isDefault: true } });
    expect(Object.fromEntries(groups.map((group) => [group.staffRoleKey, group.name]))).toEqual(
      DEFAULT_STAFF_GROUP_NAMES,
    );
    await prisma.staffGroup.updateMany({
      where: { staffRoleKey: "delivery_manager", isDefault: true },
      data: { name: "华东交付组" },
    });
    const again = await t.tx.run((handle) => seed.run(handle, { now: t.clock.now() }));
    expect(again).toEqual([
      { table: "staff_role", inserted: 0, existing: 8 },
      { table: "staff_group", inserted: 0, existing: 8 },
    ]);
    expect(await prisma.staffGroup.count()).toBe(8);
    expect(
      await prisma.staffGroup.findFirstOrThrow({ where: { staffRoleKey: "delivery_manager" } }),
    ).toMatchObject({ name: "华东交付组", isDefault: true });
  });

  it("装配结果里：staff.status 的登记是本模块的，三条清理项在", () => {
    const assembly = assembleServices({ entry: "worker", appEnv: "prod" });
    expect(assembly.portEntries(machinePort).get(chainKey("staff", "status"))).toBe(
      staffStatusBinding,
    );
    expect(
      assembly.cleanups
        .filter((item) => item.module === "staff")
        .map((item) => [item.name, item.every]),
    ).toEqual([
      ["staff.staff_activation", "day"],
      ["staff.staff_session", "day"],
      ["staff.totp_pending", "hour"],
    ]);
  });
});
