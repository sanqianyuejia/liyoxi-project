// 后台会话（W1-01a；约定 C4；03 分组 第 2.5 节；D4 第 6.5 节）。Cookie 会话，一次登录一行。
//   令牌是 32 字节随机数，Cookie 里放它的 base64url，库里只存 sha256。
//   空闲 60 分钟滑动、绝对 12 小时；每请求校验未吊销、未过期、员工仍是启用；距上次更新超过 60 秒才续写。
//   登录成功即 stepup_at = 现在：登录后 10 分钟内做标了再验证的操作不用再输一次动态口令。
//   吊销函数收事务句柄：与触发它的业务写（禁用、重置密码……）同一个事务，回滚则都不生效。
import { createHash, randomBytes } from "node:crypto";

import type {
  EnumValue,
  STAFF_SESSION_AUTH_METHOD,
  STAFF_SESSION_REVOKE_REASON,
} from "@liyoxi/contract/enums";
import type { Staff, StaffGroup, StaffSession } from "@liyoxi/db";

import { STEP_UP_TTL_MS } from "../authz/index.js";
import { AppError, uuidv7 } from "../kernel/index.js";
import type { AppEnv, Tx } from "../kernel/index.js";
import { recoveryHashesOf } from "./codes.js";
import type { RequestMeta, StaffAuthContext, StaffPrincipal, StaffSessionView } from "./types.js";

const MINUTE = 60_000;
/** 空闲过期：滑动 */
export const SESSION_IDLE_MS = 60 * MINUTE;
/** 绝对过期：从登录起算 */
export const SESSION_ABSOLUTE_MS = 12 * 60 * MINUTE;
/** 距上次续写超过这么久才再写一次 last_seen_at 与空闲过期时间 */
export const SESSION_TOUCH_MS = MINUTE;
/** 再验证的有效期（约定 C66：stepup_at 在 10 分钟以内）：常量只有 authz 的那一份，这里原样再给出 */
export { STEP_UP_TTL_MS };

export type SessionAuthMethod = EnumValue<typeof STAFF_SESSION_AUTH_METHOD>;
export type SessionRevokeReason = EnumValue<typeof STAFF_SESSION_REVOKE_REASON>;

/** 两个 Cookie 的名字（任务书 第 10 节第 5 项）：local、test 用无前缀的名字、不带 Secure；其余环境用 __Host- 前缀 */
export function staffCookieNames(appEnv: AppEnv): {
  session: string;
  device: string;
  secure: boolean;
} {
  const local = appEnv === "local" || appEnv === "test";
  return local
    ? { session: "lyx_admin", device: "lyx_dev", secure: false }
    : { session: "__Host-lyx_admin", device: "__Host-lyx_dev", secure: true };
}

/** 新的会话令牌：Cookie 里放的值 */
export const newSessionToken = (): string => randomBytes(32).toString("base64url");

/** 令牌 → 库里存的哈希；不是 32 字节的 base64url 即 null */
export function sessionTokenHash(token: string): Buffer<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return Buffer.from(createHash("sha256").update(Buffer.from(token, "base64url")).digest());
}

const viewOf = (session: StaffSession): StaffSessionView => ({
  id: session.id,
  authMethod: session.authMethod,
  createdAt: session.createdAt,
  idleExpiresAt: session.idleExpiresAt,
  absoluteExpiresAt: session.absoluteExpiresAt,
  stepupAt: session.stepupAt,
  stepUpValidUntil: new Date(session.stepupAt.getTime() + STEP_UP_TTL_MS),
});

/** 在调用方的事务里建一行会话，返回它与令牌 */
export async function createSession(
  tx: Tx,
  input: { staffId: string; authMethod: SessionAuthMethod; meta: RequestMeta; now: Date },
): Promise<{ session: StaffSession; token: string }> {
  const { now, meta } = input;
  const token = newSessionToken();
  const session = await tx.staffSession.create({
    data: {
      id: uuidv7(),
      staffId: input.staffId,
      tokenHash: sessionTokenHash(token) as Buffer<ArrayBuffer>,
      authMethod: input.authMethod,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      stepupAt: now,
      updatedAt: now,
    },
  });
  return { session, token };
}

