// 后台：登录、员工、权限与系统 · auth（docs/api/a01-system.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。
// W1-01a：登录链路的八条（3.1–3.8）已带结构；其余四条（3.9、3.10、3.86、3.87）随 G2-A。
import { errorResponses, okResponse } from "../../common/index.js";
import { z } from "../../zod.js";
import { adminRoute } from "../builders.js";

import {
  BindWecomSelfBodySchema,
  ChangePasswordBodySchema,
  StaffWecomSchema,
  TotpReEnrollmentSchema,
  ConfirmTotpSelfBodySchema,
  TotpReEnrollResultSchema,
  ActivateBodySchema,
  AuthNextSchema,
  ConfirmTotpBodySchema,
  EnrollTotpBodySchema,
  LoginBodySchema,
  SetPasswordBodySchema,
  StaffMeSchema,
  StepUpBodySchema,
  StepUpResultSchema,
  TotpConfirmResultSchema,
  TotpEnrollmentSchema,
  VerifyMfaBodySchema,
} from "./auth.schemas.js";

/** JSON 请求体的声明 */
const jsonBody = <T extends z.ZodType>(schema: T) => ({
  body: { required: true as const, content: { "application/json": { schema } } },
});

export const adminAuthActivate = adminRoute({
  method: "post",
  path: "/admin/auth/activate",
  operationId: "admin.auth.activate",
  summary: "新员工或被重置的员工凭短信激活码换取设置密码票据",
  "x-auth": "public",
  "x-permission": null,
  "x-idempotent": "none",
  "x-idempotent-reason": "登录前的激活与首次绑定，此时没有会话（C47 本稿归入登录与换会话）",
  "x-rate-limit": "admin.login",
  request: jsonBody(ActivateBodySchema),
  responses: { ...okResponse(AuthNextSchema), ...errorResponses(400, 401, 403, 429) },
});

export const adminAuthBindWecom = adminRoute({
  method: "post",
  path: "/admin/auth/bind-wecom",
  operationId: "admin.auth.bindWecom",
  summary: "员工本人扫码绑定企业微信",
  "x-permission": null,
  "x-idempotent": "required",
  "x-idempotent-reason": "状态写入；扫码分支为三段式用例（C51，先调外部、再开事务）",
  request: jsonBody(BindWecomSelfBodySchema),
  responses: { ...okResponse(StaffWecomSchema), ...errorResponses(400, 401, 403, 409, 429, 503) },
});

export const adminAuthChangePassword = adminRoute({
  method: "post",
  path: "/admin/auth/change-password",
  operationId: "admin.auth.changePassword",
  summary: "修改本人登录密码",
  "x-permission": null,
  "x-idempotent": "required",
  request: jsonBody(ChangePasswordBodySchema),
  responses: { ...okResponse(z.null()), ...errorResponses(400, 401, 403, 409, 429, 503) },
});

export const adminAuthConfirmTotp = adminRoute({
  method: "post",
  path: "/admin/auth/confirm-totp",
  operationId: "admin.auth.confirmTotp",
  summary: "校验一次动态口令完成绑定，生成 10 个恢复码（只显示一次）并建会话",
  "x-auth": "public",
  "x-permission": null,
  "x-idempotent": "none",
  "x-idempotent-reason": "登录前的激活与首次绑定，此时没有会话（C47 本稿归入登录与换会话）",
  "x-rate-limit": "admin.login",
  request: jsonBody(ConfirmTotpBodySchema),
  responses: {
    ...okResponse(TotpConfirmResultSchema),
    ...errorResponses(400, 401, 403, 409, 429),
  },
});

export const adminAuthEnrollTotp = adminRoute({
  method: "post",
  path: "/admin/auth/enroll-totp",
  operationId: "admin.auth.enrollTotp",
  summary: "生成动态口令密钥，返回 otpauth 地址供扫码绑定",
  "x-auth": "public",
  "x-permission": null,
  "x-idempotent": "none",
  "x-idempotent-reason": "登录前的激活与首次绑定，此时没有会话（C47 本稿归入登录与换会话）",
  "x-rate-limit": "admin.login",
  request: jsonBody(EnrollTotpBodySchema),
  responses: { ...okResponse(TotpEnrollmentSchema), ...errorResponses(400, 401, 403, 409, 429) },
});

