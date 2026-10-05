import { fileURLToPath } from "node:url";

import { Redis } from "ioredis";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
  CallInterruptedError,
  createCallInterrupter,
  createRedisOutage,
  crashPoint,
  deliverRepeatedly,
  runUntilCrash,
} from "./fault/index.js";
import {
  connectTestDatabase,
  createFakeProviders,
  disconnectTestRedis,
  useTestDatabase,
  useTestRedis,
} from "./index.js";

// 连库、连 Redis、起子进程的用例：实例忙的时候（别的会话同时在跑）会慢，时限放宽，不用缺省的 5 秒
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// 四种故障注入工具的自测（W0-05b 任务书 第 7 节第 8 条）。只验工具本身，不拿它们去压内核。

const db = useTestDatabase("services");
const redis = useTestRedis();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("重复投递", () => {
  const message = { id: "evt-1", payload: { amountFen: 100 } };
  const N = 6;

  /** 记下同时在处理的个数的峰值 */
  function tracker() {
    const state = { active: 0, peak: 0, received: [] as Array<typeof message>, release: () => {} };
    const allIn = new Promise<void>((resolve) => (state.release = resolve));
    return { state, allIn };
  }

  it("同一消息串行投 N 次：上一次处理完才投下一次", async () => {
    const { state } = tracker();
    const outcome = await deliverRepeatedly(
      async (received, attempt) => {
        state.active += 1;
        state.peak = Math.max(state.peak, state.active);
        state.received.push(received);
        await sleep(3);
        state.active -= 1;
        return attempt;
      },
      message,
      { times: N, mode: "serial" },
    );
    expect(outcome.fulfilled).toEqual([1, 2, 3, 4, 5, 6]);
    expect(outcome.rejected).toEqual([]);
    expect(state.peak).toBe(1);
    // 每次收到的内容相同，但各是各的一份
    expect(state.received).toHaveLength(N);
    for (const received of state.received) {
      expect(received).toEqual(message);
      expect(received).not.toBe(message);
    }
    expect(new Set(state.received).size).toBe(N);
  });

  it("同一消息并发投 N 次：N 次同时在处理", async () => {
    const { state, allIn } = tracker();
    const outcome = await deliverRepeatedly(
      async (received, attempt) => {
        state.active += 1;
        state.peak = Math.max(state.peak, state.active);
        state.received.push(received);
        // 等 N 次都进来了才往下走：进不齐就会卡到用例超时
        if (state.active === N) state.release();
        await allIn;
        return attempt;
      },
      message,
      { times: N, mode: "concurrent" },
    );
    expect(outcome.fulfilled).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state.peak).toBe(N);
    expect(new Set(state.received).size).toBe(N);
  });

  it("处理函数抛错、改入参：不打断后面的投递，错记在结果里，原消息不变", async () => {
    for (const mode of ["serial", "concurrent"] as const) {
      const outcome = await deliverRepeatedly(
        (received, attempt) => {
          received.payload.amountFen += attempt;
          if (attempt === 2) throw new Error("同步抛的错");
          if (attempt === 3) return Promise.reject(new Error("被拒的 Promise"));
          return received.payload.amountFen;
        },
        message,
        { times: 4, mode },
      );
      expect(outcome.results.map((result) => result.status)).toEqual([
        "fulfilled",
        "rejected",
        "rejected",
        "fulfilled",
      ]);
      expect(outcome.fulfilled).toEqual([101, 104]);
      expect(outcome.rejected.map(String)).toEqual(["Error: 同步抛的错", "Error: 被拒的 Promise"]);
    }
    expect(message).toEqual({ id: "evt-1", payload: { amountFen: 100 } });
  });

  it("拿它验一个去重的处理函数：串行、并发各投 N 次，都只生效一次", async () => {
    const client = await redis.client();
    for (const mode of ["serial", "concurrent"] as const) {
      let applied = 0;
      const outcome = await deliverRepeatedly(
        async (received) => {
          const first = await client.set(`dedupe:${mode}:${received.id}`, "1", "NX");
          if (first !== "OK") return "duplicate";
          applied += 1;
          return "applied";
        },
        message,
        { times: N, mode },
      );
      expect(applied).toBe(1);
      expect(outcome.fulfilled.filter((result) => result === "applied")).toHaveLength(1);
      expect(outcome.fulfilled.filter((result) => result === "duplicate")).toHaveLength(N - 1);
    }
  });

  it("参数写错即抛错", async () => {
    const handler = () => 1;
    await expect(deliverRepeatedly(handler, message, { times: 0, mode: "serial" })).rejects.toThrow(
      RangeError,
    );
    await expect(
      deliverRepeatedly(handler, message, { times: 2, mode: "random" as "serial" }),
    ).rejects.toThrow(RangeError);
  });
});

