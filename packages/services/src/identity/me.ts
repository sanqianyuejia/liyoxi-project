// 当前账号 MeView（W1-04；m01 第 2.1–2.6、3.4 节）：GET /m/me 的响应，也嵌在两个登录接口的响应里。
// 只读、现算，不写库：成员关系取 tenant，待同意的协议取 docs，一次性提示读本模块的 merchant_user_notice。
// 手机号只出脱敏串（约定 C40）。
import type { MeUser, MeView, UserNotice } from "@liyoxi/contract";
import { toLocalParts } from "@liyoxi/shared/time";

import type { Docs } from "../docs/index.js";
import { AppError } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import type { Tenant } from "../tenant/index.js";

export interface MeDeps {
  readonly tenant: Pick<Tenant, "membershipBriefs">;
  readonly docs: Pick<Docs, "pendingConsents">;
  /** 短信通道配没配：配了才给“换绑手机号”这个动作（D4 第 3.5 节） */
  readonly smsConfigured: () => boolean;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** 一次性提示的文案：按类型与发生时间（北京时间）拼，库里不存（m01 第 2.6 节） */
export function noticeMessage(kind: string, occurredAt: Date): string {
  const at = toLocalParts(occurredAt);
  const when = `${pad(at.month)}-${pad(at.day)} ${pad(at.hour)}:${pad(at.minute)}`;
  if (kind === "new_wechat_bound") {
    return `您的账号于 ${when} 在一个新的微信上登录。如非本人操作，请到 我的 › 设置 › 账号与安全 移除该微信。`;
  }
  // 开放枚举：以后加的类型在这里补文案之前，先给一句通用的
  return `您的账号于 ${when} 有一条安全提示，请到 我的 › 设置 › 账号与安全 查看。`;
}

export async function buildMeView(tx: Tx, deps: MeDeps, merchantUserId: string): Promise<MeView> {
  const row = await tx.merchantUser.findUnique({
    where: { id: merchantUserId },
    select: { id: true, displayName: true, phoneMask: true, createdAt: true, status: true },
  });
  // 鉴权链已确认账号 active；走到这里取不到，是会话校验之后账号被注销了
  if (row === null || row.phoneMask === null) throw new AppError("SESSION_INVALID");
  const actions: MeUser["actions"] = [
    "update",
    ...(deps.smsConfigured() ? (["change-phone"] as const) : []),
    "deletion",
  ];
  const [memberships, pendingConsents, noticeRows] = [
    await deps.tenant.membershipBriefs(tx, merchantUserId),
    await deps.docs.pendingConsents(tx, merchantUserId),
    await tx.merchantUserNotice.findMany({
      where: { merchantUserId, ackedAt: null },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { id: true, kind: true, occurredAt: true },
    }),
  ];
  const notices: UserNotice[] = noticeRows.map((notice) => ({
    userNoticeId: notice.id,
    kind: notice.kind as UserNotice["kind"],
    occurredAt: notice.occurredAt.toISOString(),
    message: noticeMessage(notice.kind, notice.occurredAt),
  }));
  return {
    user: {
      merchantUserId: row.id,
      displayName: row.displayName,
      phoneMask: row.phoneMask,
      registeredAt: row.createdAt.toISOString(),
      actions,
    },
    memberships,
    pendingConsents,
    notices,
  };
}
