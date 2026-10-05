// 商家读侧的事实端口（W1-03）：门店卡、主体额度卡、“我的”页、建档首页要拼别的模块的事实，
// 而 tenant、profile、identity 在 L1，读不到上层的表，同层之间也多半不在白名单里（06 第 3.6 节）。
// 所以 kernel 定义一个按来源分键的端口：拥有数据的模块在自己的 register.ts 里登记自己那个键，
// 读侧一次问全。没人登记的键取默认值（计数 0、其余 null）：页面照常出，只是那几项空着。
//
//   // 实现方（如 billing 的 register.ts）
//   portImplementations: [implementMerchantFacts("billing", async (tx, query) => ({ subscription, wallet }))]
//   // 读侧
//   const facts = await merchantFactsOf(assembly).read(tx, { entityId, storeIds, viewerRole, merchantUserId, now });
//   facts.order.stores[storeId].liveCount
//
// 依据：m02 第 2.2、2.3 节（门店卡与额度卡各字段的来源）；m08 第 2.4 节（“我的”页聚合）；任务书 W1-03 第 10 节第 3 项。
// 只读：实现里不写库、不调外部。各键的字段只增不改；要新的事实就往对应的键里加可选字段，并给默认值。
// 各键由谁登记：profile W1-08、billing W1-11a、order W1-15、publish W1-14；notify、asset、ad、support 在 M2、M3、M5、M7。
import type { MerchantRole } from "@liyoxi/contract/enums";

import { defineKeyedPort, implementKeyed } from "../assembly/index.js";
import type { Assembly, EnvScoped, PortImplementation } from "../assembly/index.js";
import type { Tx } from "../tx.js";

/** 来源模块，即端口的键 */
export const MERCHANT_FACT_SOURCES = [
  "profile",
  "billing",
  "order",
  "publish",
  "ad",
  "support",
  "notify",
  "asset",
] as const;
export type MerchantFactSource = (typeof MERCHANT_FACT_SOURCES)[number];

export interface MerchantFactsQuery {
  /** 主体：主体级的事实（套餐、积分）按它取 */
  readonly entityId: string;
  /** 要哪些门店的事实；都属于上面的主体。主体级的键不看它 */
  readonly storeIds: readonly string[];
  /** 观察者角色：待办数等有老板口径与店员口径之分 */
  readonly viewerRole: MerchantRole;
  /** 观察者：按人算的事实（未读消息数）要它 */
  readonly merchantUserId: string;
  /** 业务时间：读侧从注入的时钟取了传进来，实现不自己取 */
  readonly now: Date;
}

/** 字典项在响应里的形态（约定 C85） */
export interface FactDictRef {
  readonly code: string;
  readonly name: string;
}

/** profile：门店档案上的几项（m02 StoreCard；m08 OverviewStore） */
export interface ProfileStoreFacts {
  readonly city: FactDictRef | null;
  readonly category: FactDictRef | null;
  /** 首次审核通过的时间 */
  readonly verifiedAt: Date | null;
  /** 在审轮次的提交时间；没有在审轮次为空 */
  readonly submittedAt: Date | null;
  /** 在审轮次预计完成的时间 */
  readonly expectedDecisionAt: Date | null;
  /** 建档完整度 0–100；档案行未建为 0 */
  readonly completenessPct: number;
}

/** billing：当前或最近一期订阅（m02 EntityQuotaCard.subscription 与额度口径） */
export interface BillingSubscriptionFacts {
  readonly planName: string;
  /** 有效期止日（含），YYYY-MM-DD */
  readonly endDate: string;
  /** 当前是否生效；过期后仍返回最近一个周期 */
  readonly isActive: boolean;
  /** 这一期的门店数上限 */
  readonly maxStores: number;
  /** 这一期的成员数上限；null = 不限 */
  readonly maxMembers: number | null;
}

/** billing：“我的”页的套餐与积分卡（m08 OverviewPlanCard，与 m07 Wallet 同口径） */
export interface BillingWalletFacts {
  readonly status: "none" | "active" | "expired";
  readonly isRefundPending: boolean;
  readonly planName: string | null;
  readonly endDate: string | null;
  readonly remainingDays: number | null;
  readonly spendablePoints: number;
  readonly planAvailablePoints: number;
  readonly addonAvailablePoints: number;
  readonly planPointsExpireAt: Date | null;
  readonly isAddonSuspended: boolean;
}

/** order：订单项与选剧单上的计数（m04 第 2.9 节的三个计数函数） */
export interface OrderStoreFacts {
  /** 上线中的剧数 */
  readonly liveCount: number;
  /** 交付中的剧数（制作中、待上线，不含待开工） */
  readonly deliveringCount: number;
  /** 选剧单角标 */
  readonly cartCount: number;
  /** 待办数，按观察者角色的口径 */
  readonly todoCount: number;
}

/** publish：上线任务与渠道账号（m08 OverviewEntries） */
export interface PublishStoreFacts {
  readonly launchTaskTodoCount: number;
  readonly hasLaunchTasks: boolean;
  readonly channelAccountCount: number;
  /** 需要处理的渠道账号（m08 ChannelAccountAttention 的各字段）；没有为空 */
  readonly channelAccountAttention: Readonly<Record<string, unknown>> | null;
}

/** ad：广告计数（m08 的“我的广告”；m03 建档首页的三态计数） */
export interface AdStoreFacts {
  readonly pendingConfirmCount: number;
  readonly producingCount: number;
  readonly readyCount: number;
}

