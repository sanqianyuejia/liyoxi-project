import {
  createDelivery,
  bindDelivery,
  createTickets,
  prepareTicketAssignees,
} from "../../delivery/index.js";
import { createFlow } from "../../flow/index.js";
import { createSla } from "../../sla/index.js";
import { createApproval } from "../../approval/index.js";
import { createTenant } from "../../tenant/index.js";
import { createProfile } from "../../profile/index.js";
import { createMedia } from "../../media/index.js";
import { TEST_KEYRING, sampleStaffContext } from "../../testing/index.js";
import { createIdentityContext } from "../../kernel/index.js";
import { calendarDate } from "@liyoxi/shared/time";
import { bindOrder } from "../binding.js";
import { buyer, drama, version } from "./harness.js";
import type { Harness } from "./harness.js";

export function derivedHarness(h: Harness) {
  const flow = createFlow({ assembly: h.assembly, clock: h.clock, events: h.events });
  const binding = { assembly: h.assembly, clock: h.clock, flow };
  const core = {
    ...binding,
    tx: h.tx,
    events: h.events,
    sla: createSla({ clock: h.clock, assembly: h.assembly }),
    timers: h.deps.timers,
  };
  const tenant = createTenant(core),
    approval = createApproval({ ...core, bizNo: h.deps.bizNo });
  const media = createMedia({ ...core, storage: h.fake.storage });
  const profile = createProfile({
    ...core,
    tenant,
    approval,
    media,
    keyring: () => TEST_KEYRING,
    wechat: h.fake.wechat,
    currentOpenid: async () => "lyxtest_order_derive",
  });
  const unbind = bindOrder(binding),
    clearDelivery = bindDelivery(core);
  const delivery = createDelivery({ ...core, media, profile });
  async function order(count = 1) {
    await version(h);
    const b = await buyer(h),
      d = await drama(h),
      manager = await h.make.staff({ staffRoleKey: "delivery_manager", isLead: true });
    await h.prisma.store.update({
      where: { id: b.store.id },
      data: { deliveryManagerId: manager.id },
    });
    const o = await h.make.dramaOrder({
      entityId: b.entity.id,
      storeId: b.store.id,
      placedByUserId: b.user.id,
      status: "producing",
      deliveryManagerId: manager.id,
      itemCount: count,
      totalChargePoints: 100 * count,
      subscriptionTermId: b.term!.id,
    });
    const snapshot = await h.tx.run((tx) =>
      h.deps.content.assertOrderable(tx, d.id, ["douyin"], calendarDate(h.clock.now())),
    );
    const items = [];
    for (let n = 0; n < count; n++) {
      const i = await h.make.orderItem({
        dramaOrderId: o.id,
        dramaId: d.id,
        phase: "producing",
        dramaSnapshot: snapshot,
      });
      await h.prisma.orderItemAccount.create({
        data: {
          orderItemId: i.id,
          channelAccountId: b.accountId,
          platform: "douyin",
          createdAt: h.clock.now(),
        },
      });
      items.push(i);
    }
    const made = await h.tx.run(async (tx) => {
      await prepareTicketAssignees(tx, o.id);
      return createTickets(tx, core, b.actor.ctx, { dramaOrderId: o.id });
    });
    const staff = await sampleStaffContext(h.prisma, manager.id),
      staffCtx = createIdentityContext({
        actor: { type: "staff", id: manager.id, client: "admin" },
      });
    return { b, d, o, items, ...made, staff, staffCtx };
  }
  return {
    ...h,
    binding,
    core,
    flow,
    delivery,
    orderFixture: order,
    clear: () => {
      clearDelivery();
      unbind();
    },
  };
}
export type DerivedHarness = ReturnType<typeof derivedHarness>;
