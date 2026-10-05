import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { createTxRunner, KernelViolation } from "../kernel/index.js";
import type { TxRunner } from "../kernel/index.js";
import { assembleForTest, SAMPLE_PROVIDER_INPUTS, useTestDatabase } from "../testing/index.js";
import { StartupCheckError } from "./startup.js";
import { buildWorkerServices } from "./worker.js";
import type { WorkerServicesOptions } from "./worker.js";

// worker 的服务装配（KF-1）：启动自检与 api 是同一份清单；十二个 Provider 经 assembleProviders 装配，
// “事务内不调外部服务”在真实装配里有人拦。循环与队列的用例在 apps/worker/test。

const SLOW = 120_000;
const db = useTestDatabase("services");
let prisma: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = createTxRunner({ prisma, appEnv: "test" });
}, SLOW);

const channel = { enqueue: () => Promise.reject(new Error("用例不入队")), downForMs: () => 0 };
function build(overrides: Partial<WorkerServicesOptions> = {}) {
  const logs: Array<{ level: string; fields: Record<string, unknown>; message: string }> = [];
  const at = (level: string) => (fields: Record<string, unknown>, message: string) =>
    void logs.push({ level, fields, message });
  const services = buildWorkerServices({
    appEnv: "test",
    prisma,
    assembly: assembleForTest({ entry: "worker" }),
    channel,
    logger: { info: at("info"), warn: at("warn"), error: at("error") },
    ...overrides,
  });
  return { services, logs };
}

describe("buildWorkerServices：启动自检", () => {
  it(
    "跑过全部迁移的库上通过；没配密钥在 test 下放行并记一条告警",
    async () => {
      const { services, logs } = build();
      await expect(services.selfCheck()).resolves.toBeUndefined();
      expect(logs.filter((line) => line.fields["evt"] === "startup.check_skipped")).toHaveLength(1);
    },
    SLOW,
  );

  it("库里没有业务表：三项读库的自检都报出来，一次列全", async () => {
    const empty = { $queryRawUnsafe: async () => [] } as unknown as PrismaClient;
    const failure = await build({ prisma: empty })
      .services.selfCheck()
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(StartupCheckError);
    expect((failure as StartupCheckError).issues.map((issue) => issue.split("：")[0])).toEqual([
      "audit.target_type",
      "events.aggregate_types",
      "flow.state_columns",
    ]);
  });

  it("预发没配密钥：自检不过", async () => {
    const failure = await build({ appEnv: "stg" })
      .services.selfCheck()
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect((failure as StartupCheckError).issues).toEqual([
      expect.stringMatching(/^security\.crypto：没有配置密钥/),
    ]);
  });
});

describe("buildWorkerServices：十二个 Provider", () => {
  it("启动时把生效状态打进日志；test 下短信是控制台输出", () => {
    const { services, logs } = build();
    expect(services.providers.sms.status).toBe("local");
    expect(logs.some((line) => line.message === "providers ready")).toBe(true);
  });

  it(
    "事务里调 Provider 的方法：抛 KernelViolation，请求发不出去；事务外照常",
    async () => {
      const { services, logs } = build();
      const input = SAMPLE_PROVIDER_INPUTS.sms.sendActivationCode;
      const sent = () => logs.filter((line) => line.message.includes("员工激活码")).length;

      const failure = await tx
        .run(async () => {
          await services.providers.sms.sendActivationCode(input);
        })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(KernelViolation);
      expect(failure).toMatchObject({ kind: "external_call_in_transaction" });
      expect((failure as Error).message).toContain("sms.sendActivationCode");
      expect(sent()).toBe(0);

      expect(await services.providers.sms.sendActivationCode(input)).toMatchObject({ ok: true });
      expect(sent()).toBe(1);
    },
    SLOW,
  );
});
