// 按外键顺序造数据的工厂（W0-25）。用法见 ../README.md。
//
//   const make = createFactories({ db: await db.prisma(), clock });
//   const ticket = await make.deliveryTicket();          // 上级行（订单项、订购单、商家、短剧……）自动造好
//   const store = await make.store({ entityId, name: "解放路店" });   // 给了的照用，其余取缺省
//
// 一张表一个工厂，各插一行并返回它：缺省值过得了库的 CHECK、外键与唯一索引；主键 UUID v7；时间取注入的时钟。
// 工厂绕开服务函数直接插库，只是准备测试数据的手段：不写审计、不发事件、不写状态历史、不动账本。
// 只许在 packages/services/src/testing/ 下这样写；应用层的用例经 @liyoxi/services/testing 用，自己不写插库语句。
// 加工厂：照同目录的文件再写一个，types.ts 的 TableFactories 与 FACTORY_TABLES 各加一行，用例清单会跟着要一条。
import type { Clock } from "../../../kernel/index.js";
import { testSealer } from "../seal.js";
import type { FactorySealer } from "../seal.js";

import { billingFactories } from "./billing.js";
import { contentFactories } from "./content.js";
import { createFactoryContext } from "./context.js";
import type { FactoryDb } from "./context.js";
import { deliveryFactories } from "./delivery.js";
import { docsFactories } from "./docs.js";
import { mediaFactories } from "./media.js";
import { orderFactories } from "./order.js";
import { staffFactories } from "./staff.js";
import { tenantFactories } from "./tenant.js";
import type { Factories, ScenarioFactories } from "./types.js";

export type { FactoryDb } from "./context.js";
export { FACTORY_TABLES } from "./types.js";
export type * from "./types.js";

export interface FactoryDeps {
  /** 往哪插：Prisma 客户端，或 tx.run 给的事务句柄 */
  readonly db: FactoryDb;
  /** 时间列取它的“现在”：传可拨时钟 createClock() */
  readonly clock: Clock;
  /** 敏感字段三件套；缺省是 security 的真实现加测试密钥环（../seal.ts 的 testSealer） */
  readonly seal?: FactorySealer;
}

function scenarioFactories(db: FactoryDb, make: Factories, now: () => Date): ScenarioFactories {
  return {
    async merchant({ verified = false } = {}) {
      const user = await make.merchantUser();
      const entity = await make.entity({
        createdByUserId: user.id,
        ...(verified ? { verificationStatus: "verified" } : {}),
      });
      const store = await make.store({
        entityId: entity.id,
        isPrimary: true,
        ...(verified ? { qualificationStatus: "verified" } : {}),
      });
      const owner = await make.entityMember({
        entityId: entity.id,
        merchantUserId: user.id,
        role: "owner",
        lastStoreId: store.id,
      });
      const billingAccount = await make.billingAccount({ entityId: entity.id });
      return { user, entity, store, owner, billingAccount };
    },

    async subscribedMerchant() {
      const merchant = await make.merchant({ verified: true });
      const term = await make.subscriptionTerm({ entityId: merchant.entity.id });
      const billingAccount = await db.billingAccount.update({
        where: { entityId: merchant.entity.id },
        data: { subStatus: "active", currentSubscriptionTermId: term.id, updatedAt: now() },
      });
      return { ...merchant, term, billingAccount };
    },
  };
}

export function createFactories(deps: FactoryDeps): Factories {
  const ctx = createFactoryContext({ ...deps, seal: deps.seal ?? testSealer });
  // 工厂之间互相调（造上级行）：先给出空壳，再把各组填进去
  const make = {} as Factories;
  return Object.assign(
    make,
    tenantFactories(ctx, make),
    staffFactories(ctx),
    mediaFactories(ctx),
    billingFactories(ctx, make),
    contentFactories(ctx, make),
    docsFactories(ctx, make),
    orderFactories(ctx, make),
    deliveryFactories(ctx, make),
    scenarioFactories(ctx.db, make, ctx.now),
  );
}
