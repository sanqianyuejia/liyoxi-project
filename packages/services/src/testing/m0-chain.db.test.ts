import { describe, expect, it } from "vitest";

import { createIdentityContext } from "../kernel/index.js";
import {
  createFactories,
  createM0Chain,
  M0_CHAIN,
  runM0Chain,
  useSeededDatabase,
  useTestRedis,
} from "./index.js";

// W0-30 验收 1：M0 的样例链路贯通（计划 第 6.3 节“退出：演示”）。
// 写请求重放返回同一结果；状态历史、审计、出站事件各一条；订阅者与定时器各执行一次；全量不变量 0 违规。
// pnpm demo:m0 走的是同一个 runM0Chain，只是库与 Redis 前缀由脚本自己建。

/** 连库、连 Redis 的用例的时限：机器忙的时候建库、等队列都慢 */
const SLOW = 240_000;

const db = useSeededDatabase("services");
const redis = useTestRedis();

const redisUrl = (): string => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL 未设置");
  return url;
};

describe("M0 样例链路", () => {
  it(
    "从写用例走到全量不变量：各表各一条、处理器各一次、重放不再执行",
    async () => {
      await redis.flush();
      const prisma = await db.prisma();
      const steps: string[] = [];
      const report = await runM0Chain({
        prisma,
        redisUrl: redisUrl(),
        redisPrefix: redis.prefix,
        // 定时器晚 1 秒到点：用例真等它（扫描按库时间判到没到点，拨业务时钟没有用）
        timerDelayMs: 1_000,
        say: (title) => void steps.push(title),
      });
      expect(report.first).toMatchObject({
        staffId: report.staffId,
        from: "active",
        to: "disabled",
      });
      expect(report.replay).toEqual(report.first);
      expect(report.replayed).toBe(true);
      expect(report.executions).toBe(1);
      expect(report.rows).toEqual({ history: 1, audit: 1, events: 1 });
      expect(report.runs).toEqual({ subscriber: 1, timer: 1 });
      expect([report.deliveryStatus, report.timerStatus]).toEqual(["done", "fired"]);
      expect(report.invariants).toMatchObject({ status: "succeeded", violationsFound: 0 });
      expect(report.invariants.checksRun).toBeGreaterThan(0);
      expect(steps).toHaveLength(7);

      // 库里的行与返回值对得上：历史、审计、事件、定时器都是这一次写下的
      const history = await prisma.statusTransition.findUniqueOrThrow({
        where: { id: report.first.transitionId },
      });
      expect(history).toMatchObject({
        subjectId: report.staffId,
        fromState: "active",
        toState: "disabled",
        event: "staff.disable",
      });
      const event = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: report.first.eventId ?? "" },
      });
      expect(event).toMatchObject({
        eventType: M0_CHAIN.event,
        aggregateType: "staff",
        aggregateId: report.staffId,
        payload: { v: 1, fromState: "active", toState: "disabled", transition: "staff.disable" },
      });
      const audit = await prisma.auditLog.findUniqueOrThrow({
        where: { id: report.first.auditId ?? "" },
      });
      expect(audit).toMatchObject({ targetType: "staff", targetId: report.staffId, stream: "ops" });
    },
    SLOW,
  );

  it(
    "同一个幂等键换了入参：拒绝，不执行；已停用的员工再停用：409，四处都不留痕",
    async () => {
      const prisma = await db.prisma();
      const chain = createM0Chain({
        prisma,
        channel: { enqueue: () => Promise.reject(new Error("本例不入队")), downForMs: () => 0 },
      });
      const make = createFactories({ db: prisma, clock: chain.clock });
      const [first, second] = [await make.staff(), await make.staff()];
      const ctx = createIdentityContext({
        actor: { type: "staff", id: first.id, client: "admin" },
        requestId: "req-m0-0002",
      });
      const key = `m0-case-${first.id}`;
      await chain.disableStaff(ctx, chain.idemFor(ctx, key, { staffId: first.id }), {
        staffId: first.id,
      });

      const rows = () =>
        Promise.all([
          prisma.statusTransition.count(),
          prisma.auditLog.count(),
          prisma.outboxEvent.count(),
          prisma.timer.count(),
        ]);
      const before = await rows();
      // 同键、入参不同：请求哈希对不上
      await expect(
        chain.disableStaff(ctx, chain.idemFor(ctx, key, { staffId: second.id }), {
          staffId: second.id,
        }),
      ).rejects.toMatchObject({ error: "IDEMPOTENCY_KEY_REUSED" });
      // 新键、对象已经停用：迁移表里没有这一行
      await expect(
        chain.disableStaff(ctx, chain.idemFor(ctx, `${key}-b`, { staffId: first.id }), {
          staffId: first.id,
        }),
      ).rejects.toMatchObject({ error: "STATE_NOT_ALLOWED" });
      expect(await rows()).toEqual(before);
      expect(chain.executions()).toBe(2);
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
        "active",
      );
    },
    SLOW,
  );
});