/** 由会话行与员工行拼出“已登录的员工”：角色与本组成员走 5 秒缓存 */
export async function principalOf(
  ctx: Pick<StaffAuthContext, "roles">,
  staff: Staff & { staffGroup: StaffGroup | null },
  session: StaffSession,
): Promise<StaffPrincipal> {
  const ownGroup = staff.staffGroup;
  const [role, groupMemberIds] = await Promise.all([
    ctx.roles.role(staff.staffRoleKey),
    staff.staffGroupId === null ? [staff.id] : ctx.roles.groupMemberIds(staff.staffGroupId),
  ]);
  return {
    staff: {
      id: staff.id,
      staffNo: staff.staffNo,
      name: staff.name,
      staffRoleKey: staff.staffRoleKey,
      isLead: staff.isLead,
      status: staff.status,
      staffGroupId: staff.staffGroupId,
      displayName: staff.displayName,
      phoneMask: staff.phoneMask,
      wecomBindStatus: staff.wecomBindStatus,
      passwordChangedAt: staff.passwordChangedAt,
      recoveryCodesLeft: recoveryHashesOf(staff.recoveryCodes).length,
    },
    role,
    group: ownGroup === null ? null : { id: ownGroup.id, name: ownGroup.name },
    groupMemberIds,
    session: viewOf(session),
  };
}

/**
 * 每请求的会话校验：令牌对得上一行未吊销、未过空闲与绝对时限的会话，且员工仍是启用，否则 401 SESSION_INVALID。
 * 距上次续写超过 60 秒才写 last_seen_at 与空闲过期时间（空闲时限不越过绝对时限）。
 */
export async function authenticate(ctx: StaffAuthContext, token: string): Promise<StaffPrincipal> {
  const invalid = (): never => {
    throw new AppError("SESSION_INVALID");
  };
  const tokenHash = sessionTokenHash(token) ?? invalid();
  const found = await ctx.db.staffSession.findUnique({
    where: { tokenHash },
    include: { staff: { include: { staffGroup: true } } },
  });
  const now = ctx.clock.now();
  const at = now.getTime();
  if (
    found === null ||
    found.revokedAt !== null ||
    found.idleExpiresAt.getTime() <= at ||
    found.absoluteExpiresAt.getTime() <= at ||
    found.staff.status !== "active"
  ) {
    return invalid();
  }
  const { staff, ...session } = found;
  let current: StaffSession = session;
  if (at - session.lastSeenAt.getTime() > SESSION_TOUCH_MS) {
    const idleExpiresAt = new Date(
      Math.min(at + SESSION_IDLE_MS, session.absoluteExpiresAt.getTime()),
    );
    // 带上“未吊销”的条件：校验与续写之间被吊销的，续写落空，按失效算
    const touched = await ctx.tx.run((handle) =>
      handle.staffSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { lastSeenAt: now, idleExpiresAt, updatedAt: now },
      }),
    );
    if (touched.count === 0) return invalid();
    current = { ...session, lastSeenAt: now, idleExpiresAt, updatedAt: now };
  }
  return principalOf(ctx, staff, current);
}

/**
 * 吊销一名员工的全部会话，返回吊销了几个。与触发它的业务写同一个事务（禁用、重置密码、重置第二因子、改手机号）。
 * 提交之后，手持旧 Cookie 的下一个请求即 401。
 */
export async function revokeStaffSessions(
  tx: Tx,
  input: { staffId: string; reason: SessionRevokeReason; now: Date; exceptSessionId?: string },
): Promise<number> {
  const { count } = await tx.staffSession.updateMany({
    where: {
      staffId: input.staffId,
      revokedAt: null,
      ...(input.exceptSessionId ? { id: { not: input.exceptSessionId } } : {}),
    },
    data: { revokedAt: input.now, revokeReason: input.reason, updatedAt: input.now },
  });
  return count;
}

/** 吊销一个会话（退出、强制下线）；已吊销的不动。返回是否真的吊销了 */
export async function revokeSession(
  tx: Tx,
  input: { sessionId: string; reason: SessionRevokeReason; now: Date },
): Promise<boolean> {
  const { count } = await tx.staffSession.updateMany({
    where: { id: input.sessionId, revokedAt: null },
    data: { revokedAt: input.now, revokeReason: input.reason, updatedAt: input.now },
  });
  return count > 0;
}
