// 验收第 2 条的连库部分（任务书 W1-01a 第 7 节；D4 第 11.3 节“范围隔离”）：范围谓词真的拿去查库。
// 两名“本人”范围的交付经理各管一批门店，甲用谓词查不到乙的门店与工单；主管多看到待分配的；
// 剪辑师只因还没结束的任务看得到门店。全文件共用一个带种子的库，数据在 beforeAll 里一次造好。
import type { Prisma, PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { uuidv7 } from "../kernel/index.js";
import { createClock, createFactories, useSeededDatabase } from "../testing/index.js";

import { ROLE_KEYS, seededRole } from "./__fixtures__/contexts.js";
import { buildStaffContext } from "./context.js";
import type { StaffContext } from "./context.js";
import { ownTaskScope, SYSTEM_SCOPE } from "./data-scope.js";
import type { DataScope } from "./data-scope.js";
import { isStaffRoleKey, normalizeRoleConfig } from "./role-config.js";
import type { RoleConfig } from "./role-config.js";
import { byEntity, byStore, entityScope, managedStore, storeScope, taskScope } from "./scope.js";

const db = useSeededDatabase("services");
// 机器忙时拷库、造数据都会慢：时限留足
const TIMEOUT = { timeout: 120_000 };
const clock = createClock();

/** 交付工单的范围：工单自己的三个负责人列，不经门店推导（D4 第 7.3 节） */
const ticketScope = (scope: DataScope): Prisma.DeliveryTicketWhereInput =>
  taskScope<Prisma.DeliveryTicketWhereInput>(scope, {
    assignees: [
      { col: "deliveryManagerId" },
      { col: "editorId", pool: "ticket_editor" },
      { col: "publisherId" },
    ],
  });

interface World {
  prisma: PrismaClient;
  /** 库里读出来的员工行与角色行建的上下文 */
  ctx: Record<"a" | "b" | "lead" | "editor" | "cs", StaffContext>;
  /** 门店：甲的两家、乙的两家、待分配的一家 */
  stores: Record<"a1" | "a2" | "b1" | "b2" | "unassigned", string>;
  tickets: Record<"a1" | "a2" | "b1" | "b2" | "unassigned", string>;
  entityOf: Map<string, string>;
  adId: string;
}
let world: World;

beforeAll(async () => {
  const prisma = await db.prisma();
  const make = createFactories({ db: prisma, clock });
  const now = clock.now();

  // 库里的 8 个角色行是种子播的：读出来原样交给规整（jsonb 列不用先转），结果与代码默认配置相同
  const roleRows = await prisma.staffRole.findMany();
  expect(roleRows.map((row) => row.key).sort()).toEqual([...ROLE_KEYS].sort());
  const configOf = (roleKey: string): RoleConfig => {
    const row = roleRows.find((item) => item.key === roleKey);
    if (row === undefined || !isStaffRoleKey(roleKey)) throw new Error(`库里没有角色 ${roleKey}`);
    return normalizeRoleConfig(roleKey, row);
  };
  for (const roleKey of ROLE_KEYS) {
    expect(configOf(roleKey).issues, roleKey).toEqual([]);
    expect(configOf(roleKey).actions, roleKey).toEqual(seededRole(roleKey).actions);
  }

  const group = await prisma.staffGroup.create({
    data: {
      id: uuidv7(),
      name: "交付一组",
      staffRoleKey: "delivery_manager",
      createdAt: now,
      updatedAt: now,
    },
  });
  const a = await make.staff({ staffGroupId: group.id });
  const lead = await make.staff({ staffGroupId: group.id, isLead: true });
  const b = await make.staff();
  const editor = await make.staff({ staffRoleKey: "editor" });
  const cs = await make.staff({ staffRoleKey: "cs" });

  const contextFor = async (staffId: string): Promise<StaffContext> => {
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: staffId } });
    const members =
      row.staffGroupId === null
        ? []
        : await prisma.staff.findMany({
            where: { staffGroupId: row.staffGroupId },
            select: { id: true },
          });
    const role = configOf(row.staffRoleKey);
    return buildStaffContext({
      staff: {
        id: row.id,
        roleKey: role.roleKey,
        isLead: row.isLead,
        staffGroupId: row.staffGroupId,
      },
      role,
      groupStaffIds: members.map((member) => member.id),
      stepUpAt: null,
    });
  };

  // 每张工单带出自己的商家与门店；再把门店指给对应的交付经理
  const a1 = await make.deliveryTicket({
    step: "sample_making",
    deliveryManagerId: a.id,
    editorId: editor.id,
  });
  const a2 = await make.deliveryTicket({ step: "plan_confirm", deliveryManagerId: a.id });
  const b1 = await make.deliveryTicket({ step: "plan_confirm", deliveryManagerId: b.id });
  const b2 = await make.deliveryTicket({
    step: "archived",
    deliveryManagerId: b.id,
    editorId: editor.id,
  });
  const unassigned = await make.deliveryTicket();
  for (const [ticket, managerId] of [
    [a1, a.id],
    [a2, a.id],
    [b1, b.id],
    [b2, b.id],
  ] as const) {
    await prisma.store.update({
      where: { id: ticket.storeId },
      data: { deliveryManagerId: managerId },
    });
  }

  // 乙的门店 b1 上有一条制作中的广告，剪辑师是同一位
  const b1Entity = await prisma.entity.findUniqueOrThrow({ where: { id: b1.entityId } });
  const consent = await make.agreementConsent({
    scene: "ad_request",
    entityId: b1.entityId,
    storeId: b1.storeId,
  });
  const hold = await make.pointHold({ entityId: b1.entityId, storeId: b1.storeId });
  const ad = await prisma.ad.create({
    data: {
      id: uuidv7(),
      adNo: "GG20260105901",
      entityId: b1.entityId,
      storeId: b1.storeId,
      requestedByUserId: b1Entity.createdByUserId,
      type: "opening",
      durationSec: 15,
      promoPointCodes: ["brand"],
      status: "producing",
      editorId: editor.id,
      capturedAt: now,
      unitPricePoints: 100,
      discountBp: 10_000,
      chargePoints: 100,
      pricingSnapshot: {},
      pointHoldId: hold.id,
      freeRevisionQuota: 2,
      agreementConsentId: consent.id,
      submittedAt: now,
      firstDueAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  const all = { a1, a2, b1, b2, unassigned };
  const pick = <K extends "id" | "storeId">(key: K) =>
    Object.fromEntries(Object.entries(all).map(([name, row]) => [name, row[key]])) as Record<
      keyof typeof all,
      string
    >;
  world = {
    prisma,
    ctx: {
      a: await contextFor(a.id),
      b: await contextFor(b.id),
      lead: await contextFor(lead.id),
      editor: await contextFor(editor.id),
      cs: await contextFor(cs.id),
    },
    stores: pick("storeId"),
    tickets: pick("id"),
    entityOf: new Map(Object.values(all).map((row) => [row.storeId, row.entityId])),
    adId: ad.id,
  };
}, 300_000);

const idsOf = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id).sort();
const sorted = (...ids: string[]): string[] => [...ids].sort();

