// 后台：登录、激活、再验证、当前员工、退出（docs/api/a01-system.md 第 3.1–3.8、3.11 节；W1-01a）。
// 薄壳：取参与 Cookie → 调 runtime.staffAuth 的用例 → 回包、写 Cookie。判定与写库都在 @liyoxi/services 的 staff、authz。
// 登录前的六条是公开路由（持票据的三条凭请求体里的 ticket），用 defineHandler；要会话的三条用 defineAdminHandler。
// 响应里有票据、密钥、恢复码或个人数据的都标 Cache-Control: no-store（约定 C18）。
import {
  adminAuthBindWecom,
  adminAuthChangePassword,
  adminAuthMeEnrollTotp,
  adminAuthMeConfirmTotp,
  adminAuthActivate,
  adminAuthConfirmTotp,
  adminAuthEnrollTotp,
  adminAuthLogin,
  adminAuthMeGet,
  adminAuthSetPassword,
  adminAuthStepUp,
  adminAuthVerifyMfa,
  adminSessionCurrentDelete,
} from "@liyoxi/contract";
import { staff } from "@liyoxi/services";
import type { AuthNext } from "@liyoxi/services";
import type { Context } from "hono";

import type { ApiEnv } from "../../context.js";
import {
  clearSessionCookie,
  deviceCookieOf,
  requestMetaOf,
  setSessionCookies,
} from "../../http/admin/cookies.js";
import { idemOf } from "../../http/idempotency.js";
import { ok } from "../../http/errors.js";
import { defineAdminHandler } from "../../routing/admin.js";
import { defineHandler } from "../../routing/define.js";

const authOf = (c: Context<ApiEnv>) => c.get("runtime").staffAuth;
const meDeps = (c: Context<ApiEnv>) => {
  const { config, clock } = c.get("runtime");
  return { config, clock };
};
const noStore = (c: Context<ApiEnv>): void => c.header("Cache-Control", "no-store");

/** AuthNext 出接口：时刻转成字符串 */
const authNextView = (next: AuthNext) => ({
  next: next.next,
  ticket: next.ticket,
  ticketExpiresAt: next.ticketExpiresAt?.toISOString() ?? null,
  methods: [...next.methods],
});

export const adminAuthHandlers = [
  // admin.auth.login：登录第一步。失败一律 401 AUTH_FAILED，同一文案
  defineHandler(adminAuthLogin, async (c) => {
    const { phone, password } = c.req.valid("json");
    const next = await authOf(c).login({
      phone,
      password,
      deviceCookie: deviceCookieOf(c),
      meta: requestMetaOf(c),
    });
    noStore(c);
    return ok(c, authNextView(next));
  }),
  // admin.auth.verifyMfa：登录第二步，建会话
  defineHandler(adminAuthVerifyMfa, async (c) => {
    const { ticket, method, code } = c.req.valid("json");
    const signedIn = await authOf(c).verifyMfa({
      ticket,
      method,
      code,
      deviceCookie: deviceCookieOf(c),
      meta: requestMetaOf(c),
    });
    setSessionCookies(c, signedIn);
    noStore(c);
    return ok(c, await staff.buildStaffMe(meDeps(c), signedIn.principal));
  }),
  // admin.auth.activate：凭激活码换设置密码的票据
  defineHandler(adminAuthActivate, async (c) => {
    const next = await authOf(c).activate(c.req.valid("json"));
    noStore(c);
    return ok(c, authNextView(next));
  }),
  // admin.auth.setPassword：不建会话；已绑过动态口令的回 next = login
  defineHandler(adminAuthSetPassword, async (c) => {
    const { ticket, newPassword } = c.req.valid("json");
    const next = await authOf(c).setPassword({ ticket, newPassword, meta: requestMetaOf(c) });
    noStore(c);
    return ok(c, authNextView(next));
  }),
  // admin.auth.enrollTotp：密钥明文只在这一次的响应里
  defineHandler(adminAuthEnrollTotp, async (c) => {
    const enrollment = await authOf(c).enrollTotp(c.req.valid("json"));
    noStore(c);
    return ok(c, {
      otpauthUri: enrollment.otpauthUri,
      secret: enrollment.secret,
      ticket: enrollment.ticket,
      ticketExpiresAt: enrollment.ticketExpiresAt.toISOString(),
    });
  }),
  // admin.auth.confirmTotp：确认绑定并建会话；恢复码明文只出现这一次
  defineHandler(adminAuthConfirmTotp, async (c) => {
    const { ticket, code } = c.req.valid("json");
    const confirmed = await authOf(c).confirmTotp({ ticket, code, meta: requestMetaOf(c) });
    setSessionCookies(c, confirmed);
    noStore(c);
    return ok(c, {
      me: await staff.buildStaffMe(meDeps(c), confirmed.principal),
      recoveryCodes: confirmed.recoveryCodes,
    });
  }),
  // admin.auth.stepUp：再验证。失败 400 MFA_CODE_INVALID，不吊销会话、不计入登录失败桶
  defineAdminHandler(adminAuthStepUp, null, async (c, me) => {
    const { method, code } = c.req.valid("json");
    const result = await authOf(c).stepUp({
      principal: me.principal,
      method,
      code,
      meta: requestMetaOf(c),
    });
    return ok(c, { stepUpValidUntil: result.stepUpValidUntil.toISOString() });
  }),
  // admin.auth.me.get：当前员工、模块等级、生效的权限点、数据范围、开关
  defineAdminHandler(adminAuthMeGet, null, async (c, me) => {
    noStore(c);
    return ok(c, await staff.buildStaffMe(meDeps(c), me.principal, me.ctx));
  }),
  // admin.session.current.delete：退出登录。重复退出无副作用；设备 Cookie 留着
  defineAdminHandler(adminSessionCurrentDelete, null, async (c, me) => {
    await authOf(c).logout({ principal: me.principal, meta: requestMetaOf(c) });
    clearSessionCookie(c);
    return ok(c, null);
  }),
  defineAdminHandler(adminAuthChangePassword, null, async (c, me) => {
    const result = await c.var.runtime.staffSelfSecurity.changePassword(
      me.principal,
      { ...c.req.valid("json"), meta: requestMetaOf(c) },
      { idem: idemOf(c) },
    );
    noStore(c);
    return ok(c, result);
  }),
  defineAdminHandler(adminAuthBindWecom, null, async (c, me) => {
    const result = await c.var.runtime.staffSelfSecurity.bindWecom(
      me.principal,
      { ...c.req.valid("json"), meta: requestMetaOf(c) },
      { idem: idemOf(c) },
    );
    noStore(c);
    return ok(c, result);
  }),
  defineAdminHandler(adminAuthMeEnrollTotp, null, async (c, me) => {
    const result = await c.var.runtime.staffSelfSecurity.enrollTotp(me.principal);
    noStore(c);
    return ok(c, result);
  }),
  defineAdminHandler(adminAuthMeConfirmTotp, null, async (c, me) => {
    const result = await c.var.runtime.staffSelfSecurity.confirmTotp(
      me.principal,
      { ...c.req.valid("json"), meta: requestMetaOf(c) },
      { idem: idemOf(c) },
    );
    noStore(c);
    return ok(c, result);
  }),
];
