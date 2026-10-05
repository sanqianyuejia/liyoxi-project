// auth_event：登录与安全事件（W1-01a；03 分组 第 2.11、3、4 节；15 分组 第 5.3 节）。三个身份空间（商家、员工、下载页）共用。
//   1. 写函数只收事务句柄。失败登录不属于任何业务事务：调用方把计数、锁定与这里的事件放进一个独立的事务。
//   2. 只增表：没有改的入口；删除只经库里的清理函数 lyx_03_purge_auth_event（应用角色没有 DELETE）。
//   3. 锁定告警：陌生来源桶被锁、同一账号当天满 3 次，经告警端口报出；端口失败不抛（alertsOf 的外壳已吞掉）。
import { AUTH_EVENT_EVENT, AUTH_EVENT_SPACE } from "@liyoxi/contract/enums";
import type { EnumValue } from "@liyoxi/contract/enums";
import type { Prisma } from "@liyoxi/db";
import { calendarDate, startOfDay } from "@liyoxi/shared/time";

import { isUuid, uuidv7 } from "../kernel/index.js";
import type { Alerts, CleanupContext, Tx } from "../kernel/index.js";
import { AUDIT_TEXT_LIMITS, clipOrNull } from "./sanitize.js";

export type AuthEventSpace = EnumValue<typeof AUTH_EVENT_SPACE>;
export type AuthEventName = EnumValue<typeof AUTH_EVENT_EVENT>;
export type AuthBucket = "trusted" | "untrusted";

/** detail 里已知的键（03 分组 第 4 节 AuthEventDetail）；别的键照收。不放口令、动态码、票据 */
export interface AuthEventDetail {
  readonly bucket?: AuthBucket;
  readonly lockedUntil?: string;
  /** 失败原因的内部分类，不回给客户端 */
  readonly reason?: string;
  readonly sessionId?: string;
  readonly identityId?: string;
  readonly requestId?: string | null;
  readonly [key: string]: unknown;
}

export interface AuthEventInput {
  readonly space: AuthEventSpace;
  /** 账号 id；账号不存在或没认出来时为空 */
  readonly subjectId: string | null;
  readonly event: AuthEventName;
  /** 认证方式，按身份空间不同（03 分组 第 3.3 节），如 password、password+totp、totp */
  readonly method?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly detail?: AuthEventDetail | null;
  /** 事件时间：取注入的时钟 */
  readonly at: Date;
}

/** 同一账号当天陌生来源桶被锁满几次就告警（D4 第 6.3 节） */
export const LOCK_ALERT_THRESHOLD = 3;
/** 规则键（任务书 第 10 节第 10 项）；登记进契约随 G2-D 的告警最小集 */
export const STAFF_LOCK_ALERT_RULE = "auth.staff_untrusted_locked";
/**
 * 清理线：早于这么多天的才删。库函数按库的时钟卡“12 个月”；这里多留一天，
 * 应用的时钟比库略快、或赶上闰年的 366 天，都不至于被库函数拒掉。
 */
export const AUTH_EVENT_RETENTION_DAYS = 367;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 写一行登录与安全事件，返回它的 id。取值不在契约的枚举里、账号 id 不是 UUID 即抛 TypeError（代码缺陷） */
export async function recordAuthEvent(tx: Tx, input: AuthEventInput): Promise<string> {
  if (!AUTH_EVENT_SPACE.values.includes(input.space))
    throw new TypeError("auth_event：身份空间没有登记");
  if (!AUTH_EVENT_EVENT.values.includes(input.event))
    throw new TypeError("auth_event：事件没有登记");
  if (input.subjectId !== null && !isUuid(input.subjectId)) {
    throw new TypeError("auth_event：账号 id 要是小写的 UUID");
  }
  const id = uuidv7();
  await tx.authEvent.create({
    data: {
      id,
      createdAt: input.at,
      space: input.space,
      subjectId: input.subjectId,
      event: input.event,
      method: input.method ?? null,
      ip: clipOrNull(input.ip ?? null, 64),
      userAgent: clipOrNull(input.userAgent ?? null, AUDIT_TEXT_LIMITS.userAgent),
      ...(input.detail ? { detail: input.detail as Prisma.InputJsonObject } : {}),
    },
  });
  return id;
}

/** 某个账号当天（北京时间）某个桶被锁的次数。走 ix_auth_event_space_subject_created_at */
export async function countLocksToday(
  db: Pick<Tx, "$queryRawUnsafe">,
  input: { space: AuthEventSpace; subjectId: string; bucket: AuthBucket; now: Date },
): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM auth_event
      WHERE space = $1 AND subject_id = $2::uuid AND created_at >= $3::timestamptz
        AND event = 'locked' AND detail->>'bucket' = $4`,
    input.space,
    input.subjectId,
    startOfDay(calendarDate(input.now)),
    input.bucket,
  );
  return rows[0]?.n ?? 0;
}

/**
 * 员工的陌生来源桶被锁之后调（锁定事件所在的事务提交之后）：当天满 3 次即经告警端口报出，返回是否报了。
 * alerts 要传 alertsOf(assembly) 给的那个：它的外壳保证端口失败不抛。数不出次数（库出错）同样不抛。
 */
export async function alertRepeatedStaffLocks(
  db: Pick<Tx, "$queryRawUnsafe">,
  alerts: Alerts,
  input: { staffId: string; now: Date },
): Promise<boolean> {
  try {
    const locks = await countLocksToday(db, {
      space: "staff",
      subjectId: input.staffId,
      bucket: "untrusted",
      now: input.now,
    });
    if (locks < LOCK_ALERT_THRESHOLD) return false;
    await alerts.raise({
      rule: STAFF_LOCK_ALERT_RULE,
      dimension: input.staffId,
      severity: "P2",
      detail: { staffId: input.staffId, bucket: "untrusted", locksToday: locks },
    });
    return true;
  } catch {
    return false;
  }
}

/** 清理项：调库里的清理函数删保留期之外的行，返回删了几行。每日一次（15 分组 第 5.3 节） */
export async function purgeAuthEvents(tx: Tx, ctx: Pick<CleanupContext, "now">): Promise<number> {
  const before = new Date(ctx.now.getTime() - AUTH_EVENT_RETENTION_DAYS * DAY_MS);
  const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
    "SELECT lyx_03_purge_auth_event($1::timestamptz) AS n",
    before,
  );
  return Number(rows[0]?.n ?? 0);
}
