// 后台：登录、员工、权限与系统 · 登录与会话的结构（docs/api/a01-system.md 第 2.3、2.4、3.1–3.8 节；W1-01a）。
// StaffMe 是 admin.auth.me.get 的响应，也是两个建会话接口的响应主体；AuthNext 是登录第一步、激活、设置密码的响应。
import { IdSchema, InstantSchema, openEnum, orNull } from "../../common/index.js";
import { ADMIN_MODULE_KEYS, MODULE_LEVELS } from "../../authz/index.js";
import type { AdminModuleKey } from "../../authz/index.js";
import {
  STAFF_ROLE_DATA_SCOPE,
  STAFF_SESSION_AUTH_METHOD,
  STAFF_WECOM_BIND_STATUS,
} from "../../enums/index.js";
import { z } from "../../zod.js";

import { StaffBriefSchema } from "./structures.js";

// ---------- 2.3 StaffMe ----------

const ModuleLevelSchema = z.enum(MODULE_LEVELS);

/** 13 个模块各一个等级：键取模块登记，缺的键服务端已按代码默认值补齐 */
export const ModuleLevelsSchema = z.object(
  Object.fromEntries(ADMIN_MODULE_KEYS.map((key) => [key, ModuleLevelSchema])) as Record<
    AdminModuleKey,
    typeof ModuleLevelSchema
  >,
);

export const StaffMeSchema = z
  .object({
    staff: StaffBriefSchema,
    /** 对商家展示的称呼 */
    displayName: orNull(z.string()),
    /** 登录手机号脱敏串；本人也只看脱敏值（约定 C40） */
    phoneMask: z.string(),
    roleName: z.string(),
    staffGroup: orNull(z.object({ staffGroupId: IdSchema, name: z.string() })),
    moduleLevels: ModuleLevelsSchema,
    /** 此刻生效的权限点；超级管理员为 V1.0 的全部键 */
    permissions: z.array(z.string()),
    /** 生效的数据范围：角色为 own 且本人是主管时升为 group */
    dataScope: openEnum(STAFF_ROLE_DATA_SCOPE.values),
    wecomBindStatus: openEnum(STAFF_WECOM_BIND_STATUS.values),
    mustChangePassword: z.boolean(),
    recoveryCodesLeft: z.int().min(0).max(10),
    session: z.object({
      staffSessionId: IdSchema,
      authMethod: openEnum(STAFF_SESSION_AUTH_METHOD.values),
      idleExpiresAt: InstantSchema,
      absoluteExpiresAt: InstantSchema,
      /** 最近一次第二因子验证 + 10 分钟 */
      stepUpValidUntil: InstantSchema,
    }),
    /** exposed_to = client 的特性开关求值结果（键 → 值） */
    flags: z.record(z.string(), z.unknown()),
    serverTime: InstantSchema,
  })
  .openapi("StaffMe");
export type StaffMe = z.infer<typeof StaffMeSchema>;

// ---------- 2.4 AuthNext ----------

export const AUTH_NEXT_STEPS = ["mfa", "set_password", "enroll_totp", "login"] as const;
export const SECOND_FACTOR_METHODS = ["totp", "recovery"] as const;
const SecondFactorMethodSchema = z.enum(SECOND_FACTOR_METHODS);

/** 票据：不透明串，不超过 512 字符。三种用途共用字段名 ticket */
const TicketSchema = z.string().min(1).max(512);

export const AuthNextSchema = z
  .object({
    next: z.enum(AUTH_NEXT_STEPS),
    /** next = login 时为 null */
    ticket: orNull(TicketSchema),
    ticketExpiresAt: orNull(InstantSchema),
    /** next = mfa 时为 ['totp','recovery']，其余为 [] */
    methods: z.array(SecondFactorMethodSchema),
  })
  .openapi("AuthNext");
export type AuthNextView = z.infer<typeof AuthNextSchema>;

// ---------- 3.1–3.7 请求体 ----------

/** 登录手机号：11 位中国大陆手机号 */
const StaffPhoneSchema = z.string().regex(/^1\d{10}$/, "手机号须为 11 位");
/** 动态口令 6 位数字；恢复码 10 位字母数字，不分大小写，中间可带一个连字符 */
const TotpCodeSchema = z.string().regex(/^\d{6}$/, "动态口令须为 6 位数字");
const SecondFactorCodeSchema = z
  .string()
  .regex(/^(?:\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/, "须为 6 位动态口令或 10 位恢复码");

export const LoginBodySchema = z
  .object({ phone: StaffPhoneSchema, password: z.string().min(1).max(128) })
  .openapi("LoginBody");

export const VerifyMfaBodySchema = z
  .object({ ticket: TicketSchema, method: SecondFactorMethodSchema, code: SecondFactorCodeSchema })
  .openapi("VerifyMfaBody");

export const ActivateBodySchema = z
  .object({
    phone: StaffPhoneSchema,
    /** 8 位数字字母，不分大小写 */
    activationCode: z.string().regex(/^[A-Za-z0-9]{8}$/, "激活码须为 8 位数字字母"),
  })
  .openapi("ActivateBody");

export const SetPasswordBodySchema = z
  .object({
    ticket: TicketSchema,
    /** 口令规则（至少 10 位等）由服务端判，不合规回 PASSWORD_POLICY_VIOLATED 并列出未满足的规则 */
    newPassword: z.string().min(1).max(128),
  })
  .openapi("SetPasswordBody");

export const EnrollTotpBodySchema = z.object({ ticket: TicketSchema }).openapi("EnrollTotpBody");

export const ConfirmTotpBodySchema = z
  .object({ ticket: TicketSchema, code: TotpCodeSchema })
  .openapi("ConfirmTotpBody");

export const StepUpBodySchema = z
  .object({ method: SecondFactorMethodSchema, code: SecondFactorCodeSchema })
  .openapi("StepUpBody");

// ---------- 3.5–3.7 响应 ----------

export const TotpEnrollmentSchema = z
  .object({
    /** otpauth://totp/…，前端渲染为二维码；密钥明文只在本响应出现 */
    otpauthUri: z.string(),
    /** Base32 密钥，供无法扫码时手输 */
    secret: z.string(),
    /** 续期到 15 分钟的 enroll_totp 票据，确认时回传 */
    ticket: TicketSchema,
    ticketExpiresAt: InstantSchema,
  })
  .openapi("TotpEnrollment");
export type TotpEnrollmentView = z.infer<typeof TotpEnrollmentSchema>;

export const TotpConfirmResultSchema = z
  .object({
    me: StaffMeSchema,
    /** 10 个一次性恢复码明文，只出现这一次 */
    recoveryCodes: z.array(z.string()),
  })
  .openapi("TotpConfirmResult");

export const StepUpResultSchema = z
  .object({ stepUpValidUntil: InstantSchema })
  .openapi("StepUpResult");
