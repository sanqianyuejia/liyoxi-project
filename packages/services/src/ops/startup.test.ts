import { describe, expect, it } from "vitest";

import { createStartupChecks, runStartupChecks, StartupCheckError } from "./startup.js";
import type { StartupCheckDeps } from "./startup.js";

// 启动自检的清单（KF-1；移交表第 1 行）。不连库：读库的三项对着一个“什么表都没有”的假读口，各自报得出问题；
// 连真库通过的那一面在 runtime.db.test.ts（api）与 worker.db.test.ts（worker）。
// 密钥是固定字节现造的假密钥，不读任何文件，不是任何环境在用的密钥。

const key = (fill: number): string => Buffer.alloc(32, fill).toString("base64");
const KEYS = {
  DATA_KEYS: { current: "a", keys: { a: key(0xa1) } },
  BIDX_KEYS: { phone: key(0xc3), uscc: key(0xd4) },
};

type Reader = StartupCheckDeps["db"];
/** 假读口：SELECT 1 之外的查询都返回空（库里一张表都没有）；记下发过的查询 */
function emptyDatabase(): { db: Reader; queries: string[] } {
  const queries: string[] = [];
  const db = {
    $queryRawUnsafe: async (query: string) => {
      queries.push(query);
      return [];
    },
  } as unknown as Reader;
  return { db, queries };
}
const unreachable = {
  $queryRawUnsafe: async () => {
    throw new Error("connect ECONNREFUSED 10.0.0.9:5432\n    at 某处");
  },
} as unknown as Reader;

function checks(overrides: Partial<StartupCheckDeps> = {}) {
  const warnings: string[] = [];
  const list = createStartupChecks({
    db: emptyDatabase().db,
    appEnv: "test",
    keys: KEYS,
    warn: (message) => void warnings.push(message),
    ...overrides,
  });
  const issuesOf = async (): Promise<readonly string[]> => {
    const failure = await runStartupChecks(list).then(
      () => undefined,
      (error: unknown) => error,
    );
    if (failure === undefined) return [];
    expect(failure).toBeInstanceOf(StartupCheckError);
    return (failure as StartupCheckError).issues;
  };
  return { list, warnings, issuesOf };
}

describe("启动自检的清单", () => {
  it("五项，顺序固定：先连库，再密钥环、审计对象类型、聚合类型、状态机表与状态列", () => {
    expect(checks().list.map((check) => check.name)).toEqual([
      "db.connect",
      "security.crypto",
      "audit.target_type",
      "events.aggregate_types",
      "flow.state_columns",
    ]);
  });

  it("库里一张表都没有：读库的三项各报一条，列出对不上的名字", async () => {
    const issues = await checks().issuesOf();
    expect(issues).toHaveLength(3);
    expect(issues[0]).toMatch(/^audit\.target_type：契约登记的审计对象类型在库里没有对应的表：/);
    expect(issues[1]).toMatch(/^events\.aggregate_types：契约登记的聚合类型在库里没有对应的表：/);
    expect(issues[2]).toMatch(/^flow\.state_columns：迁移表登记的状态机与状态列在库里对不上：/);
    // 名字是契约里登记的那些：各举一个
    expect(issues[0]).toContain("delivery_ticket");
    expect(issues[1]).toContain("drama_order");
    expect(issues[2]).toContain("drama_order.status");
  });

  it("库连不上：只报 db.connect 一条（带消息的第一行），读库的三项不跑", async () => {
    const issues = await checks({ db: unreachable }).issuesOf();
    expect(issues).toEqual(["db.connect：connect ECONNREFUSED 10.0.0.9:5432"]);
  });
});

describe("security.crypto：字段加密的密钥环", () => {
  const only = async (overrides: Partial<StartupCheckDeps>) => {
    const { list, warnings } = checks(overrides);
    const check = list.find((one) => one.name === "security.crypto")!;
    const outcome = await check.run().then(
      () => "pass" as const,
      (error: unknown) => (error as Error).message,
    );
    return { outcome, warnings };
  };

  it.each(["local", "test", "stg", "prod"] as const)(
    "%s：配了合格的密钥，自检通过",
    async (appEnv) => {
      expect(await only({ appEnv })).toEqual({ outcome: "pass", warnings: [] });
    },
  );

  it.each(["stg", "prod"] as const)("%s：没配密钥，不过", async (appEnv) => {
    const { outcome } = await only({ appEnv, keys: {} });
    expect(outcome).toMatch(/没有配置密钥/);
    // 只配了一份也算没配
    expect((await only({ appEnv, keys: { DATA_KEYS: KEYS.DATA_KEYS } })).outcome).toMatch(
      /没有配置密钥/,
    );
  });

  it.each(["local", "test"] as const)("%s：没配密钥，放行并记一条告警", async (appEnv) => {
    const { outcome, warnings } = await only({ appEnv, keys: {} });
    expect(outcome).toBe("pass");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/没有配置密钥/);
  });

  it("配了但不合格（两把密钥相同）：任何环境都不过，报错里没有密钥内容", async () => {
    const same = { ...KEYS, BIDX_KEYS: { phone: key(0xa1), uscc: key(0xd4) } };
    for (const appEnv of ["test", "prod"] as const) {
      const { outcome } = await only({ appEnv, keys: same });
      expect(outcome).toMatch(/密钥环不合格/);
      expect(outcome).not.toContain(key(0xa1));
    }
  });
});
