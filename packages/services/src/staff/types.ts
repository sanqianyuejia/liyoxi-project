// staff 凭据与会话用例共用的类型与依赖（W1-01a）。
import type { Staff } from "@liyoxi/db";

import type { Flow } from "../flow/index.js";
import type { Alerts, Clock, TxRunner } from "../kernel/index.js";
import type { AuthKeys, Keyring } from "../security/index.js";
import type { RoleCache, RoleRow, StaffDb } from "./roles.js";

export type { StaffDb };

/** 请求的元信息：可信 IP 由接口层解析 */
export interface RequestMeta {
  readonly ip: string;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
}

export interface StaffAuthDeps {
  /** 开事务的入口 */
  readonly tx: TxRunner;
  /** 只读的库句柄：进程装配时传 Prisma 客户端 */
  readonly db: StaffDb;
  readonly clock: Clock;
  /** 字段加密的密钥环：手机号的盲索引与三件套 */
  readonly keyring: Keyring;
  /** 票据、设备 Cookie、MFA 三把密钥 */
  readonly authKeys: AuthKeys;
  readonly flow: Pick<Flow, "transition">;
  /** 告警端口：传 alertsOf(assembly) 给的那个（它的外壳保证失败不抛） */
  readonly alerts: Alerts;
  /** 角色与本组成员的进程内缓存时长；不给即 5 秒 */
  readonly roleCacheTtlMs?: number;
}

/** 用例内部用的依赖：外加已建好的角色缓存 */
export interface StaffAuthContext extends StaffAuthDeps {
  readonly roles: RoleCache;
}

/**
 * 登录前的下一步（a01 第 2.4 节 AuthNext）。时刻给 Date，接口层转成字符串。
 * mfa → 输动态口令或恢复码；set_password → 设密码；enroll_totp → 绑动态口令；login → 回登录页用新密码登录。
 */
export interface AuthNext {
  readonly next: "mfa" | "set_password" | "enroll_totp" | "login";
  readonly ticket: string | null;
  readonly ticketExpiresAt: Date | null;
  readonly methods: readonly ("totp" | "recovery")[];
}

export type SecondFactorMethod = "totp" | "recovery";

/** 当前会话 */
export interface StaffSessionView {
  readonly id: string;
  readonly authMethod: string;
  readonly createdAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  /** 最近一次验证第二因子的时刻 */
  readonly stepupAt: Date;
  /** stepupAt + 10 分钟：在这之前做标了再验证的操作不用再输动态口令 */
  readonly stepUpValidUntil: Date;
}

/**
 * 已登录的员工：会话校验的结果，也是两个建会话用例的结果。接口层据此拼 StaffMe（a01 第 2.3 节）、
 * 交给 authz 判权。角色行是库里的原样（两个 jsonb 没规整）：缺键取默认、丢注册表外的键归 authz。
 */
export interface StaffPrincipal {
  readonly staff: Pick<
    Staff,
    | "id"
    | "staffNo"
    | "name"
    | "staffRoleKey"
    | "isLead"
    | "status"
    | "staffGroupId"
    | "displayName"
    | "phoneMask"
    | "wecomBindStatus"
    | "passwordChangedAt"
  > & { readonly recoveryCodesLeft: number };
  readonly role: RoleRow;
  readonly group: { readonly id: string; readonly name: string } | null;
  /** 本组成员的 id（含本人）；没分组时只有本人。“本组”数据范围用 */
  readonly groupMemberIds: readonly string[];
  readonly session: StaffSessionView;
}

/** 建了会话的结果：令牌与设备 Cookie 的值只在这里出现一次，由接口层写进 Set-Cookie */
export interface SignedIn {
  readonly principal: StaffPrincipal;
  /** 会话 Cookie 的值 */
  readonly sessionToken: string;
  /** 设备 Cookie 的值（90 天） */
  readonly deviceCookie: string;
}
