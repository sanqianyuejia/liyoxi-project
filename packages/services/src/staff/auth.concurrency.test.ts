import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTxRunner, isAppError } from "../kernel/index.js";
import type { TxRunner } from "../kernel/index.js";
import { createClock, createTestStaffAuth, totpNow, useSeededDatabase } from "../testing/index.js";
import type { TestStaffAuth } from "../testing/index.js";
import { META, nextPhone, openClient, provisionStaff, SLOW } from "./__fixtures__/staff.js";
import { issueTicket } from "./ticket.js";

// 任务书 W1-01a 第 7 节验收 5（甲类的并发测试）：独立连接加栅栏，每种重复 20 次。
// 栅栏：另一条连接先把员工行（引导是那把咨询锁）锁住，等参加的各方都撞到锁上，再一起放行。
// 各方各用一条连接（连接池上限 1）、各建各的用例，共用一只时钟。

const ROUNDS = 20;
const SIDES = 5;

const db = useSeededDatabase("services");
const clock = createClock();
let prisma: PrismaClient;
let gateClient: PrismaClient;
let gate: TxRunner;
let clients: PrismaClient[] = [];
let sides: TestStaffAuth[] = [];
let t: TestStaffAuth;

beforeAll(async () => {
  prisma = await db.prisma();
  t = createTestStaffAuth(prisma, { clock });
  gateClient = await openClient(db);
  gate = createTxRunner({ prisma: gateClient, appEnv: "test" });
  clients = await Promise.all(Array.from({ length: SIDES }, () => openClient(db)));
  sides = clients.map((client) => createTestStaffAuth(client, { clock }));
}, SLOW);

afterAll(async () => {
  await Promise.all([gateClient, ...clients].map((client) => client?.$disconnect()));
});

