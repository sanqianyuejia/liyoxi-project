// 范围谓词（W1-01a）：把 DataScope 变成查询条件。门店级谓词全仓只在这一处定义（D4 第 7.3 节；约定 C58）。
// 各资源的仓储函数第一个参数收 DataScope，在函数里把这里的谓词 AND 进 where；范围之外与不存在都当 404，不作区分。
// 列名照 02 分组（store）、09 分组（ad）、10 分组（delivery_ticket）。只拼条件，不查库。
// 带范围的仓储函数只返回资源自身的列与“向下”的子资源：主体下的门店、门店下的任务一律另调各自带范围的函数。
import type { UnassignedPool } from "@liyoxi/contract/authz";
import type { AD_STATUS, EnumValue } from "@liyoxi/contract/enums";
import type { Prisma } from "@liyoxi/db";

import { assertIssuedScope } from "./data-scope.js";
import type { DataScope, StaffScope } from "./data-scope.js";

/** 已经结束的广告：不再让剪辑师因它看到门店（09 分组 ad.editor_id：已确认与已取消的保留原剪辑师） */
const AD_CLOSED: EnumValue<typeof AD_STATUS>[] = ["confirmed", "cancelled"];

const ids = (scope: StaffScope): string[] => [...scope.staffIds];

/** 我（们）负责的门店：是它的交付经理；有 store_manager 池时再加上待分配的营业中门店 */
export function managedStore(scope: DataScope): Prisma.StoreWhereInput {
  assertIssuedScope(scope);
  if (scope.kind === "all") return {};
  return {
    OR: [
      { deliveryManagerId: { in: ids(scope) } },
      ...(scope.unassigned.has("store_manager")
        ? [{ deliveryManagerId: null, lifecycle: "active" }]
        : []),
    ],
  };
}

/**
 * 门店可见 = 我（们）负责它，或在它名下有分派给我（们）的、还没结束的任务
 * （未归档未终止的交付工单的剪辑师、发布专员；未确认未取消的广告的剪辑师）。
 * 任务结束后，剪辑师、发布专员不再看得到这家门店。
 */
export function storeScope(scope: DataScope): Prisma.StoreWhereInput {
  assertIssuedScope(scope);
  if (scope.kind === "all") return {};
  const mine = { in: ids(scope) };
  return {
    OR: [
      managedStore(scope),
      {
        deliveryTickets: {
          some: {
            archivedAt: null,
            terminatedAt: null,
            OR: [{ editorId: mine }, { publisherId: mine }],
          },
        },
      },
      { ads: { some: { status: { notIn: AD_CLOSED }, editorId: mine } } },
    ],
  };
}

/** 主体可见 = 它名下有我（们）可见的门店 */
export function entityScope(scope: DataScope): Prisma.EntityWhereInput {
  assertIssuedScope(scope);
  return scope.kind === "all" ? {} : { stores: { some: storeScope(scope) } };
}

/** 挂在门店下的资源（订购明细、渠道账号、素材、客服工单）：模型上的关系字段叫 store */
export function byStore(scope: DataScope): { store?: Prisma.StoreWhereInput } {
  assertIssuedScope(scope);
  return scope.kind === "all" ? {} : { store: storeScope(scope) };
}

/** 挂在主体下的资源（付款单、订阅、积分流水、发票、合同）：模型上的关系字段叫 entity */
export function byEntity(scope: DataScope): { entity?: Prisma.EntityWhereInput } {
  assertIssuedScope(scope);
  return scope.kind === "all" ? {} : { entity: entityScope(scope) };
}

/** W 里能当负责人列的名字：可空、以 Id 结尾、收得下一组 id。写错列名编译不过 */
export type StaffCol<W> = {
  [K in keyof W & `${string}Id`]-?: null extends W[K]
    ? { in: string[] } extends W[K]
      ? K
      : never
    : never;
}[keyof W & `${string}Id`];

export interface TaskScopeSpec<W> {
  /**
   * 任务所在的门店归我（们）负责时也算可见：给出怎么把门店条件挂到 W 上，如 (w) => ({ store: w })。
   * 收到的是 managedStore 的条件，不是 storeScope 的。交付工单不给：它用自己的负责人列，
   * 转移交付经理时在办工单一并移交、已归档的保留原负责人。
   */
  store?: (where: Prisma.StoreWhereInput) => W;
  /** 负责人列；pool 是这一列为空时对应的待分配池 */
  assignees: ReadonlyArray<{ col: StaffCol<W>; pool?: UnassignedPool }>;
}

/**
 * 任务类资源（交付工单、广告、客服工单）：门店归我（们）负责，或负责人在集合内，或（有对应的池且负责人为空）。
 * W 是该模型的 WhereInput。一个分支都没给时什么也查不到。
 */
export function taskScope<W>(scope: DataScope, spec: TaskScopeSpec<W>): W {
  assertIssuedScope(scope);
  if (scope.kind === "all") return {} as W;
  const branches: unknown[] = [];
  if (spec.store !== undefined) branches.push(spec.store(managedStore(scope)));
  for (const { col, pool } of spec.assignees) {
    branches.push({ [col]: { in: ids(scope) } });
    if (pool !== undefined && scope.unassigned.has(pool)) branches.push({ [col]: null });
  }
  return { OR: branches } as W;
}
