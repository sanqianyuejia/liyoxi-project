import { beforeEach, expect, it } from "vitest";
import { createTxRunner, uuidv7 } from "../kernel/index.js";
import { createClock, createFactories, useSeededDatabase } from "../testing/index.js";
import { sendSystemAlert } from "./system-alert.js";
const db = useSeededDatabase("services"),
  clock = createClock();
beforeEach(() => db.reset(), 60_000);
it("三个级别真super双收件人、唯一键并发去重与恢复各一套三表", async () => {
  const prisma = await db.prisma(),
    tx = createTxRunner({ prisma, appEnv: "test" }),
    make = createFactories({ db: prisma, clock });
  const first = await make.staff({ staffRoleKey: "super_admin" }),
    second = await make.staff({ staffRoleKey: "super_admin" });
  await make.staff({
    staffRoleKey: "super_admin",
    status: "disabled",
    disabledAt: clock.now(),
    disabledReason: "resigned",
    disabledByStaffId: first.id,
  });
  await make.staff({ staffRoleKey: "finance" });
  for (const severity of ["P1", "P2", "P3"] as const) {
    const input = {
      alertId: uuidv7(),
      fingerprint: "timer.lag",
      severity,
      recovered: false,
      noticeNo: 0,
      at: clock.now(),
    };
    const results = await Promise.all([
      tx.run((handle) => sendSystemAlert(handle, input)),
      tx.run((handle) => sendSystemAlert(handle, input)),
    ]);
    expect(results.reduce((sum, item) => sum + item.created, 0)).toBe(2);
    await tx.run((handle) => sendSystemAlert(handle, { ...input, recovered: true, noticeNo: 1 }));
  }
  expect(await prisma.notification.count()).toBe(12);
  expect(await prisma.staffMessage.count()).toBe(12);
  expect(await prisma.notificationDelivery.count()).toBe(12);
  expect(
    await prisma.staffMessage.count({ where: { staffId: { in: [first.id, second.id] } } }),
  ).toBe(12);
  expect(
    await prisma.notificationDelivery.count({
      where: { channel: "inbox", status: "sent", sentAt: { not: null }, finishedAt: { not: null } },
    }),
  ).toBe(12);
});
it("ext禁用仍写inbox；scene禁用/无人为真0，scene缺失受控失败", async () => {
  const prisma = await db.prisma(),
    tx = createTxRunner({ prisma, appEnv: "test" });
  const input = {
    alertId: uuidv7(),
    fingerprint: "timer.lag",
    severity: "P2" as const,
    recovered: false,
    noticeNo: 0,
    at: clock.now(),
  };
  expect(await tx.run((handle) => sendSystemAlert(handle, input))).toMatchObject({
    status: "no_recipients",
    created: 0,
  });
  await createFactories({ db: prisma, clock }).staff({ staffRoleKey: "super_admin" });
  await prisma.notifyScene.update({
    where: { sceneKey: "s.system_alert" },
    data: { extEnabled: false },
  });
  expect(await tx.run((handle) => sendSystemAlert(handle, input))).toMatchObject({
    status: "sent",
    created: 1,
  });
  await prisma.notifyScene.update({
    where: { sceneKey: "s.system_alert" },
    data: { sceneEnabled: false },
  });
  expect(
    await tx.run((handle) => sendSystemAlert(handle, { ...input, noticeNo: 1 })),
  ).toMatchObject({ status: "disabled", created: 0 });
  expect(await prisma.notificationDelivery.count()).toBe(1);
  // 没有业务通知的另一场景可删来模拟未播种；使用独立重置不删除已被引用的通知。
  await db.reset();
  const empty = await db.prisma();
  await empty.notifyScene.delete({ where: { sceneKey: "s.system_alert" } });
  await expect(
    createTxRunner({ prisma: empty, appEnv: "test" }).run((handle) =>
      sendSystemAlert(handle, input),
    ),
  ).rejects.toMatchObject({ error: "INTERNAL", message: "系统告警通知场景尚未播种" });
});