/** 这个库里正在等锁的会话数。pg_locks 谁都看得全；pg_stat_activity 只用它谁都看得到的两列（pid、库名） */
async function waiting(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(DISTINCT l.pid)::int AS n
       FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE NOT l.granted AND a.datname = current_database()`,
  );
  return rows[0]?.n ?? 0;
}

/** 栅栏：先持有 lockSql 取的那把锁，等 calls 都撞上来（或 10 秒）再放行；返回各方的结果 */
async function race<T>(
  lockSql: string,
  lockArgs: readonly unknown[],
  calls: readonly (() => Promise<T>)[],
): Promise<PromiseSettledResult<T>[]> {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  let held!: () => void;
  const holding = new Promise<void>((resolve) => (held = resolve));
  const keeper = gate.run(async (handle) => {
    await handle.$executeRawUnsafe(lockSql, ...lockArgs);
    held();
    await opened;
  });
  // 栅栏自己没立起来（加锁语句出错）就直接报出来，不干等
  await Promise.race([holding, keeper]);
  const pending = calls.map((call) => call());
  const deadline = Date.now() + 10_000;
  while ((await waiting()) < calls.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const blocked = await waiting();
  open();
  await keeper;
  const results = await Promise.allSettled(pending);
  expect(blocked, "各方都该撞到锁上").toBe(calls.length);
  return results;
}

const STAFF_ROW = "SELECT 1 FROM staff WHERE id = $1::uuid FOR NO KEY UPDATE";
const won = <T>(results: PromiseSettledResult<T>[]): T[] =>
  results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
const lost = (results: PromiseSettledResult<unknown>[]): string[] =>
  results.flatMap((result) =>
    result.status === "rejected"
      ? [isAppError(result.reason) ? result.reason.error : String(result.reason)]
      : [],
  );
const report = (name: string, outcomes: string[]): void => {
  process.stdout.write(`[staff 并发] ${name} ${ROUNDS} 轮：${[...new Set(outcomes)].join("；")}\n`);
};

describe(`后台登录：并发（验收 5），每种 ${ROUNDS} 轮`, { timeout: SLOW }, () => {
  it("并发执行两次引导：只建出一位超级管理员", async () => {
    const outcomes: string[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const results = await race(
        "SELECT pg_advisory_xact_lock(hashtext('lyx:staff:bootstrap'))",
        [],
        sides
          .slice(0, 2)
          .map(
            (side, index) => () =>
              side.staff.bootstrap({ name: `管理员${index}`, phone: nextPhone() }),
          ),
      );
      outcomes.push(`${won(results).length} 成功 / ${lost(results).join("、")}`);
      expect(won(results)).toHaveLength(1);
      expect(lost(results)).toEqual(["STATE_NOT_ALLOWED"]);
      const admins = await prisma.staff.findMany({
        where: { staffRoleKey: "super_admin", status: "active" },
      });
      expect(admins.map((row) => row.id)).toEqual([won(results)[0]?.staffId]);
      expect(await prisma.staffActivation.count({ where: { staffId: admins[0]?.id } })).toBe(1);
      // 摆回“没有启用的超级管理员”，下一轮接着比
      await prisma.staff.updateMany({
        where: { staffRoleKey: "super_admin", status: "active" },
        data: { status: "disabled", disabledAt: clock.now(), disabledReason: "other" },
      });
    }
    expect(await prisma.staff.count({ where: { staffRoleKey: "super_admin" } })).toBe(ROUNDS);
    report("引导", outcomes);
  });

  it("两条连接同时用同一个动态口令：只成功一个", async () => {
    const outcomes: string[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const who = await provisionStaff(t, prisma);
      const { ticket } = issueTicket(t.authKeys, {
        staffId: who.id,
        purpose: "mfa",
        now: clock.now(),
      });
      const code = totpNow(who.secret, clock);
      const results = await race(
        STAFF_ROW,
        [who.id],
        sides
          .slice(0, 2)
          .map((side) => () => side.staff.verifyMfa({ ticket, method: "totp", code, meta: META })),
      );
      outcomes.push(`${won(results).length} 成功 / ${lost(results).join("、")}`);
      expect(won(results)).toHaveLength(1);
      expect(lost(results)).toEqual(["AUTH_FAILED"]);
      expect(await prisma.staffSession.count({ where: { staffId: who.id } })).toBe(1);
      // 输的一方在赢的一方清零之后记了一次失败
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: who.id } })).failUntrusted).toBe(
        1,
      );
    }
    report("同一个动态口令", outcomes);
  });

  it("两条连接同时用同一个恢复码：只成功一个，恢复码只少一个", async () => {
    const outcomes: string[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const who = await provisionStaff(t, prisma);
      const { ticket } = issueTicket(t.authKeys, {
        staffId: who.id,
        purpose: "mfa",
        now: clock.now(),
      });
      const code = who.recoveryCodes[round % 10] as string;
      const results = await race(
        STAFF_ROW,
        [who.id],
        sides
          .slice(0, 2)
          .map(
            (side) => () => side.staff.verifyMfa({ ticket, method: "recovery", code, meta: META }),
          ),
      );
      outcomes.push(`${won(results).length} 成功 / ${lost(results).join("、")}`);
      expect(won(results)).toHaveLength(1);
      expect(lost(results)).toEqual(["AUTH_FAILED"]);
      expect(won(results)[0]?.principal.staff.recoveryCodesLeft).toBe(9);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: who.id } });
      expect(row.recoveryCodes).toHaveLength(9);
      expect(await prisma.staffSession.count({ where: { staffId: who.id } })).toBe(1);
    }
    report("同一个恢复码", outcomes);
  });

  it("两条连接同时确认同一次绑定：只成功一个，恢复码只生成一组", async () => {
    const outcomes: string[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const who = await provisionStaff(t, prisma, { totp: false });
      const { ticket } = issueTicket(t.authKeys, {
        staffId: who.id,
        purpose: "enroll_totp",
        now: clock.now(),
      });
      const enrollment = await t.staff.enrollTotp({ ticket });
      const code = totpNow(enrollment.secret, clock);
      const results = await race(
        STAFF_ROW,
        [who.id],
        sides
          .slice(0, 2)
          .map(
            (side) => () => side.staff.confirmTotp({ ticket: enrollment.ticket, code, meta: META }),
          ),
      );
      outcomes.push(`${won(results).length} 成功 / ${lost(results).join("、")}`);
      expect(won(results)).toHaveLength(1);
      expect(lost(results)).toEqual(["TOTP_ALREADY_ENROLLED"]);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: who.id } });
      expect(row.recoveryCodes).toHaveLength(10);
      expect(row.totpPendingSecretEnc).toBeNull();
      expect(await prisma.staffSession.count({ where: { staffId: who.id } })).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { targetId: who.id, action: "sys.staff.totp_enrolled" },
        }),
      ).toBe(1);
    }
    report("同一次确认绑定", outcomes);
  });

  it(`${SIDES} 个并发的错误密码：计数为 ${SIDES}，只锁一次`, async () => {
    const outcomes: string[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const who = await provisionStaff(t, prisma);
      const results = await race(
        STAFF_ROW,
        [who.id],
        sides.map(
          (side) => () =>
            side.staff.login({ phone: who.phone, password: "Wrong-2026-pw", meta: META }),
        ),
      );
      expect(lost(results)).toEqual(Array.from({ length: SIDES }, () => "AUTH_FAILED"));
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: who.id } });
      const events = await prisma.authEvent.groupBy({
        by: ["event"],
        where: { subjectId: who.id },
        _count: true,
      });
      const counts = Object.fromEntries(events.map((item) => [item.event, item._count]));
      outcomes.push(
        `计数 ${row.failUntrusted}、locked ${counts.locked ?? 0} 行、login_fail ${counts.login_fail ?? 0} 行`,
      );
      expect(row.failUntrusted).toBe(SIDES);
      expect(row.lockedUntilUntrusted).not.toBeNull();
      expect(counts).toEqual({ login_fail: SIDES, locked: 1 });
    }
    report("并发的错误密码", outcomes);
  });
});