export const adminAuthLogin = adminRoute({
  method: "post",
  path: "/admin/auth/login",
  operationId: "admin.auth.login",
  summary: "手机号 + 密码登录第一步，返回第二因子票据",
  "x-auth": "public",
  "x-permission": null,
  "x-idempotent": "none",
  "x-idempotent-reason": "登录与换会话（A18）",
  "x-rate-limit": "admin.login",
  request: jsonBody(LoginBodySchema),
  responses: { ...okResponse(AuthNextSchema), ...errorResponses(400, 401, 403, 429) },
});

export const adminAuthMeGet = adminRoute({
  method: "get",
  path: "/admin/auth/me",
  operationId: "admin.auth.me.get",
  summary: "当前员工、模块等级、已开启的权限点、是否主管、数据范围（驱动菜单、路由守卫、按钮显隐）",
  "x-permission": null,
  "x-idempotent-reason": "纯查询（GET 不写库，A19）",
  responses: { ...okResponse(StaffMeSchema), ...errorResponses(401, 429) },
});

export const adminAuthSetPassword = adminRoute({
  method: "post",
  path: "/admin/auth/set-password",
  operationId: "admin.auth.setPassword",
  summary: "凭设置密码票据设置登录密码（首次登录、重置后）",
  "x-auth": "public",
  "x-permission": null,
  "x-idempotent": "none",
  "x-idempotent-reason": "登录前的激活与首次绑定，此时没有会话（C47 本稿归入登录与换会话）",
  "x-rate-limit": "admin.login",
  request: jsonBody(SetPasswordBodySchema),
  responses: { ...okResponse(AuthNextSchema), ...errorResponses(400, 401, 403, 429) },
});

export const adminAuthStepUp = adminRoute({
  method: "post",
  path: "/admin/auth/step-up",
  operationId: "admin.auth.stepUp",
  summary: "敏感操作前的再验证（动态口令），成功后前端自动重放原请求",
  "x-permission": null,
  "x-idempotent": "none",
  "x-idempotent-reason": "再验证，本稿归入登录与换会话一类（C47）",
  "x-rate-limit": "admin.login",
  request: jsonBody(StepUpBodySchema),
  responses: { ...okResponse(StepUpResultSchema), ...errorResponses(400, 401, 403, 429) },
});

export const adminAuthVerifyMfa = adminRoute({
  method: "post",
  path: "/admin/auth/verify-mfa",
  operationId: "admin.auth.verifyMfa",
  summary: "校验 6 位动态口令或恢复码，建立员工会话",
  "x-auth": "public",
  "x-permission": null,
  "x-idempotent": "none",
  "x-idempotent-reason": "登录与换会话（A18）",
  "x-rate-limit": "admin.login",
  request: jsonBody(VerifyMfaBodySchema),
  responses: { ...okResponse(StaffMeSchema), ...errorResponses(400, 401, 403, 429) },
});

export const adminAuthMeEnrollTotp = adminRoute({
  method: "post",
  path: "/admin/auth/me/enroll-totp",
  operationId: "admin.auth.me.enrollTotp",
  summary: "本人重新绑定动态口令：生成新的待确认密钥（用户菜单“动态口令设置”）",
  "x-permission": "self.mfa.reset",
  "x-idempotent": "none",
  "x-idempotent-reason":
    "结果只有一次性的新密钥，重放没有意义（C50 与 none 的分工）；重复调用只覆盖待确认密钥；已登记进 C47 的 none 清单（A139）",
  responses: {
    ...okResponse(TotpReEnrollmentSchema),
    ...errorResponses(400, 401, 403, 409, 429, 503),
  },
});

export const adminAuthMeConfirmTotp = adminRoute({
  method: "post",
  path: "/admin/auth/me/confirm-totp",
  operationId: "admin.auth.me.confirmTotp",
  summary: "本人重新绑定动态口令：校验新密钥的口令后替换密钥、换发 10 个恢复码、吊销本人其他会话",
  "x-permission": "self.mfa.reset",
  "x-idempotent": "required",
  "x-idempotent-reason":
    "有业务写入（替换密钥、重发恢复码、吊销其他会话）；结果脱敏 x-redact-on-replay recoveryCodes（A80、C50）",
  "x-redact-on-replay": ["recoveryCodes"],
  request: jsonBody(ConfirmTotpSelfBodySchema),
  responses: {
    ...okResponse(TotpReEnrollResultSchema),
    ...errorResponses(400, 401, 403, 409, 429, 503),
  },
});
