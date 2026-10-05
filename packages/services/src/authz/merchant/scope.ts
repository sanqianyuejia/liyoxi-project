// 门店与主体的数据范围（W1-04；D4 第 5.1 节）。按 id 取资源的仓储函数把范围写进签名与 where 条件：
//   orders.findById(scope: StoreScope, id)   // WHERE id = :id AND store_id = :scope.storeId
//   wallet.getBalance(scope: EntityScope)    // WHERE entity_id = :scope.entityId
// 范围带品牌，只能由下面两个构造函数从身份上下文得到：路由处理器拼不出一个没经过成员关系解析的范围。
// “仓储函数必须带范围”的 lint 规则不在这里（任务书 第 10 节第 7 项）。
import type { IdentityContext } from "../../kernel/index.js";

declare const storeScopeBrand: unique symbol;
declare const entityScopeBrand: unique symbol;

export interface StoreScope {
  readonly [storeScopeBrand]: true;
  readonly entityId: string;
  readonly storeId: string;
}

export interface EntityScope {
  readonly [entityScopeBrand]: true;
  readonly entityId: string;
}

/** 身份上下文里没有要的归属：代码缺陷（路由不是 member，或没经成员关系中间件），不是用户输入的问题 */
export class ScopeError extends TypeError {
  constructor(what: string) {
    super(`取不到数据范围：身份上下文里没有${what}（这条路由没有经成员关系解析）`);
    this.name = "ScopeError";
  }
}

/** 门店范围：身份上下文里有门店（必有主体）才给 */
export function storeScopeOf(ctx: Pick<IdentityContext, "entityId" | "storeId">): StoreScope {
  if (ctx.entityId === null || ctx.storeId === null) throw new ScopeError("门店");
  return Object.freeze({ entityId: ctx.entityId, storeId: ctx.storeId }) as StoreScope;
}

/** 主体范围：身份上下文里有主体才给 */
export function entityScopeOf(ctx: Pick<IdentityContext, "entityId">): EntityScope {
  if (ctx.entityId === null) throw new ScopeError("主体");
  return Object.freeze({ entityId: ctx.entityId }) as EntityScope;
}
