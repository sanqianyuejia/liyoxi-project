// 协议同意的门（W1-04；约定 C73；m01 第 2.5 节；13 分组 第 5.2 节）。协议同意中间件每个非白名单请求问一次：
//   常态只比一次字符串：账号上记的指纹（merchant_user.consent_stamp）等于“用户级协议当前版本集合”的指纹即放行，
//   不查同意记录；
//   不等时现算复核（新版本生效之后的第一次请求、小修订不用重新同意的情形）：没有待同意的即回写指纹并放行，
//   有则把待同意的协议交回去（中间件回 428，details.pendingConsents 与 m01 的结构相同）。
// 当前指纹在进程内至多缓存 60 秒，且不跨过下一个版本的生效时刻（任务书 第 10 节第 5 项）：
// 新版本到点生效后，最迟下一次取指纹就换成新的。
import type { PendingConsent } from "@liyoxi/contract";

import type { Docs } from "../docs/index.js";
import type { Clock, Tx, TxRunner } from "../kernel/index.js";

export const CONSENT_STAMP_CACHE_MS = 60_000;

export interface ConsentGateDeps {
  readonly tx: TxRunner;
  readonly clock: Clock;
  readonly docs: Pick<Docs, "consentStamps" | "pendingConsents">;
}

export interface ConsentGate {
  /** 本人此刻待同意的用户级协议；空数组即放行。stamp 是鉴权中间件随会话读到的账号指纹 */
  pending(principal: {
    merchantUserId: string;
    consentStamp: string | null;
  }): Promise<PendingConsent[]>;
  /** 丢掉缓存的指纹：用例里协议版本变了之后调；生产不用调（60 秒内自己换） */
  invalidate(): void;
}

/** 此刻之后最近的一个版本生效时刻（任何协议的都算：只会让缓存短一点）；没有即 null */
async function nextEffectiveAt(tx: Pick<Tx, "agreementVersion">, now: Date): Promise<Date | null> {
  const next = await tx.agreementVersion.findFirst({
    where: { status: { in: ["pending", "active"] }, effectiveAt: { gt: now } },
    orderBy: { effectiveAt: "asc" },
    select: { effectiveAt: true },
  });
  return next?.effectiveAt ?? null;
}

export function createConsentGate(deps: ConsentGateDeps): ConsentGate {
  let cached: { stamp: string; loadedAt: number; expiresAt: number } | null = null;

  async function requiredStamp(): Promise<string> {
    const at = deps.clock.now().getTime();
    // 时钟往回拨（只有用例会）也算过期
    if (cached !== null && at >= cached.loadedAt && at < cached.expiresAt) return cached.stamp;
    const loaded = await deps.tx.run(async (tx) => {
      const now = deps.clock.now();
      const stamps = await deps.docs.consentStamps(tx);
      return { stamp: stamps.user, now, next: await nextEffectiveAt(tx, now) };
    });
    const loadedAt = loaded.now.getTime();
    cached = {
      stamp: loaded.stamp,
      loadedAt,
      expiresAt: Math.min(
        loadedAt + CONSENT_STAMP_CACHE_MS,
        loaded.next?.getTime() ?? Number.POSITIVE_INFINITY,
      ),
    };
    return loaded.stamp;
  }

  return {
    async pending(principal) {
      const required = await requiredStamp();
      if (principal.consentStamp === required) return [];
      return deps.tx.run(async (tx) => {
        const pending = await deps.docs.pendingConsents(tx, principal.merchantUserId);
        if (pending.length > 0) return pending;
        // 复核全过：回写此刻的指纹（按库里现在的版本集合重算，不用缓存里的那一个）
        const { user: stamp } = await deps.docs.consentStamps(tx);
        const now = deps.clock.now();
        await tx.merchantUser.updateMany({
          where: { id: principal.merchantUserId, status: "active" },
          data: { consentStamp: stamp, updatedAt: now },
        });
        return [];
      });
    },
    invalidate() {
      cached = null;
    },
  };
}
