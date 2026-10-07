// 数据范围与范围谓词的不连库部分：scopeOf 的取值、待分配池、谓词拼出来的条件、类型上造不出 DataScope。
// 连库的在 scope.db.test.ts。依据：D4 第 7.3 节。
import type { Prisma } from "@liyoxi/db";
import { describe, expect, it } from "vitest";

import { contextOf } from "./__fixtures__/contexts.js";
import {
  assertIssuedScope,
  effectiveDataScope,
  ownTaskScope,
  scopeCovers,
  scopeOf,
  scopeSnapshot,
  SYSTEM_SCOPE,
} from "./data-scope.js";
import type { DataScope } from "./data-scope.js";
import { byEntity, byStore, entityScope, managedStore, storeScope, taskScope } from "./scope.js";

const A = "01900000-0000-7000-8000-00000000000a";
const B = "01900000-0000-7000-8000-00000000000b";
const C = "01900000-0000-7000-8000-00000000000c";

describe("scopeOf", () => {
  it("opaque端口只恢复原签发handle；结构相同、反序列化和非对象仍拒绝", () => {
    const handle: unknown = ownTaskScope({ id: A });
    expect(assertIssuedScope(handle)).toBe(handle);
    expect(assertIssuedScope(SYSTEM_SCOPE)).toBe(SYSTEM_SCOPE);
    for (const fake of [
      null,
      undefined,
      "all",
      1,
      { kind: "all" },
      { kind: "staff", staffIds: [A], unassigned: new Set() },
      JSON.parse(JSON.stringify(scopeSnapshot(assertIssuedScope(handle)))),
    ]) {
      expect(() => assertIssuedScope(fake)).toThrow(TypeError);
    }
  });
  it("角色范围与主管标记取较大者：主管只放大，不缩小", () => {
    expect(effectiveDataScope("own", false)).toBe("own");
    expect(effectiveDataScope("own", true)).toBe("group");
    expect(effectiveDataScope("group", false)).toBe("group");
    expect(effectiveDataScope("all", false)).toBe("all");
    expect(effectiveDataScope("all", true)).toBe("all");
  });

  it("本人：只有自己；本组：自己加组员，去重；全部：不带名单", () => {
    const none = new Set<never>();
    const own = scopeOf({ id: A, isLead: false }, { dataScope: "own" }, [A, B], none);
    expect(scopeSnapshot(own)).toEqual({ kind: "staff", staffIds: [A], unassigned: [] });
    const group = scopeOf({ id: A, isLead: false }, { dataScope: "group" }, [B, A, B], none);
    expect(scopeSnapshot(group)).toEqual({ kind: "staff", staffIds: [A, B], unassigned: [] });
    // 没有分组的人范围是“本组”时，至少还有自己
    const alone = scopeOf({ id: A, isLead: true }, { dataScope: "own" }, [], none);
    expect(scopeSnapshot(alone)).toEqual({ kind: "staff", staffIds: [A], unassigned: [] });
    const all = scopeOf({ id: A, isLead: false }, { dataScope: "all" }, [B], none);
    expect(scopeSnapshot(all)).toEqual({ kind: "all" });
    expect(all).toBe(SYSTEM_SCOPE);
  });

  it("待分配池只给主管，按他持有的分配类权限点定（默认配置）", () => {
    const pools = (scope: DataScope): string[] =>
      scope.kind === "all" ? ["全部"] : [...scope.unassigned].sort();
    expect(pools(contextOf("delivery_manager").scope)).toEqual([]);
    expect(pools(contextOf("delivery_manager", { isLead: true }).scope)).toEqual([
      "ad_editor",
      "store_manager",
      "ticket_editor",
      "ticket_publisher",
    ]);
    expect(pools(contextOf("publisher").scope)).toEqual([]);
    expect(pools(contextOf("publisher", { isLead: true }).scope)).toEqual(["ticket_publisher"]);
    expect(pools(contextOf("editor", { isLead: true }).scope)).toEqual([]);
    // 客服、财务、内容运营、超级管理员的范围是全部
    for (const roleKey of ["cs", "finance", "content_ops", "super_admin"] as const) {
      expect(pools(contextOf(roleKey).scope), roleKey).toEqual(["全部"]);
    }
  });

  it("每类待分配的资源，默认配置下都有非超级管理员的主管看得到（D4 第 11.1 节）", () => {
    const leads = [
      contextOf("delivery_manager", { isLead: true }),
      contextOf("publisher", { isLead: true }),
      contextOf("cs", { isLead: true }),
    ];
    for (const pool of [
      "store_manager",
      "ticket_editor",
      "ticket_publisher",
      "ad_editor",
      "service_ticket",
    ] as const) {
      expect(
        leads.some((ctx) => scopeCovers(ctx.scope, null, pool)),
        pool,
      ).toBe(true);
    }
    // 非主管的交付经理一个池都看不到
    expect(scopeCovers(contextOf("delivery_manager").scope, null, "store_manager")).toBe(false);
  });

  it("ownTaskScope：只含本人，不带池", () => {
    const lead = contextOf("delivery_manager", { isLead: true, staffId: A, groupStaffIds: [B] });
    expect(scopeCovers(lead.scope, B)).toBe(true);
    const self = ownTaskScope(lead.staff);
    expect(scopeSnapshot(self)).toEqual({ kind: "staff", staffIds: [A], unassigned: [] });
    expect(scopeCovers(self, B)).toBe(false);
    expect(scopeCovers(self, null, "store_manager")).toBe(false);
  });
});

