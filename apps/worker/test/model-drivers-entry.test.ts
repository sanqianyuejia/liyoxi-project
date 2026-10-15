import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as PublicServices from "@liyoxi/services";
import type { Env, WorkerServicesOptions } from "@liyoxi/services";

const ports = vi.hoisted(() => {
  const state = {
    clients: [] as Array<{
      status: string;
      quit: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }>,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    database: { prisma: {}, close: vi.fn<() => Promise<void>>() },
    channel: { close: vi.fn<() => Promise<void>>() },
    lease: { holder: "public-worker-fixture", close: vi.fn<() => Promise<void>>() },
    runtime: { start: vi.fn(), stop: vi.fn<() => Promise<void>>() },
    env: vi.fn<() => Env>(),
    assemble: vi.fn(() => ({ modules: [], subscribers: [], timerHandlers: [] })),
    build: vi.fn((_options: WorkerServicesOptions): Record<string, unknown> => ({})),
    createRuntime: vi.fn((_options: unknown): unknown => ({})),
    asrClose: vi.fn<() => Promise<void>>(),
    llmClose: vi.fn<() => Promise<void>>(),
  };
  class Redis {
    status = "wait";
    connect = vi.fn(async () => undefined);
    eval = vi.fn(async () => []);
    quit = vi.fn(async () => "OK");
    disconnect = vi.fn(() => {
      this.status = "end";
    });
    on = vi.fn(() => this);
    constructor(_url: string, _options: unknown) {
      state.clients.push(this);
    }
  }
  return {
    ...state,
    Redis,
    connect: vi.fn((_url: string) => state.database),
    queue: vi.fn((_options: unknown) => state.channel),
    createLease: vi.fn((_options: unknown) => state.lease),
  };
});
vi.mock("ioredis", () => ({ Redis: ports.Redis }));
vi.mock("@liyoxi/services", () => ({
  loadEnv: ports.env,
  assembleServices: ports.assemble,
  connectWorkerDatabase: ports.connect,
  createQueueChannel: ports.queue,
  createWorkerLease: ports.createLease,
  buildWorkerServices: ports.build,
  bullPrefix: () => "lyx:test:bull",
  setPortLogger: vi.fn(),
  EnvError: class EnvError extends Error {},
}));
vi.mock("../src/log.js", () => ({ createLogger: () => ports.logger }));
vi.mock("../src/recurring.js", () => ({ recurringTable: () => [] }));
vi.mock("../src/runtime.js", () => ({ createWorkerRuntime: ports.createRuntime }));
import { main } from "../src/index.js";

const asr: NonNullable<Env["ASR_TENCENT"]> = {
  secretId: "public_fake_asr_id",
  secretKey: "public-fake-asr-secret",
};
const endpoint = { vendor: "ark", model: "public-model", apiKey: "public-fake-api-key" } as const;
const llm: NonNullable<Env["LLM_DOMESTIC"]> = {
  text: { primary: endpoint, backup: endpoint },
  vision: { primary: endpoint, backup: endpoint },
};
const configurations = [
  { name: "none", asr: false, llm: false },
  { name: "asr", asr: true, llm: false },
  { name: "llm", asr: false, llm: true },
  { name: "both", asr: true, llm: true },
] as const;
let services: Record<string, ReturnType<typeof vi.fn<() => Promise<void>>> | null>;
let signals: Map<string, () => void>;
let exit: ReturnType<typeof vi.fn<typeof process.exit>>;
let actual: typeof PublicServices;

// 冷模块编译属于准备阶段，真实入口守卫的用例仍使用原默认 5 秒期限。
beforeAll(async () => {
  actual = await vi.importActual<typeof PublicServices>("@liyoxi/services");
}, 60_000);

