import { beforeAll, expect, it } from "vitest";
import { useSeededDatabase } from "../testing/index.js";
import type { TxRunner } from "../kernel/index.js";
import { uuidv7 } from "../kernel/index.js";
import { body, buyer, drama, harness, version } from "./__fixtures__/harness.js";
import type { Harness } from "./__fixtures__/harness.js";
import { detail } from "./read.js";
import { dictRefsFor } from "./quote.js";
import { createOrderService } from "./service.js";

const database = useSeededDatabase("services");
let h: Harness;
beforeAll(async () => {
  h = harness(await database.prisma());
  await version(h);
}, 120000);

it("多剧新单真实RETURNING默认值与同TXfresh详情逐字段相同，末尾展示关系仍读当前值", async () => {
  const b = await buyer(h);
  const dramas = await Promise.all([101, 102, 103].map((points) => drama(h, points)));
  const firstAccount = await h.prisma.channelAccount.findUniqueOrThrow({
    where: { id: b.accountId },
  });
  const second = await h.prisma.channelAccount.create({
    data: {
      id: uuidv7(),
      entityId: b.entity.id,
      storeId: b.store.id,
      platform: "wechat_channels",
      accountUid: "lyxtest_second",
      accountUidNorm: "lyxtest_second",
      accountName: "视频号原名",
      accountType: "none",
      status: "available",
      submittedAt: h.clock.now(),
      verifiedAt: h.clock.now(),
      verifiedByStaffId: firstAccount.verifiedByStaffId,
      createdAt: h.clock.now(),
      updatedAt: h.clock.now(),
    },
  });
  const input = await body(
    h,
    b,
    dramas.map((d) => d.id),
  );
  input.channelAccountIds = [second.id, b.accountId];
  const originalArm = h.deps.timers.arm;
  let compared = false,
    changed = false;
  const tx: TxRunner = {
    run: (fn, options) =>
      h.tx.run(async (handle) => {
        const result = await fn(handle);
        if (result && typeof result === "object" && "orderId" in result) {
          const actual = await detail(handle, b.actor, String(result.orderId));
          expect(result).toEqual({ ...actual, replayed: false });
          compared = true;
        }
        return result;
      }, options),
  };
  const order = createOrderService({
    ...h.deps,
    tx,
    timers: {
      ...h.deps.timers,
      arm: async (handle, arg) => {
        const result = await originalArm(handle, arg);
        const term = await handle.subscriptionTerm.findUniqueOrThrow({ where: { id: b.term!.id } });
        await handle.plan.update({ where: { id: term.planId }, data: { name: "事务末尾套餐名" } });
        await handle.agreement.update({
          where: { key: "custom_license" },
          data: { name: "事务末尾协议名" },
        });
        await handle.channelAccount.update({
          where: { id: second.id },
          data: { accountName: "事务末尾视频号名" },
        });
        changed = true;
        return result;
      },
    },
  });
  const out = await order.create(b.actor, input);
  expect(changed && compared).toBe(true);
  expect(out.planName).toBe("事务末尾套餐名");
  expect(out.agreements[0]!.name).toBe("事务末尾协议名");
  expect(out.items).toHaveLength(3);
  expect(out.items.map((item) => item.itemNo)).toEqual([1, 2, 3]);
  for (const item of out.items) {
    expect(
      item.accounts.find((account) => account.channelAccountId === second.id)?.accountName,
    ).toBe("事务末尾视频号名");
    expect(item.returnPoints).toEqual({
      refundRequestedPoints: 0,
      returnedPoints: 0,
      convertedPoints: 0,
      forfeitedPoints: 0,
    });
    expect(item.liveEpisodeCount).toBe(0);
    expect(item.agreedLaunchDate).toBeNull();
    expect(item.usageStartDate).toBeNull();
  }
}, 60000);

it("同请求字典批读保留type隔离、停用名称、输入重复/顺序和缺码回落", async () => {
  const now = h.clock.now();
  for (const type of ["genre", "custom_focus"])
    await h.prisma.dictItem.upsert({
      where: { dictTypeKey_code: { dictTypeKey: type, code: "lyxtest_same" } },
      create: {
        id: uuidv7(),
        dictTypeKey: type,
        code: "lyxtest_same",
        name: `${type}停用名称`,
        ext: {},
        isEnabled: false,
        position: 999,
        createdAt: now,
        updatedAt: now,
      },
      update: {},
    });
  await h.tx.run(async (tx) => {
    const codes = ["lyxtest_same", "lyxtest_missing", "lyxtest_same"];
    const refs = await dictRefsFor(tx, [
      { type: "genre", codes },
      { type: "custom_focus", codes },
    ]);
    for (const type of ["genre", "custom_focus"])
      expect(refs(type, codes)).toEqual([
        { code: "lyxtest_same", name: `${type}停用名称` },
        { code: "lyxtest_missing", name: "lyxtest_missing" },
        { code: "lyxtest_same", name: `${type}停用名称` },
      ]);
    expect(refs("genre", [])).toEqual([]);
  });
});
