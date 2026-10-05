// 演示种子的连库用例（任务书 W1-01a 第 7 节验收 10 的后半；第 10 节第 11 项与文末的统稿补充）。
// 在带 W0-21 种子的库上跑：运行器现在只有 staff 一步。
import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { DEMO_SEED_STEPS, DemoSeedRefusedError, runDemoSeed } from "./demo-seed.js";
import type { DemoSeedDeps, DemoSeedReport } from "./demo-seed.js";
import { DEMO_SEED_JOB, DEMO_STAFF, demoStaffId } from "./staff/index.js";
import { createTestStaffAuth, useSeededDatabase } from "./testing/index.js";
import type { TestStaffAuth } from "./testing/index.js";

const db = useSeededDatabase("services");
const SLOW = 120_000;

let prisma: PrismaClient;
let t: TestStaffAuth;
let deps: DemoSeedDeps;
let first: DemoSeedReport;

beforeAll(async () => {
  prisma = await db.prisma();
  t = createTestStaffAuth(prisma);
  deps = { tx: t.tx, clock: t.clock, keyring: t.keyring, flow: t.flow, appEnv: "test" };
  first = await runDemoSeed(deps);
}, SLOW);

describe("演示种子", () => {
  it(
    "建 7 位待激活的演示员工，各出一枚激活码；主管、分组、分配池照任务书",
    async () => {
      expect(DEMO_SEED_STEPS.map((step) => step.name)).toEqual(expect.arrayContaining(["staff"]));
      expect(DEMO_SEED_STEPS[0]?.name).toBe("staff");
      expect(first.tables.filter((table) => table.step === "staff")).toEqual([
        { step: "staff", table: "staff", inserted: 7, existing: 0 },
        { step: "staff", table: "assignment_pool_member", inserted: 3, existing: 0 },
      ]);
      expect(first.staff.map((member) => member.key)).toEqual(DEMO_STAFF.map((def) => def.key));
      const codes = first.staff.map((member) => member.activation?.code ?? "");
      expect(codes.every((code) => /^[A-Z0-9]{8}$/.test(code))).toBe(true);
      expect(new Set(codes).size).toBe(7);

      const rows = await prisma.staff.findMany({
        where: { id: { in: first.staff.map((member) => member.staffId) } },
        include: { staffGroup: true, assignmentPoolMembers: true },
        orderBy: { staffNo: "asc" },
      });
      expect(
        rows.map((row) => [row.name, row.staffRoleKey, row.isLead, row.staffGroup?.isDefault]),
      ).toEqual(DEMO_STAFF.map((def) => [def.name, def.roleKey, def.isLead, true]));
      // 待激活：启用、没有口令、没绑动态口令；库里没有任何固定口令
      for (const row of rows) {
        expect([row.status, row.passwordHash, row.totpEnrolledAt]).toEqual(["active", null, null]);
      }
      // 财务两位，其中一位主管；默认交付经理是主管，在 delivery_manager 池里（不限城市）
      expect(rows.filter((row) => row.staffRoleKey === "finance").map((row) => row.isLead)).toEqual(
        [true, false],
      );
      expect(
        rows
          .flatMap((row) => row.assignmentPoolMembers.map((m) => `${m.pool}:${m.cityCode}`))
          .sort(),
      ).toEqual(["delivery_manager:", "editor:", "publisher:"]);
      expect(demoStaffId(first.staff, "delivery_manager")).toBe(
        rows.find((row) => row.staffRoleKey === "delivery_manager")?.id,
      );
    },
    SLOW,
  );

  it(
    "每位员工各有状态历史、ops 审计（操作人是系统任务）、staff.created 与一枚有效的激活码",
    async () => {
      const ids = first.staff.map((member) => member.staffId);
      const history = await prisma.statusTransition.findMany({
        where: { machine: "staff", subjectId: { in: ids } },
      });
      expect(history.map((row) => [row.fromState, row.event, row.toState])).toEqual(
        ids.map(() => [null, "staff.create", "active"]),
      );
      const audits = await prisma.auditLog.findMany({
        where: { action: "sys.staff.create", targetId: { in: ids } },
      });
      expect(audits).toHaveLength(7);
      expect(new Set(audits.map((row) => `${row.actorType}:${row.jobName}`))).toEqual(
        new Set([`system:${DEMO_SEED_JOB}`]),
      );
      expect(
        await prisma.outboxEvent.count({
          where: { eventType: "staff.created", aggregateId: { in: ids } },
        }),
      ).toBe(7);
      expect(
        await prisma.staffActivation.count({
          where: { staffId: { in: ids }, usedAt: null, revokedAt: null },
        }),
      ).toBe(7);
    },
    SLOW,
  );

  it(
    "发的激活码走得通激活第 1 步；发布专员持两个核验权限点且数据范围是全量",
    async () => {
      const publisher = first.staff.find((member) => member.key === "publisher");
      const def = DEMO_STAFF.find((item) => item.key === "publisher");
      const next = await t.staff.activate({
        phone: def?.phone ?? "",
        activationCode: publisher?.activation?.code ?? "",
      });
      expect(next.next).toBe("set_password");
      const role = await prisma.staffRole.findUniqueOrThrow({ where: { key: "publisher" } });
      expect(role.dataScope).toBe("all");
      expect(role.actions).toMatchObject({
        "publish.account.verify": { on: true },
        "publish.link.verify": { on: true },
      });
    },
    SLOW,
  );

  it(
    "重复执行：不重建、不重发码，新增 0 行；后台把发布专员的数据范围改回去的不再覆盖",
    async () => {
      await prisma.staffRole.update({ where: { key: "publisher" }, data: { dataScope: "own" } });
      const before = await prisma.staffActivation.count();
      const again = await runDemoSeed(deps);
      expect(again.inserted).toBe(0);
      expect(again.tables.filter((table) => table.step === "staff")).toEqual([
        { step: "staff", table: "staff", inserted: 0, existing: 7 },
        { step: "staff", table: "assignment_pool_member", inserted: 0, existing: 3 },
      ]);
      expect(again.staff.map((member) => member.staffId)).toEqual(
        first.staff.map((member) => member.staffId),
      );
      expect(again.staff.every((member) => member.activation === null)).toBe(true);
      expect(await prisma.staffActivation.count()).toBe(before);
      expect(
        (await prisma.staffRole.findUniqueOrThrow({ where: { key: "publisher" } })).dataScope,
      ).toBe("own");
    },
    SLOW,
  );

  it("APP_ENV=prod 下拒绝执行，一行不写", async () => {
    const before = await prisma.staff.count();
    await expect(runDemoSeed({ ...deps, appEnv: "prod" })).rejects.toBeInstanceOf(
      DemoSeedRefusedError,
    );
    expect(await prisma.staff.count()).toBe(before);
  });
});