function configured(hasAsr = true, hasLlm = true): Env {
  return {
    APP_ENV: "test",
    LOG_LEVEL: "error",
    DATABASE_URL: "postgresql://public-fixture",
    REDIS_URL: "redis://public-fixture",
    ...(hasAsr ? { ASR_TENCENT: asr } : {}),
    ...(hasLlm ? { LLM_DOMESTIC: llm } : {}),
  };
}
function lifecycle() {
  return ports.build.mock.calls.at(-1)![0].modelDrivers!;
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function shutdown() {
  signals.get("SIGTERM")!();
}
async function exited(code: number) {
  await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(code));
}
function infrastructureClosed() {
  expect(ports.database.close).toHaveBeenCalledOnce();
  expect(ports.channel.close).toHaveBeenCalledOnce();
  expect(ports.clients[0]!.disconnect).toHaveBeenCalledOnce();
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  ports.clients.length = 0;
  ports.env.mockReturnValue(configured());
  ports.assemble.mockReturnValue({ modules: [], subscribers: [], timerHandlers: [] });
  ports.connect.mockReturnValue(ports.database);
  ports.queue.mockReturnValue(ports.channel);
  ports.createLease.mockReturnValue(ports.lease);
  for (const close of [
    ports.database.close,
    ports.channel.close,
    ports.lease.close,
    ports.asrClose,
    ports.llmClose,
  ])
    close.mockResolvedValue(undefined);
  services = { documentConverter: null };
  for (const name of [
    "selfCheck",
    "disableModelBudget",
    "shutdownMediaJobs",
    "closeDocs",
    "closeApproval",
    "closeInvitations",
    "closeMediaJobs",
    "closeMediaDrivers",
    "closeStorageDrivers",
    "closeModelBudget",
    "closeAlertFacts",
  ])
    services[name] = vi.fn(async () => undefined);
  services.closeModelDrivers = vi.fn(() => lifecycle().close());
  ports.build.mockImplementation((options) => {
    if (options.keys?.ASR_TENCENT) options.modelDrivers!.registerClose(ports.asrClose);
    if (options.keys?.LLM_DOMESTIC) options.modelDrivers!.registerClose(ports.llmClose);
    return services;
  });
  ports.createRuntime.mockReturnValue(ports.runtime);
  ports.runtime.stop.mockImplementation(async () => {
    await services.closeModelDrivers!();
  });
  signals = new Map();
  vi.spyOn(process, "on").mockImplementation((event, listener) => {
    signals.set(String(event), listener as () => void);
    return process;
  });
  exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("入口夹具禁止模型HTTP"))),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("模型驱动的真实 worker main 入口所有权", () => {
  it.each(configurations)("--check透传$name配置，关闭已登记驱动且不启动运行时", async (config) => {
    const env = configured(config.asr, config.llm);
    ports.env.mockReturnValue(env);
    await main(["--check"]);
    expect(ports.build).toHaveBeenCalledOnce();
    expect(ports.build.mock.calls[0]![0].keys).toBe(env);
    expect(lifecycle()).toEqual({
      registerClose: expect.any(Function),
      close: expect.any(Function),
    });
    expect(ports.asrClose).toHaveBeenCalledTimes(config.asr ? 1 : 0);
    expect(ports.llmClose).toHaveBeenCalledTimes(config.llm ? 1 : 0);
    expect(ports.clients).toHaveLength(0);
    expect(ports.createLease).not.toHaveBeenCalled();
    expect(ports.createRuntime).not.toHaveBeenCalled();
    expect(services.closeModelBudget).toHaveBeenCalledOnce();
    expect(services.closeAlertFacts).toHaveBeenCalledOnce();
    expect(ports.database.close).toHaveBeenCalledOnce();
  });

  it.each(configurations)("正常关停$name配置，stop与入口兜底共享缓存Promise", async (config) => {
    ports.env.mockReturnValue(configured(config.asr, config.llm));
    let first: Promise<void> | undefined;
    ports.runtime.stop.mockImplementation(async () => {
      first = lifecycle().close();
      expect(lifecycle().close()).toBe(first);
      await first;
    });
    await main([]);
    expect(ports.asrClose).not.toHaveBeenCalled();
    expect(ports.llmClose).not.toHaveBeenCalled();
    shutdown();
    await exited(0);
    expect(lifecycle().close()).toBe(first);
    expect(ports.runtime.stop).toHaveBeenCalledOnce();
    expect(ports.asrClose).toHaveBeenCalledTimes(config.asr ? 1 : 0);
    expect(ports.llmClose).toHaveBeenCalledTimes(config.llm ? 1 : 0);
    infrastructureClosed();
    expect(ports.lease.close).toHaveBeenCalledOnce();
  });

  it("stop的真实进入门闩未释放前不关闭模型，重复信号只关停一次", async () => {
    const entered = deferred();
    const drain = deferred();
    ports.runtime.stop.mockImplementation(async () => {
      entered.release();
      await drain.promise;
      await services.closeModelDrivers!();
    });
    await main([]);
    shutdown();
    signals.get("SIGINT")!();
    await entered.promise;
    try {
      expect(services.disableModelBudget).toHaveBeenCalledOnce();
      expect(ports.asrClose).not.toHaveBeenCalled();
      expect(ports.llmClose).not.toHaveBeenCalled();
      expect(ports.database.close).not.toHaveBeenCalled();
      expect(ports.clients[0]!.disconnect).not.toHaveBeenCalled();
    } finally {
      drain.release();
    }
    await exited(0);
    expect(ports.runtime.stop).toHaveBeenCalledOnce();
    expect(ports.asrClose).toHaveBeenCalledOnce();
    expect(ports.llmClose).toHaveBeenCalledOnce();
    infrastructureClosed();
  });

  it("自检关闭一模型拒绝仍等待另一模型，之后继续预算与基础设施清理", async () => {
    const failure = new Error("public-asr-close-failure");
    const entered = deferred();
    const pending = deferred();
    ports.asrClose.mockRejectedValueOnce(failure);
    ports.llmClose.mockImplementationOnce(async () => {
      entered.release();
      await pending.promise;
    });
    const result = main(["--check"]).then(
      () => ({ error: undefined }),
      (error: unknown) => ({ error }),
    );
    await entered.promise;
    const closing = lifecycle().close();
    expect(lifecycle().close()).toBe(closing);
    try {
      expect(ports.asrClose).toHaveBeenCalledOnce();
      expect(ports.llmClose).toHaveBeenCalledOnce();
      expect(services.closeModelBudget).not.toHaveBeenCalled();
      expect(services.closeAlertFacts).not.toHaveBeenCalled();
      expect(ports.database.close).not.toHaveBeenCalled();
    } finally {
      pending.release();
    }
    expect((await result).error).toBe(failure);
    await expect(closing).rejects.toBe(failure);
    expect(services.closeModelBudget).toHaveBeenCalledOnce();
    expect(services.closeAlertFacts).toHaveBeenCalledOnce();
    expect(ports.database.close).toHaveBeenCalledOnce();
    expect(ports.asrClose).toHaveBeenCalledOnce();
    expect(ports.llmClose).toHaveBeenCalledOnce();
  });

  it("stop提前失败时入口仍关闭模型并回收原基础设施，退出保留失败", async () => {
    const failure = new Error("public-stop-failure");
    ports.runtime.stop.mockRejectedValueOnce(failure);
    await main([]);
    shutdown();
    await exited(1);
    expect(ports.asrClose).toHaveBeenCalledOnce();
    expect(ports.llmClose).toHaveBeenCalledOnce();
    infrastructureClosed();
    expect(ports.lease.close).toHaveBeenCalledOnce();
    expect(ports.logger.error).toHaveBeenCalledWith({ err: failure }, "任务关停失败");
  });

  it.each(["build", "selfCheck", "lease", "runtime", "start"] as const)(
    "%s失败回收已登记模型，后续关闭故障不替换原异常",
    async (where) => {
      const failure = new Error(`public-${where}-failure`);
      ports.asrClose.mockRejectedValueOnce(new Error("public-close-failure"));
      if (where === "build")
        ports.build.mockImplementationOnce((options) => {
          options.modelDrivers!.registerClose(ports.asrClose);
          throw failure;
        });
      if (where === "selfCheck") services.selfCheck!.mockRejectedValueOnce(failure);
      if (where === "lease")
        ports.createLease.mockImplementationOnce(() => {
          throw failure;
        });
      if (where === "runtime")
        ports.createRuntime.mockImplementationOnce(() => {
          throw failure;
        });
      if (where === "start")
        ports.runtime.start.mockImplementationOnce(() => {
          throw failure;
        });
      await expect(main([])).rejects.toBe(failure);
      expect(ports.asrClose).toHaveBeenCalledOnce();
      expect(ports.llmClose).toHaveBeenCalledTimes(where === "build" ? 0 : 1);
      infrastructureClosed();
      expect(ports.lease.close).toHaveBeenCalledTimes(
        where === "runtime" || where === "start" ? 1 : 0,
      );
      if (where !== "build") {
        expect(services.closeModelBudget).toHaveBeenCalledOnce();
        expect(services.closeAlertFacts).toHaveBeenCalledOnce();
        expect(ports.asrClose.mock.invocationCallOrder[0]).toBeLessThan(
          services.closeModelBudget!.mock.invocationCallOrder[0]!,
        );
      }
      expect(exit).not.toHaveBeenCalled();
    },
  );

  it("每次main调用持有独立模型列表与缓存Promise", async () => {
    await main(["--check"]);
    const first = lifecycle().close();
    await main(["--check"]);
    const second = lifecycle().close();
    expect(first).not.toBe(second);
    await Promise.all([first, second]);
    expect(ports.asrClose).toHaveBeenCalledTimes(2);
    expect(ports.llmClose).toHaveBeenCalledTimes(2);
    expect(ports.database.close).toHaveBeenCalledTimes(2);
  });

  it("真实loadEnv的模型FILE失败在所有DI之前发生且不暴露受控路径", async () => {
    const missing = join(tmpdir(), `lyx-public-model-entry-missing-${randomUUID()}`);
    ports.env.mockImplementation(() =>
      actual.loadEnv({
        APP_ENV: "test",
        DATABASE_URL: "postgresql://public:public@localhost/public_fixture",
        REDIS_URL: "redis://localhost:6379",
        ASR_TENCENT_FILE: missing,
      }),
    );
    const failure = await main(["--check"]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(actual.EnvError);
    expect((failure as Error).message).toContain("ASR_TENCENT_FILE");
    expect((failure as Error).message).not.toContain(missing);
    expect(ports.assemble).not.toHaveBeenCalled();
    expect(ports.connect).not.toHaveBeenCalled();
    expect(ports.queue).not.toHaveBeenCalled();
    expect(ports.build).not.toHaveBeenCalled();
    expect(ports.clients).toHaveLength(0);
  });
});