/** support：客服工单（m08 的“帮助与客服”角标） */
export interface SupportStoreFacts {
  readonly ticketAwaitingConfirmCount: number;
}

/** asset：门店素材数（未删除的） */
export interface AssetStoreFacts {
  readonly assetCount: number;
}

type ByStore<T> = Readonly<Record<string, T>>;

/** 各键返回什么。门店级的键返回“门店 id → 事实”，查询里的每家门店都要有 */
export interface MerchantFacts {
  readonly profile: { readonly stores: ByStore<ProfileStoreFacts> };
  readonly billing: {
    /** 从未开通为 null */
    readonly subscription: BillingSubscriptionFacts | null;
    /** 实现没给即 null：读侧按“未开通、0 积分”出 */
    readonly wallet: BillingWalletFacts | null;
  };
  readonly order: { readonly stores: ByStore<OrderStoreFacts> };
  readonly publish: { readonly stores: ByStore<PublishStoreFacts> };
  readonly ad: { readonly stores: ByStore<AdStoreFacts> };
  readonly support: { readonly stores: ByStore<SupportStoreFacts> };
  readonly notify: { readonly unreadMessageCount: number };
  readonly asset: { readonly stores: ByStore<AssetStoreFacts> };
}

/** 一个键的实现：只读 */
export type MerchantFactsProvider<K extends MerchantFactSource = MerchantFactSource> = (
  tx: Tx,
  query: MerchantFactsQuery,
) => Promise<MerchantFacts[K]>;

/** 按来源模块登记：用 implementMerchantFacts 登记，实现的返回类型才对得上自己那个键 */
export const merchantFactsPort = defineKeyedPort<MerchantFactsProvider>("merchant.facts");

/** 登记一个键的实现 */
export function implementMerchantFacts<K extends MerchantFactSource>(
  source: K,
  provider: MerchantFactsProvider<K>,
  options: EnvScoped = {},
): PortImplementation {
  return implementKeyed(merchantFactsPort, source, provider, options);
}

const perStore = <T>(storeIds: readonly string[], facts: T): ByStore<T> =>
  Object.fromEntries(storeIds.map((storeId) => [storeId, facts]));

/** 没人登记的键取它：计数 0，其余 null */
export function defaultMerchantFacts(storeIds: readonly string[]): MerchantFacts {
  return {
    profile: {
      stores: perStore(storeIds, {
        city: null,
        category: null,
        verifiedAt: null,
        submittedAt: null,
        expectedDecisionAt: null,
        completenessPct: 0,
      }),
    },
    billing: { subscription: null, wallet: null },
    order: {
      stores: perStore(storeIds, { liveCount: 0, deliveringCount: 0, cartCount: 0, todoCount: 0 }),
    },
    publish: {
      stores: perStore(storeIds, {
        launchTaskTodoCount: 0,
        hasLaunchTasks: false,
        channelAccountCount: 0,
        channelAccountAttention: null,
      }),
    },
    ad: {
      stores: perStore(storeIds, { pendingConfirmCount: 0, producingCount: 0, readyCount: 0 }),
    },
    support: { stores: perStore(storeIds, { ticketAwaitingConfirmCount: 0 }) },
    notify: { unreadMessageCount: 0 },
    asset: { stores: perStore(storeIds, { assetCount: 0 }) },
  };
}

export interface MerchantFactsReader {
  /** 这个键有没有模块登记 */
  has(source: MerchantFactSource): boolean;
  /** 只问一个键；没人登记即默认值 */
  source<K extends MerchantFactSource>(
    tx: Tx,
    source: K,
    query: MerchantFactsQuery,
  ): Promise<MerchantFacts[K]>;
  /** 一次问全（或只问 sources 里的几个，其余给默认值）。实现抛的错照抛：它们是只读查询 */
  read(
    tx: Tx,
    query: MerchantFactsQuery,
    sources?: readonly MerchantFactSource[],
  ): Promise<MerchantFacts>;
}

/** 门店级的键：实现漏了某家门店时补上默认值，读侧不用逐项判空 */
function withDefaults<K extends MerchantFactSource>(
  value: MerchantFacts[K],
  fallback: MerchantFacts[K],
): MerchantFacts[K] {
  if (!("stores" in value) || !("stores" in fallback)) return value;
  return { ...value, stores: { ...fallback.stores, ...value.stores } } as MerchantFacts[K];
}

/** 取事实端口 */
export function merchantFactsOf(assembly: Pick<Assembly, "portEntries">): MerchantFactsReader {
  const providers = assembly.portEntries(merchantFactsPort);
  const source = async <K extends MerchantFactSource>(
    tx: Tx,
    key: K,
    query: MerchantFactsQuery,
  ): Promise<MerchantFacts[K]> => {
    const fallback = defaultMerchantFacts(query.storeIds)[key];
    const provider = providers.get(key) as MerchantFactsProvider<K> | undefined;
    return provider === undefined ? fallback : withDefaults(await provider(tx, query), fallback);
  };
  return {
    has: (key) => providers.has(key),
    source,
    async read(tx, query, sources = MERCHANT_FACT_SOURCES) {
      const facts: Partial<Record<MerchantFactSource, unknown>> = defaultMerchantFacts(
        query.storeIds,
      );
      // 逐个问：同一个事务句柄不并发用
      for (const key of sources) facts[key] = await source(tx, key, query);
      return facts as unknown as MerchantFacts;
    },
  };
}
