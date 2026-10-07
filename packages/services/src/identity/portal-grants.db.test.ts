// 直接表 fixture 只证明吊销能力，不代表 M6 票据/登录/下载 producer 已实现。
import { createHash } from "node:crypto";

import { createPrismaClient } from "@liyoxi/db";
import type { PortalSession, PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assembleServices } from "../assembly.js";
import { createTxRunner, lockRows, uuidv7 } from "../kernel/index.js";
import type { Tx, TxRunner } from "../kernel/index.js";
import { membershipAuthorizationsPort } from "../tenant/index.js";
import type { MembershipAuthorizations, PortalGrantRevocation } from "../tenant/index.js";
import {
  assertSnapshotsEqual,
  createClock,
  createFactories,
  snapshotTables,
  useTestDatabase,
} from "../testing/index.js";
import type { AdjustableClock, Factories } from "../testing/index.js";
import { revokePortalGrants } from "./index.js";

const db = useTestDatabase("services");
const SLOW = 90_000;
const HOUR = 3_600_000;
const ROUNDS = 12;
let prisma: PrismaClient;
let make: Factories;
let clock: AdjustableClock;
let tx: TxRunner;
let clients: PrismaClient[] = [];
let runners: TxRunner[] = [];
let grants: MembershipAuthorizations;

beforeAll(async () => {
  prisma = await db.prisma();
  clock = createClock();
  make = createFactories({ db: prisma, clock });
  tx = createTxRunner({ prisma, appEnv: "test" });
  clients = await Promise.all(
    [0, 1].map(async () =>
      createPrismaClient({ connectionString: await db.url(), max: 1, lockTimeoutMs: 15_000 }),
    ),
  );
  runners = clients.map((client) => createTxRunner({ prisma: client, appEnv: "test" }));
  grants = assembleServices({ entry: "api", appEnv: "test" }).port(membershipAuthorizationsPort);
  expect(grants.revokePortalGrants).toBe(revokePortalGrants);
}, SLOW);

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
});

type Scope = { entityId: string; storeId: string; approvedByUserId: string };

async function grant(scope: Scope, expired = false): Promise<PortalSession> {
  const id = uuidv7();
  const now = clock.now();
  return prisma.portalSession.create({
    data: {
      id,
      tokenHash: createHash("sha256").update(id).digest(),
      portalTicketId: uuidv7(),
      ...scope,
      grantScope: "store",
      createdAt: new Date(now.getTime() - 3 * HOUR),
      updatedAt: new Date(now.getTime() - HOUR),
      expiresAt: new Date(now.getTime() + (expired ? -HOUR : HOUR)),
      ip: "198.51.100.10",
      userAgent: "W210 table fixture",
    },
  });
}

async function fixtures() {
  const a = await make.merchant();
  const b = await make.merchant();
  const otherApprover = await make.merchantUser();
  const aScope = { entityId: a.entity.id, storeId: a.store.id, approvedByUserId: a.user.id };
  const aCurrent = await grant(aScope);
  const aExpired = await grant(aScope, true);
  const aOther = await grant({ ...aScope, approvedByUserId: otherApprover.id });
  // 同账号在 B 的历史授权不应被 A 的成员联动触及；不声称当前老板不变量成立。
  const bSameUser = await grant({
    entityId: b.entity.id,
    storeId: b.store.id,
    approvedByUserId: a.user.id,
  });
  const old = await grant(aScope);
  const alreadyRevoked = await prisma.portalSession.update({
    where: { id: old.id },
    data: {
      revokedAt: new Date(clock.now().getTime() - HOUR),
      updatedAt: new Date(clock.now().getTime() - HOUR),
      revokeReason: "owner_revoked",
    },
  });
  return { a, b, aCurrent, aExpired, aOther, bSameUser, alreadyRevoked };
}

async function lockCaller(handle: Tx, entityId: string, memberIds: readonly string[]) {
  expect(await lockRows(handle, "entity", [entityId])).toEqual([entityId]);
  expect(await lockRows(handle, "entity_member", memberIds)).toEqual([...memberIds].sort());
}

const row = (id: string) => prisma.portalSession.findUniqueOrThrow({ where: { id } });
const revoked = (before: PortalSession, now: Date) => ({
  ...before,
  revokedAt: now,
  updatedAt: now,
  revokeReason: "membership_changed",
});

