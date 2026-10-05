// 限流档位的登记（约定 C68；W0-22b）。档位按 operationId 登记，不按路径：这张表就是约定 C68 那张表的
// “档位”“登记的 operationId”两栏。额度不在这里：它是部署配置，初始值在 apps/api 的额度表里。
//
// 一条路由的生效档位（rateLimitTiersOf）= 名下登记了它的专用档位 + 它自己写的 x-rate-limit + 所在组的缺省档位。
// 专用档位与缺省档位同时生效。回调没有按用户的缺省档位，全部回调只受 hooks.ip 约束，这里把它记成回调这一组的
// 缺省档位。根路径探活不是路由，不挂档位（约定 C1）。
//
// 加一条要单独限流的接口：把它的 operationId 写进对应档位的 operations；新档位在表里加一项，
// 同 PR 改约定 C68 的表与 apps/api 的额度表（少了额度，api 起不来）。
import type { RouteGroup, RouteMeta } from "./meta.js";

export interface RateLimitTierDef {
  /** 是哪一组的缺省档位：该组的全部路由都受它约束 */
  readonly defaultFor?: RouteGroup;
  /** 专用档位名下的 operationId；缺省档位不列 */
  readonly operations: readonly string[];
}

export const RATE_LIMIT_TIERS = {
  "m.global": { defaultFor: "m", operations: [] },
  "m.login.silent": { operations: ["m.session.create"] },
  "m.login.phone": { operations: ["m.session.phoneLogin"] },
  "m.invitation": { operations: ["m.invitation.lookup", "m.invitation.accept"] },
  "m.sms": { operations: ["m.smsCode.create", "m.storeProfile.contactSmsCode.create"] },
  "m.analytics": { operations: ["m.analyticsEvent.batchCreate"] },
  "m.sign": {
    operations: [
      "m.qualificationDoc.downloadUrls",
      "m.licenseLetter.downloadUrls",
      "m.orderItem.downloadUrls",
      "m.sample.downloadUrls",
      "m.ad.downloadUrls",
      "m.invoiceRequest.downloadUrls",
      "portal.orderItem.downloadUrls",
      "portal.sample.playbackUrls",
      "portal.ad.playbackUrls",
    ],
  },
  "m.subscribe": { operations: ["m.subscribeResult.create"] },
  // 约定 C68 的表里这一行写的是“单资源”，没有档位名；名字是本表起的
  "m.payment_sync": { operations: ["m.paymentOrder.sync"] },
  "admin.global": { defaultFor: "admin", operations: [] },
  "admin.login": {
    operations: [
      "admin.auth.login",
      "admin.auth.verifyMfa",
      "admin.auth.activate",
      "admin.auth.setPassword",
      "admin.auth.enrollTotp",
      "admin.auth.confirmTotp",
      "admin.auth.stepUp",
      "admin.auth.me.enrollTotp",
      "admin.auth.me.confirmTotp",
    ],
  },
  "admin.pii_reveal": { operations: ["admin.piiReveal.create"] },
  "admin.notify_test": {
    operations: ["admin.notifyScene.testSend", "admin.smsTemplate.testSend"],
  },
  "portal.global": { defaultFor: "portal", operations: [] },
  "portal.ticket": {
    operations: [
      "portal.portalTicket.create",
      "portal.portalTicket.get",
      "portal.portalTicket.exchange",
    ],
  },
  "portal.verify": { operations: ["portal.licenseVerification.get"] },
  telemetry: {
    operations: ["m.clientError.create", "admin.clientError.create", "portal.clientError.create"],
  },
  "hooks.ip": { defaultFor: "hooks", operations: [] },
} as const satisfies Record<string, RateLimitTierDef>;

export type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;

export const RATE_LIMIT_TIER_NAMES = Object.keys(RATE_LIMIT_TIERS) as RateLimitTier[];

export function isRateLimitTier(value: unknown): value is RateLimitTier {
  return typeof value === "string" && Object.hasOwn(RATE_LIMIT_TIERS, value);
}

const tierDefs: Readonly<Record<RateLimitTier, RateLimitTierDef>> = RATE_LIMIT_TIERS;

/** operationId → 名下登记了它的专用档位 */
const dedicatedTiers = new Map<string, RateLimitTier[]>();
/** 组 → 缺省档位 */
const defaultTiers = new Map<RouteGroup, RateLimitTier[]>();
for (const tier of RATE_LIMIT_TIER_NAMES) {
  const def = tierDefs[tier];
  if (def.defaultFor !== undefined) {
    defaultTiers.set(def.defaultFor, [...(defaultTiers.get(def.defaultFor) ?? []), tier]);
  }
  for (const operationId of def.operations) {
    dedicatedTiers.set(operationId, [...(dedicatedTiers.get(operationId) ?? []), tier]);
  }
}

/** 路由写了没登记的档位 */
export class UnknownRateLimitTierError extends Error {
  constructor(tier: unknown) {
    super(
      `x-rate-limit 写的档位 ${String(tier)} 没有登记（packages/contract 的 RATE_LIMIT_TIERS）`,
    );
    this.name = "UnknownRateLimitTierError";
  }
}

/**
 * 一条路由的生效档位，专用的在前、所在组的缺省档位在后，不重复。
 * 路由自己写的 x-rate-limit 不在登记表里即抛 UnknownRateLimitTierError。
 */
export function rateLimitTiersOf(
  route: Pick<RouteMeta, "operationId" | "x-rate-limit">,
): RateLimitTier[] {
  const declared = route["x-rate-limit"];
  if (declared !== undefined && !isRateLimitTier(declared)) {
    throw new UnknownRateLimitTierError(declared);
  }
  const group = route.operationId.slice(0, route.operationId.indexOf(".")) as RouteGroup;
  return [
    ...new Set([
      ...(dedicatedTiers.get(route.operationId) ?? []),
      ...(declared === undefined ? [] : [declared]),
      ...(defaultTiers.get(group) ?? []),
    ]),
  ];
}