describe("范围谓词：连库", () => {
  it(
    "两名“本人”范围的交付经理：甲查不到乙的门店、主体、工单与账户，反过来也一样",
    TIMEOUT,
    async () => {
      const { prisma, ctx, stores, tickets, entityOf } = world;
      expect(ctx.a.dataScope).toBe("own");
      expect(ctx.b.dataScope).toBe("own");
      const cases = [
        { scope: ctx.a.scope, mine: ["a1", "a2"], theirs: ["b1", "b2", "unassigned"] },
        { scope: ctx.b.scope, mine: ["b1", "b2"], theirs: ["a1", "a2", "unassigned"] },
      ] as const;
      for (const { scope, mine, theirs } of cases) {
        const myStores = sorted(...mine.map((name) => stores[name]));
        const myEntities = sorted(...mine.map((name) => entityOf.get(stores[name]) as string));
        const myTickets = sorted(...mine.map((name) => tickets[name]));

        expect(idsOf(await prisma.store.findMany({ where: managedStore(scope) }))).toEqual(
          myStores,
        );
        expect(idsOf(await prisma.store.findMany({ where: storeScope(scope) }))).toEqual(myStores);
        expect(idsOf(await prisma.entity.findMany({ where: entityScope(scope) }))).toEqual(
          myEntities,
        );
        expect(idsOf(await prisma.deliveryTicket.findMany({ where: ticketScope(scope) }))).toEqual(
          myTickets,
        );
        expect(idsOf(await prisma.deliveryTicket.findMany({ where: byStore(scope) }))).toEqual(
          myTickets,
        );
        const accounts = await prisma.billingAccount.findMany({ where: byEntity(scope) });
        expect(accounts.map((row) => row.entityId).sort()).toEqual(myEntities);

        // 按 id 取别人的：范围之外与不存在不作区分，都取不到
        for (const name of theirs) {
          expect(
            await prisma.store.findFirst({
              where: { AND: [{ id: stores[name] }, storeScope(scope)] },
            }),
            name,
          ).toBeNull();
          expect(
            await prisma.deliveryTicket.findFirst({
              where: { AND: [{ id: tickets[name] }, ticketScope(scope)] },
            }),
            name,
          ).toBeNull();
          expect(
            await prisma.entity.findFirst({
              where: { AND: [{ id: entityOf.get(stores[name]) as string }, entityScope(scope)] },
            }),
            name,
          ).toBeNull();
        }
        for (const name of mine) {
          expect(
            await prisma.store.findFirst({
              where: { AND: [{ id: stores[name] }, storeScope(scope)] },
            }),
            name,
          ).not.toBeNull();
        }
      }
    },
  );

  it(
    "主管：本组负责的门店加待分配的门店；工单多看到缺剪辑师的；别组已有剪辑师的看不到",
    TIMEOUT,
    async () => {
      const { prisma, ctx, stores, tickets } = world;
      const { scope } = ctx.lead;
      expect(ctx.lead.dataScope).toBe("group");
      expect(idsOf(await prisma.store.findMany({ where: managedStore(scope) }))).toEqual(
        sorted(stores.a1, stores.a2, stores.unassigned),
      );
      // a1、a2 是同组的甲负责的；b1、待分配的那张缺剪辑师（ticket_editor 池）；b2 是乙的、已有剪辑师
      expect(idsOf(await prisma.deliveryTicket.findMany({ where: ticketScope(scope) }))).toEqual(
        sorted(tickets.a1, tickets.a2, tickets.b1, tickets.unassigned),
      );
      // 只含本人的范围：主管自己名下没有工单
      expect(
        await prisma.deliveryTicket.count({ where: ticketScope(ownTaskScope(ctx.lead.staff)) }),
      ).toBe(0);
      // 非主管的甲没有池：待分配的门店不在他的范围里
      expect(
        await prisma.store.count({
          where: { AND: [{ id: stores.unassigned }, managedStore(ctx.a.scope)] },
        }),
      ).toBe(0);
    },
  );

  it("全部范围（客服、系统任务）：不过滤", TIMEOUT, async () => {
    const { prisma, ctx } = world;
    const total = await prisma.store.count();
    expect(total).toBeGreaterThanOrEqual(5);
    expect(ctx.cs.dataScope).toBe("all");
    expect(await prisma.store.count({ where: storeScope(ctx.cs.scope) })).toBe(total);
    expect(await prisma.store.count({ where: storeScope(SYSTEM_SCOPE) })).toBe(total);
    expect(await prisma.deliveryTicket.count({ where: ticketScope(ctx.cs.scope) })).toBe(
      await prisma.deliveryTicket.count(),
    );
  });

  it("剪辑师：只因还没结束的任务看得到门店；任务结束后看不到", TIMEOUT, async () => {
    const { prisma, ctx, stores, tickets, adId } = world;
    const { scope } = ctx.editor;
    const visible = async (): Promise<string[]> =>
      idsOf(await prisma.store.findMany({ where: storeScope(scope) }));
    expect(await prisma.store.count({ where: managedStore(scope) })).toBe(0);
    // a1 有他在办的工单，b1 有他制作中的广告；b2 的工单已归档
    expect(await visible()).toEqual(sorted(stores.a1, stores.b1));
    // 工单列表按负责人列：归档的那张还是他的
    expect(idsOf(await prisma.deliveryTicket.findMany({ where: ticketScope(scope) }))).toEqual(
      sorted(tickets.a1, tickets.b2),
    );
    expect(await prisma.ad.count({ where: byStore(scope) })).toBe(1);

    const now = clock.now();
    await prisma.ad.update({
      where: { id: adId },
      data: { status: "confirmed", latestVersionNo: 1, confirmedVersionNo: 1, confirmedAt: now },
    });
    expect(await visible()).toEqual([stores.a1]);
    await prisma.deliveryTicket.update({
      where: { id: tickets.a1 },
      data: { step: "terminated", terminatedAt: now },
    });
    expect(await visible()).toEqual([]);
    // 甲照样看得到自己的门店：他是门店的交付经理，不靠任务
    expect(
      await prisma.store.count({ where: { AND: [{ id: stores.a1 }, storeScope(ctx.a.scope)] } }),
    ).toBe(1);
  });
});
