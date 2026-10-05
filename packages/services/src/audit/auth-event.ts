// auth_event：登录与安全事件的写函数（03 分组 第 2.11、3、4 节）。三个身份空间（商家、员工、下载页）共用。
//
// 这一份是 W1-04 先建的最小实现，只有“插一行”：任务书定的是 W1-01a 的第二个 PR 在本文件交写函数、清理项与锁定告警，
// 它还没合并。类型与 recordAuthEvent 的签名照它的写（两边对过），谁后合并谁并成一份：以 W1-01a 的那份为准，本文件的整个换掉。
//   1. 写函数只收事务句柄。失败登录不属于任何业务事务：调用方把它放进一个独立的事务。
//   2. 只增表：没有改的入口；删除只经库里的清理函数（应用角色没有 DELETE）。
import { AUTH_EVENT_EVENT, AUTH_EVENT_SPACE } from "@liyoxi/contract/enums";
import type { EnumValue } from "@liyoxi/contract/enums";
import type { Prisma } from "@liyoxi/db";

import { isUuid, uuidv7 } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { AUDIT_TEXT_LIMITS, clipOrNull } from "./sanitize.js";

export type AuthEventSpace = EnumValue<typeof AUTH_EVENT_SPACE>;
export type AuthEventName = EnumValue<typeof AUTH_EVENT_EVENT>;

/** detail 里已知的键（03 分组 第 4 节 AuthEventDetail）；别的键照收。不放口令、动态码、票据、令牌 */
export interface AuthEventDetail {
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
  /** 认证方式，按身份空间不同（03 分组 第 3.3 节）：商家侧是 silent、phone */
  readonly method?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly detail?: AuthEventDetail | null;
  /** 事件时间：取注入的时钟 */
  readonly at: Date;
}

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