describe("DataScope 只能由 authz 给出", () => {
  it("外面写一个对象字面量当 DataScope 用，编译不过；硬转进来，谓词在运行时也不认", () => {
    // @ts-expect-error 缺品牌：外部造不出 DataScope
    const forgedAll: DataScope = { kind: "all" };
    // @ts-expect-error 缺品牌：带名单的那一种同样造不出
    const forgedStaff: DataScope = { kind: "staff", staffIds: [A], unassigned: new Set() };
    const revived = JSON.parse(JSON.stringify(scopeSnapshot(SYSTEM_SCOPE))) as DataScope;
    for (const forged of [forgedAll, forgedStaff, revived, null as unknown as DataScope]) {
      expect(() => managedStore(forged)).toThrow(TypeError);
      expect(() => storeScope(forged)).toThrow(TypeError);
      expect(() => entityScope(forged)).toThrow(TypeError);
      expect(() => byStore(forged)).toThrow(TypeError);
      expect(() => byEntity(forged)).toThrow(TypeError);
      expect(() => taskScope<Prisma.AdWhereInput>(forged, { assignees: [] })).toThrow(TypeError);
      expect(() => scopeCovers(forged, A)).toThrow(TypeError);
    }
  });

  it("给出的范围是冻结的", () => {
    const scope = contextOf("delivery_manager", { staffId: A }).scope;
    expect(Object.isFrozen(scope)).toBe(true);
    expect(scope.kind === "staff" && Object.isFrozen(scope.staffIds)).toBe(true);
  });
});

describe("范围谓词拼出来的条件", () => {
  const all = SYSTEM_SCOPE;
  const own = contextOf("delivery_manager", { staffId: A }).scope;
  const lead = contextOf("delivery_manager", {
    isLead: true,
    staffId: A,
    groupStaffIds: [B],
  }).scope;

  it("全部：都是空条件", () => {
    expect(managedStore(all)).toEqual({});
    expect(storeScope(all)).toEqual({});
    expect(entityScope(all)).toEqual({});
    expect(byStore(all)).toEqual({});
    expect(byEntity(all)).toEqual({});
    expect(
      taskScope<Prisma.DeliveryTicketWhereInput>(all, { assignees: [{ col: "editorId" }] }),
    ).toEqual({});
  });

  it("managedStore：是它的交付经理；主管另加待分配的营业中门店", () => {
    expect(managedStore(own)).toEqual({ OR: [{ deliveryManagerId: { in: [A] } }] });
    expect(managedStore(lead)).toEqual({
      OR: [{ deliveryManagerId: { in: [A, B] } }, { deliveryManagerId: null, lifecycle: "active" }],
    });
  });

  it("storeScope：负责它，或名下有分派给我、还没结束的工单或广告", () => {
    expect(storeScope(own)).toEqual({
      OR: [
        { OR: [{ deliveryManagerId: { in: [A] } }] },
        {
          deliveryTickets: {
            some: {
              archivedAt: null,
              terminatedAt: null,
              OR: [{ editorId: { in: [A] } }, { publisherId: { in: [A] } }],
            },
          },
        },
        { ads: { some: { status: { notIn: ["confirmed", "cancelled"] }, editorId: { in: [A] } } } },
      ],
    });
    expect(entityScope(own)).toEqual({ stores: { some: storeScope(own) } });
    expect(byStore(own)).toEqual({ store: storeScope(own) });
    expect(byEntity(own)).toEqual({ entity: { stores: { some: storeScope(own) } } });
  });

  it("taskScope：负责人在集合内；有对应的池才加“负责人为空”；门店分支收到的是 managedStore", () => {
    const ticketOf = (scope: DataScope): Prisma.DeliveryTicketWhereInput =>
      taskScope<Prisma.DeliveryTicketWhereInput>(scope, {
        assignees: [
          { col: "deliveryManagerId" },
          { col: "editorId", pool: "ticket_editor" },
          { col: "publisherId", pool: "ticket_publisher" },
        ],
      });
    expect(ticketOf(own)).toEqual({
      OR: [
        { deliveryManagerId: { in: [A] } },
        { editorId: { in: [A] } },
        { publisherId: { in: [A] } },
      ],
    });
    expect(ticketOf(lead)).toEqual({
      OR: [
        { deliveryManagerId: { in: [A, B] } },
        { editorId: { in: [A, B] } },
        { editorId: null },
        { publisherId: { in: [A, B] } },
        { publisherId: null },
      ],
    });
    const adOf = (scope: DataScope): Prisma.AdWhereInput =>
      taskScope<Prisma.AdWhereInput>(scope, {
        store: (where) => ({ store: where }),
        assignees: [{ col: "editorId", pool: "ad_editor" }],
      });
    expect(adOf(own)).toEqual({
      OR: [{ store: managedStore(own) }, { editorId: { in: [A] } }],
    });
    // 发布主管没有 ad_editor 池：不加“剪辑师为空”
    const publisherLead = contextOf("publisher", { isLead: true, staffId: C }).scope;
    expect(adOf(publisherLead)).toEqual({
      OR: [{ store: managedStore(publisherLead) }, { editorId: { in: [C] } }],
    });
    // 一个分支都没给：什么也查不到
    expect(taskScope<Prisma.AdWhereInput>(own, { assignees: [] })).toEqual({ OR: [] });
  });

  it("负责人列的名字写错编译不过", () => {
    taskScope<Prisma.DeliveryTicketWhereInput>(own, {
      // @ts-expect-error 没有这个列（大小写不对）
      assignees: [{ col: "editorID" }],
    });
    taskScope<Prisma.DeliveryTicketWhereInput>(own, {
      // @ts-expect-error 不是负责人列：不可空
      assignees: [{ col: "storeId" }],
    });
    taskScope<Prisma.ServiceTicketWhereInput>(own, {
      store: (where) => ({ store: where }),
      assignees: [{ col: "ownerStaffId", pool: "service_ticket" }],
    });
    expect(true).toBe(true);
  });
});