describe("下载页精准吊销（W2-10 PR1）", () => {
  it("entity 范围包含不同授权人与已过期行，仅动 A；旧撤销证据完整保留", async () => {
    const f = await fixtures();
    clock.advance(1_337);
    const now = clock.now();
    const count = await tx.run(async (handle) => {
      await lockCaller(handle, f.a.entity.id, [f.a.owner.id]);
      return grants.revokePortalGrants(handle, { scope: "entity", entityId: f.a.entity.id, now });
    });
    expect(count).toBe(3);
    for (const before of [f.aCurrent, f.aExpired, f.aOther])
      expect(await row(before.id)).toEqual(revoked(before, now));
    expect(await row(f.bSameUser.id)).toEqual(f.bSameUser);
    expect(await row(f.alreadyRevoked.id)).toEqual(f.alreadyRevoked);
  });

  it("owner 范围同时筛主体与原授权人，另一授权人和 B 的同账号授权均不变", async () => {
    const f = await fixtures();
    const now = clock.now();
    const count = await tx.run(async (handle) => {
      await lockCaller(handle, f.a.entity.id, [f.a.owner.id]);
      return grants.revokePortalGrants(handle, {
        scope: "owner",
        entityId: f.a.entity.id,
        merchantUserId: f.a.user.id,
        now,
      });
    });
    expect(count).toBe(2);
    for (const before of [f.aCurrent, f.aExpired])
      expect(await row(before.id)).toEqual(revoked(before, now));
    for (const before of [f.aOther, f.bSameUser, f.alreadyRevoked])
      expect(await row(before.id)).toEqual(before);
  });

  it("重复及无匹配返回真实 0；后来的 now 不覆盖首次撤销原因/时间", async () => {
    const f = await fixtures();
    const input: PortalGrantRevocation = {
      scope: "owner",
      entityId: f.a.entity.id,
      merchantUserId: f.a.user.id,
      now: clock.now(),
    };
    const invoke = (args: PortalGrantRevocation) =>
      tx.run(async (handle) => {
        await lockCaller(handle, f.a.entity.id, [f.a.owner.id]);
        return grants.revokePortalGrants(handle, args);
      });
    expect(await invoke(input)).toBe(2);
    const before = await snapshotTables(prisma, ["portal_session"]);
    clock.advance(HOUR);
    expect(await invoke({ ...input, now: clock.now() })).toBe(0);
    expect(await invoke({ ...input, merchantUserId: f.b.user.id, now: clock.now() })).toBe(0);
    assertSnapshotsEqual(before, await snapshotTables(prisma, ["portal_session"]));
  });

  it("调用方原事务回滚，撤销时间、原因与更新时刻全部回滚", async () => {
    const f = await fixtures();
    const before = await snapshotTables(prisma, ["portal_session"]);
    const rollback = new Error("W210 caller rollback");
    await expect(
      tx.run(async (handle) => {
        await lockCaller(handle, f.a.entity.id, [f.a.owner.id]);
        expect(
          await grants.revokePortalGrants(handle, {
            scope: "entity",
            entityId: f.a.entity.id,
            now: clock.now(),
          }),
        ).toBe(3);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    assertSnapshotsEqual(before, await snapshotTables(prisma, ["portal_session"]));
  });

  it("精准吊销不改真实 user_session、微信身份、成员或 portal_ticket fixture", async () => {
    const f = await fixtures();
    const now = clock.now();
    const wechat = await prisma.wechatIdentity.create({
      data: {
        id: uuidv7(),
        merchantUserId: f.a.user.id,
        appid: "wx_w210_fixture",
        openid: uuidv7(),
        createdAt: now,
        updatedAt: now,
        lastActiveAt: now,
        lastLoginAt: now,
      },
    });
    await prisma.userSession.create({
      data: {
        id: uuidv7(),
        merchantUserId: f.a.user.id,
        wechatIdentityId: wechat.id,
        tokenHash: createHash("sha256").update(wechat.id).digest(),
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + 30 * 24 * HOUR),
        absoluteExpiresAt: new Date(now.getTime() + 90 * 24 * HOUR),
        lastIp: "198.51.100.10",
      },
    });
    await prisma.portalTicket.create({
      data: {
        id: uuidv7(),
        publicId: Buffer.alloc(16, 0x21).toString("base64url"),
        shortCode: "0123ABCD",
        pollSecretHash: Buffer.alloc(32, 0x22),
        pairDigits: "12",
        status: "pending",
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 120_000),
        ip: "198.51.100.10",
        userAgent: "W210 table fixture",
      },
    });
    const tables = [
      "user_session",
      "wechat_identity",
      "merchant_user",
      "entity_member",
      "store_member",
      "portal_ticket",
    ];
    const before = await snapshotTables(prisma, tables);
    await tx.run(async (handle) => {
      await lockCaller(handle, f.a.entity.id, [f.a.owner.id]);
      expect(
        await grants.revokePortalGrants(handle, {
          scope: "owner",
          entityId: f.a.entity.id,
          merchantUserId: f.a.user.id,
          now,
        }),
      ).toBe(2);
    });
    assertSnapshotsEqual(before, await snapshotTables(prisma, tables));
  });

  it(
    "独立两连接重复 12 轮：真实持 entity/member 锁，count 总和等于实际匹配行",
    async () => {
      expect(
        await Promise.all(
          clients.map(
            (client) => client.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`,
          ),
        ).then((pids) => new Set(pids.flat().map(({ pid }) => pid)).size),
      ).toBe(2);
      for (let round = 0; round < ROUNDS; round += 1) {
        const f = await fixtures();
        const input: PortalGrantRevocation =
          round % 2 === 0
            ? { scope: "entity", entityId: f.a.entity.id, now: clock.now() }
            : {
                scope: "owner",
                entityId: f.a.entity.id,
                merchantUserId: f.a.user.id,
                now: clock.now(),
              };
        let arrived = 0;
        let release!: () => void;
        const ready = new Promise<void>((resolve) => (release = resolve));
        const counts = await Promise.all(
          runners.map((runner) =>
            runner.run(async (handle) => {
              // 两边已各开真实事务才放行，不靠 sleep 或数据库时钟碰巧重叠。
              arrived += 1;
              if (arrived === 2) release();
              await ready;
              await lockCaller(handle, f.a.entity.id, [f.a.owner.id]);
              return grants.revokePortalGrants(handle, input);
            }),
          ),
        );
        const expected = input.scope === "entity" ? 3 : 2;
        expect(
          counts.toSorted((a, b) => a - b),
          `round ${round}`,
        ).toEqual([0, expected]);
        expect(
          await prisma.portalSession.count({
            where: {
              entityId: f.a.entity.id,
              revokeReason: "membership_changed",
              revokedAt: input.now,
            },
          }),
        ).toBe(expected);
        expect(await row(f.bSameUser.id)).toEqual(f.bSameUser);
        expect(await row(f.alreadyRevoked.id)).toEqual(f.alreadyRevoked);
        expect(await row(f.aOther.id)).toEqual(
          input.scope === "entity" ? revoked(f.aOther, input.now) : f.aOther,
        );
      }
    },
    SLOW,
  );
});