describe("进程中断", () => {
  const SCENARIO = fileURLToPath(new URL("./__fixtures__/crash-scenario.ts", import.meta.url));

  it(
    "子进程在未提交的断点被杀：事务已回滚；在提交之后的断点被杀：数据还在",
    { timeout: 90_000 },
    async () => {
      const databaseUrl = await db.url();
      const prisma = await db.prisma();
      // 看别的会话处在什么状态，要 DATABASE_URL 的账号（role: null 不切角色）：缺省的应用角色 lyx_app
      // 在 pg_stat_activity 里看得到别人的会话，但 state 一列是空的。子进程与下面数行数的连接仍是应用角色
      const monitor = await connectTestDatabase(db.name, { role: null });
      onTestFinished(() => monitor.end());
      const openTransactions = async () => {
        const result = await monitor.query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity
            where datname = current_database() and pid <> pg_backend_pid()
              and state = 'idle in transaction' and backend_xid is not null`,
        );
        return result.rows[0]?.n ?? -1;
      };
      expect(await prisma.authEvent.count()).toBe(0);

      // 一、断在“写了、还没提交”
      let seenAtBreakpoint = { open: -1, visible: -1 };
      const uncommitted = await runUntilCrash({
        module: SCENARIO,
        payload: { databaseUrl },
        crashAt: "written",
        // 子进程停在断点上的那一刻：它的事务开着、已经写了数据；别的连接看不到那一行
        onReach: async () => {
          seenAtBreakpoint = {
            open: await openTransactions(),
            visible: await prisma.authEvent.count(),
          };
        },
      });
      expect(uncommitted).toMatchObject({
        killed: true,
        signal: "SIGKILL",
        exitCode: null,
        reached: ["written"],
      });
      expect(seenAtBreakpoint).toEqual({ open: 1, visible: 0 });
      // 数据库发现连接断了，回滚那条事务
      await vi.waitFor(async () => expect(await openTransactions()).toBe(0), {
        timeout: 15_000,
        interval: 50,
      });
      expect(await prisma.authEvent.count()).toBe(0);

      // 二、断在“提交之后”
      const committed = await runUntilCrash({
        module: SCENARIO,
        payload: { databaseUrl },
        crashAt: "committed",
      });
      expect(committed).toMatchObject({
        killed: true,
        signal: "SIGKILL",
        reached: ["written", "committed"],
      });
      expect(await prisma.authEvent.count()).toBe(1);

      // 三、指定的断点场景里没有：子进程自己跑完，不算被杀
      const finished = await runUntilCrash({
        module: SCENARIO,
        payload: { databaseUrl },
        crashAt: "场景里没有的断点",
      });
      expect(finished).toMatchObject({
        killed: false,
        signal: null,
        exitCode: 0,
        reached: ["written", "committed"],
      });
      expect(await prisma.authEvent.count()).toBe(2);
    },
  );

  it("场景抛错：子进程以退出码 1 结束，输出里有报错", { timeout: 120_000 }, async () => {
    const result = await runUntilCrash({
      module: SCENARIO,
      exportName: "failing",
      crashAt: "到不了",
    });
    expect(result).toMatchObject({ killed: false, exitCode: 1, reached: ["before-throw"] });
    expect(result.output).toContain("场景自己出错了");

    const missing = await runUntilCrash({
      module: SCENARIO,
      exportName: "没有这个导出",
      crashAt: "x",
    });
    expect(missing.exitCode).toBe(1);
    expect(missing.output).toContain("场景模块没有导出函数 没有这个导出");
  });

  it("子进程迟迟不结束：到点杀掉并报错", { timeout: 120_000 }, async () => {
    // 报错里带它到过的断点；这里不核对那一段：机器忙的时候子进程可能还没跑到第一个断点
    await expect(
      runUntilCrash({
        module: SCENARIO,
        exportName: "hanging",
        crashAt: "到不了",
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/子进程 5000 毫秒内没有结束，已杀掉。到过的断点：/);
  });

  it("不在 runUntilCrash 起的子进程里：crashPoint 什么都不做", async () => {
    await expect(crashPoint("written")).resolves.toBeUndefined();
  });
});

describe("Redis 不可用", () => {
  it(
    "打开开关后命令报连接错，关掉后恢复；共享的那份 Redis 没停",
    { timeout: 120_000 },
    async () => {
      const direct = await redis.client();
      const outage = await createRedisOutage();
      const through = new Redis(outage.url, {
        keyPrefix: redis.prefix,
        maxRetriesPerRequest: 1,
        retryStrategy: () => 50,
      });
      through.on("error", () => {});
      try {
        expect(outage.url).not.toBe(process.env.REDIS_URL);
        await through.set("outage:probe", "断之前");
        expect(await direct.get("outage:probe")).toBe("断之前");

        await outage.down();
        expect(outage.isDown).toBe(true);
        await expect(through.get("outage:probe")).rejects.toThrow(
          /max retries per request|Connection is closed|ECONNREFUSED/i,
        );
        await expect(through.set("outage:probe", "断着的时候")).rejects.toThrow();
        expect(through.status).not.toBe("ready");
        // 断着的时候新开的连接同样连不上
        const late = new Redis(outage.url, { lazyConnect: true, retryStrategy: () => null });
        late.on("error", () => {});
        await expect(late.connect()).rejects.toThrow();
        // 共享的那份没停：直连的照常读写，断着的时候那次写入没有到达
        expect(await direct.ping()).toBe("PONG");
        expect(await direct.get("outage:probe")).toBe("断之前");

        await outage.up();
        expect(outage.isDown).toBe(false);
        await vi.waitFor(async () => expect(await through.get("outage:probe")).toBe("断之前"), {
          timeout: 15_000,
          interval: 50,
        });
        await through.set("outage:probe", "恢复之后");
        expect(await direct.get("outage:probe")).toBe("恢复之后");
      } finally {
        await disconnectTestRedis(through);
        await outage.close();
      }
    },
  );

  it("只转发不加密的 redis:// 连接；没有 REDIS_URL 即报错", async () => {
    await expect(createRedisOutage("rediss://localhost:6380/0")).rejects.toThrow(/不加密/);
    vi.stubEnv("REDIS_URL", "");
    try {
      await expect(createRedisOutage()).rejects.toThrow(/REDIS_URL 未设置/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("外部调用前、中、后中断", () => {
  /** 一个假的外部服务：记下收到了什么、处理完了什么；可以让它卡在处理当中 */
  function externalService() {
    const log: string[] = [];
    let release = () => {};
    let gate: Promise<void> = Promise.resolve();
    return {
      log,
      hold() {
        gate = new Promise<void>((resolve) => (release = resolve));
      },
      release: () => release(),
      async charge(orderNo: string) {
        log.push(`收到 ${orderNo}`);
        await gate;
        log.push(`处理完 ${orderNo}`);
        return { orderNo, status: "SUCCESS" };
      },
    };
  }

  it("没布置中断：原样执行", async () => {
    const service = externalService();
    const interrupter = createCallInterrupter();
    expect(await interrupter.call(() => service.charge("A"))).toEqual({
      orderNo: "A",
      status: "SUCCESS",
    });
    expect(interrupter.fired).toEqual([]);
  });

  it("三个断点各触发一次：之前没发出去，当中发了没等到应答，之后应答回来了没用上", async () => {
    const service = externalService();
    const interrupter = createCallInterrupter();
    const charge = interrupter.wrap(service.charge);
    const interrupted = (call: Promise<unknown>) =>
      call.then(
        () => {
          throw new Error("应当被中断");
        },
        (error: unknown) => {
          if (!(error instanceof CallInterruptedError)) throw error;
          return error;
        },
      );

    // 之前：外部一侧什么都没收到
    interrupter.arm("before");
    const before = await interrupted(charge("A"));
    expect(before.point).toBe("before");
    expect(service.log).toEqual([]);

    // 当中：调用方已经拿到错，外部一侧还在处理；放行之后它照常处理完
    service.hold();
    interrupter.arm("during");
    const during = await interrupted(charge("B"));
    expect(during.point).toBe("during");
    expect(during.result).toBeUndefined();
    await sleep(5);
    expect(service.log).toEqual(["收到 B"]);
    service.release();
    await interrupter.inFlight();
    expect(service.log).toEqual(["收到 B", "处理完 B"]);

    // 之后：外部一侧处理完了，应答挂在错误上
    interrupter.arm("after");
    const after = await interrupted(charge("C"));
    expect(after.point).toBe("after");
    expect(after.result).toEqual({ orderNo: "C", status: "SUCCESS" });
    expect(service.log).toEqual(["收到 B", "处理完 B", "收到 C", "处理完 C"]);

    // 三个断点各一次，都用掉了；下一次调用照常
    expect(interrupter.fired).toEqual(["before", "during", "after"]);
    expect(interrupter.pending()).toBe(0);
    expect(await charge("D")).toEqual({ orderNo: "D", status: "SUCCESS" });
  });

  it("可以连着布置几个、一个布置多次，按先后用掉", async () => {
    const interrupter = createCallInterrupter();
    interrupter.arm("after", { times: 2 });
    interrupter.arm("before");
    expect(interrupter.pending()).toBe(3);
    const points: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      await interrupter
        .call(() => index)
        .then(
          () => points.push("ok"),
          (error: CallInterruptedError) => points.push(error.point),
        );
    }
    expect(points).toEqual(["after", "after", "before", "ok"]);
    expect(() => interrupter.arm("sometime" as "before")).toThrow(RangeError);
    expect(() => interrupter.arm("before", { times: 0 })).toThrow(RangeError);
  });

  it("外部调用自己失败：没布置中断时原样抛出；during 中断时不冒出未处理的错", async () => {
    const interrupter = createCallInterrupter();
    const boom = () => Promise.reject(new Error("外部服务报错"));
    await expect(interrupter.call(boom)).rejects.toThrow("外部服务报错");
    interrupter.arm("during");
    await expect(interrupter.call(boom)).rejects.toBeInstanceOf(CallInterruptedError);
    await interrupter.inFlight();
    interrupter.arm("after");
    // after：外部调用自己就失败了，没有应答可言，抛的是外部的错
    await expect(interrupter.call(boom)).rejects.toThrow("外部服务报错");
  });

  it("与 Provider 替身搭着用：断在当中时，替身一侧已经收到这次调用", async () => {
    const fakes = createFakeProviders();
    const interrupter = createCallInterrupter();
    const send = interrupter.wrap((phone: string) =>
      fakes.sms.sendActivationCode({ phone, code: "123456" }),
    );
    interrupter.arm("during");
    await expect(send("13800000000")).rejects.toBeInstanceOf(CallInterruptedError);
    await interrupter.inFlight();
    expect(fakes.sms.callsOf("sendActivationCode")).toHaveLength(1);
  });
});
