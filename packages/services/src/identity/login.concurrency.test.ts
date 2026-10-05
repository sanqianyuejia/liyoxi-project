// 登录的两条并发用例（任务书 W1-04 第 7 节验收 2、3；甲类的并发测试）。连真库，独立的连接并行。
//   首次登录并发：同一手机号两条连接同时首次登录，重复 20 轮：账号 1 行、身份行不重、每份协议的同意记录 1 行、
//                 两边都拿到令牌。偶数轮两边是同一个微信（同一台设备连点两下），奇数轮是两个微信（两台设备）。
//   会话上限并发：同一身份并发登录 8 次后未吊销会话恰好 5 条，被挤掉的是最旧的。
// 对齐不靠睡：建号那一步放了栅栏，两边都看到“没有这个账号”之后才一起插入（INSERT … ON CONFLICT DO NOTHING），
// 后到的一方卡在唯一索引上等先到的提交；会话上限靠账号行与微信身份行的行锁排队。两边的 lock_timeout 放得很宽，机器忙时不把“等得久”当成失败。
import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { phoneBidx } from "../security/index.js";
import { useSeededDatabase } from "../testing/index.js";
import {
  barrier,
  buildHarness,
  keyring,
  META,
  nextOpenid,
  nextPhone,
  openClient,
  TEST_APPID,
} from "./__fixtures__/harness.js";
import type { Harness, Stack } from "./__fixtures__/harness.js";
import { findI25Violations, MAX_SESSIONS_PER_IDENTITY, parseToken } from "./index.js";

const ROUNDS = 20;
const PARALLEL = 8;
const SLOW = 300_000;
const WAIT = { lockTimeoutMs: 60_000 };

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let clients: PrismaClient[] = [];
let h: Harness;
let left: Stack;
let right: Stack;
let wide: Stack;

beforeAll(async () => {
  prisma = await db.prisma();
  h = await buildHarness(prisma);
  clients = await Promise.all([
    openClient(db, WAIT),
    openClient(db, WAIT),
    openClient(db, { ...WAIT, max: PARALLEL }),
  ]);
  [left, right, wide] = clients.map((client) => h.stackOn(client)) as [Stack, Stack, Stack];
}, SLOW);

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
});

describe("登录：并发", () => {
  it(
    `同一手机号两条连接同时首次登录 ${ROUNDS} 轮：账号 1 行、身份行不重、同意记录每份 1 行、两边都拿到令牌`,
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const label = `第 ${round + 1} 轮`;
        const phone = nextPhone();
        const openids = round % 2 === 0 ? [nextOpenid()] : [nextOpenid(), nextOpenid()];
        const input = (openid: string) => ({
          ...h.codes({ openid, phone }),
          consents: h.consents(),
        });
        // 栅栏：两边都在自己的事务里看到“没有这个账号”之后才一起去插入，每一轮都真的撞在唯一索引上
        let arrived = 0;
        const together = barrier(2);
        h.onNewAccount = () => {
          arrived += 1;
          return together();
        };
        const [a, b] = await Promise.all([
          left.identity.phoneLogin(META, input(openids[0] as string)),
          right.identity.phoneLogin(META, input(openids.at(-1) as string)),
        ]).finally(() => {
          h.onNewAccount = undefined;
        });
        expect(arrived, label).toBe(2);

        const users = await prisma.merchantUser.findMany({
          where: { phoneBidx: phoneBidx(keyring, phone) },
        });
        expect(users, label).toHaveLength(1);
        const userId = users[0]?.id as string;
        expect([a.me.user.merchantUserId, b.me.user.merchantUserId], label).toEqual([
          userId,
          userId,
        ]);
        // 只有一边是“新用户”；注册的状态历史与事件各一条
        expect([a.isNewUser, b.isNewUser].filter(Boolean), label).toHaveLength(1);
        expect(await prisma.statusTransition.count({ where: { subjectId: userId } }), label).toBe(
          1,
        );
        expect(
          await prisma.outboxEvent.count({
            where: { aggregateId: userId, eventType: "merchant_user.registered" },
          }),
          label,
        ).toBe(1);

        const identities = await prisma.wechatIdentity.findMany({
          where: { appid: TEST_APPID, openid: { in: openids } },
        });
        expect(identities.map((row) => row.openid).sort(), label).toEqual([...openids].sort());
        expect(new Set(identities.map((row) => row.merchantUserId)), label).toEqual(
          new Set([userId]),
        );

        const consents = await prisma.agreementConsent.findMany({
          where: { merchantUserId: userId },
        });
        expect(consents.map((row) => row.agreementKey).sort(), label).toEqual(["privacy", "user"]);

        // 两枚令牌不同，各对一条有效的会话
        expect(a.token, label).not.toBe(b.token);
        for (const token of [a.token, b.token]) {
          expect(await h.identity.authenticate(token, { ip: null }), label).toMatchObject({
            ok: true,
            principal: { merchantUserId: userId },
          });
        }
      }
    },
    SLOW,
  );

  it(
    `同一身份并发登录 ${PARALLEL} 次：未吊销的会话恰好 ${MAX_SESSIONS_PER_IDENTITY} 条，被挤掉的是最旧的`,
    async () => {
      const phone = nextPhone();
      const openid = nextOpenid();
      const first = await h.identity.phoneLogin(META, {
        ...h.codes({ openid, phone }),
        consents: h.consents(),
      });
      const userId = first.me.user.merchantUserId;
      h.clock.advance(60_000);

      const results = await Promise.all(
        Array.from({ length: PARALLEL }, () =>
          wide.identity.silentLogin(META, { loginCode: h.codes({ openid, phone }).loginCode }),
        ),
      );
      expect(results.every((result) => result.needPhone === false && result.token !== null)).toBe(
        true,
      );

      const sessions = await prisma.userSession.findMany({
        where: { merchantUserId: userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      expect(sessions).toHaveLength(PARALLEL + 1);
      const live = sessions.filter((row) => row.revokedAt === null);
      const gone = sessions.filter((row) => row.revokedAt !== null);
      expect(live).toHaveLength(MAX_SESSIONS_PER_IDENTITY);
      expect(gone.map((row) => row.revokeReason)).toEqual(
        Array.from({ length: PARALLEL + 1 - MAX_SESSIONS_PER_IDENTITY }, () => "evicted"),
      );
      // 最旧的在前：被挤掉的正是前 4 条（手机号登录的那一条最旧），留下的是最新的 5 条
      expect(gone.map((row) => row.id)).toEqual(
        sessions.slice(0, PARALLEL + 1 - MAX_SESSIONS_PER_IDENTITY).map((row) => row.id),
      );
      expect(gone[0]?.id).toBe(parseToken(first.token)?.sessionId);
      // 每个调用拿到的令牌要么仍有效、要么已被后来的登录挤掉；有效的恰好是留下的那 5 条
      const states = await Promise.all(
        results.map((result) => h.identity.authenticate(result.token as string, { ip: null })),
      );
      expect(states.filter((state) => state.ok)).toHaveLength(MAX_SESSIONS_PER_IDENTITY);
      expect(await findI25Violations(prisma)).toEqual([]);
    },
    SLOW,
  );
});
