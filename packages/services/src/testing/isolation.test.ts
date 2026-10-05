import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it, vi } from "vitest";

// 连库、连 Redis、起子进程的用例：实例忙的时候（别的会话同时在跑）会慢，时限放宽，不用缺省的 5 秒
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// pnpm test:isolation 的核对部分（isolation.mjs --check）：两份用量记录有交集、缺东西，都要判不通过。
// 另验它怎么定范围与并行数（--dry-run：只打印要跑什么，不跑）。
// 整条命令（真的起两个会话跑测试）在 CI 的 test:isolation 一步里跑（带 --scope connected），这里不嵌套着再跑一遍。

const SCRIPT = fileURLToPath(new URL("./isolation.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "lyx-isolation-check-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface Usage {
  databases: string[];
  redis: string[];
  parallel?: string[];
}

let serial = 0;
function usageFile(usage: Usage): string {
  const file = join(dir, `usage-${(serial += 1)}.jsonl`);
  const lines = [
    ...usage.databases.map((value) => ({ kind: "database", value })),
    ...usage.redis.map((value) => ({ kind: "redis", value })),
    ...(usage.parallel ? [{ kind: "parallel", value: usage.parallel }] : []),
  ];
  writeFileSync(file, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  return file;
}

const session = (id: string): Usage => ({
  databases: [`lyx_test_tpl_${id}`, `lyx_test_db_${id}_1`, `lyx_test_services_${id}_2`],
  redis: [`lyx:test:${id}:1:`, `lyx:test:${id}:2:`],
  parallel: [1, 2, 3, 4].map((worker) => `lyx_test_db_${id}_${worker}_par`),
});

function check(a: string, b: string, ...extra: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, "--check", a, b, ...extra], {
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe("test:isolation 核对两份用量记录", () => {
  it("两个会话各用各的：通过", () => {
    const result = check(usageFile(session("ia")), usageFile(session("ib")));
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("甲：库 7 个，Redis 前缀 2 个");
    expect(result.output).toContain("库名交集 0 个，Redis 前缀交集 0 个");
  });

  it("库名有交集：不通过，点出是哪个库", () => {
    const b = session("ib");
    b.databases.push("lyx_test_db_ia_1");
    const result = check(usageFile(session("ia")), usageFile(b));
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("不通过：库名有交集：lyx_test_db_ia_1");
  });

  it("Redis 前缀有交集：不通过，点出是哪个前缀", () => {
    const b = session("ib");
    b.redis.push("lyx:test:ia:2:");
    const result = check(usageFile(session("ia")), usageFile(b));
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("不通过：Redis 前缀有交集：lyx:test:ia:2:");
  });

  it("并行的那条记录里的库也算数：与另一边重了同样不通过", () => {
    const b = session("ib");
    b.parallel = session("ia").parallel;
    const result = check(usageFile(session("ia")), usageFile(b));
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("库名有交集：lyx_test_db_ia_1_par");
  });

  it("缺东西：没有库、没有 Redis 前缀、没有 4 个 worker 的记录、只有 3 个库的记录，都不通过", () => {
    const a = usageFile(session("ia"));
    const cases: Array<[Usage, string]> = [
      [{ ...session("ib"), databases: [], parallel: undefined }, "乙的用量记录里没有库"],
      [{ ...session("ib"), redis: [] }, "乙的用量记录里没有 Redis 前缀"],
      [
        { ...session("ib"), parallel: undefined },
        "乙没有“4 个 worker 同时在场、4 个互不相同的库”的记录",
      ],
      [
        {
          ...session("ib"),
          parallel: ["lyx_test_db_ib_1_par", "lyx_test_db_ib_2_par", "lyx_test_db_ib_3_par"],
        },
        "乙没有“4 个 worker 同时在场、4 个互不相同的库”的记录",
      ],
    ];
    for (const [usage, reason] of cases) {
      const result = check(a, usageFile(usage));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain(`不通过：${reason}`);
    }
  });

  it("用了不带测试前缀的库或键前缀：不通过", () => {
    const b = session("ib");
    b.databases.push("liyoxi");
    b.redis.push("lyx:local:");
    const result = check(usageFile(session("ia")), usageFile(b));
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("乙用了不带测试前缀的库：liyoxi");
    expect(result.output).toContain("乙用了不带测试前缀的 Redis 键前缀：lyx:local:");
  });

  it("记录读不了、不是 JSON：退出码 1；用法写错：退出码 2", () => {
    const a = usageFile(session("ia"));
    const missing = check(a, join(dir, "没有这个文件.jsonl"));
    expect(missing.status, missing.output).toBe(1);
    expect(missing.output).toContain("用量记录读不了");
    const broken = join(dir, "broken.jsonl");
    writeFileSync(broken, "这一行不是 JSON\n");
    const bad = check(a, broken);
    expect(bad.status, bad.output).toBe(1);
    expect(bad.output).toContain("第 1 行不是 JSON");
    for (const args of [
      ["--check", a],
      ["--check", a, a, "--expect"],
      ["--check", a, a, "--expect", "databases"],
      ["--check", a, a, "--except", "none"],
      ["--shard"],
      ["--shard", "2"],
      ["--shard", "0/4"],
      ["--shard", "5/4"],
      ["--shard", "一/四"],
      ["--bogus"],
      ["--scope"],
      ["--scope", "some"],
      ["--workers"],
      ["--workers", "0"],
      ["--workers", "four"],
    ]) {
      const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
      expect(result.status, args.join(" ")).toBe(2);
    }
  });
});

describe("test:isolation 分片时的核对（--check 带 --expect）", () => {
  // 分片后“4 个 worker 同时在场”的记录、Redis 前缀两项各只要求一片有；库、交集、前缀的写法每一片都照旧
  const bare = (id: string): Usage => ({ databases: [`lyx_test_db_${id}_1`], redis: [] });

  it("这一片没分到那两个文件（--expect none）：只有库的两份记录通过；不带 --expect 时照旧两项都要", () => {
    const [a, b] = [usageFile(bare("ia")), usageFile(bare("ib"))];
    expect(check(a, b, "--expect", "none").status).toBe(0);
    const strict = check(a, b);
    expect(strict.status).toBe(1);
    expect(strict.output).toContain("甲的用量记录里没有 Redis 前缀");
    expect(strict.output).toContain("乙没有“4 个 worker 同时在场、4 个互不相同的库”的记录");
  });

  it("各认各的：要 parallel 的片缺那条记录不通过，要 redis 的片缺前缀不通过", () => {
    const [a, b] = [usageFile(bare("ia")), usageFile(bare("ib"))];
    const parallel = check(a, b, "--expect", "parallel");
    expect(parallel.status).toBe(1);
    expect(parallel.output).toContain("甲没有“4 个 worker 同时在场、4 个互不相同的库”的记录");
    expect(parallel.output).not.toContain("没有 Redis 前缀");
    const redis = check(a, b, "--expect", "redis");
    expect(redis.status).toBe(1);
    expect(redis.output).toContain("乙的用量记录里没有 Redis 前缀");
    expect(redis.output).not.toContain("4 个 worker");
    const full = check(
      usageFile(session("ia")),
      usageFile(session("ib")),
      "--expect",
      "parallel,redis",
    );
    expect(full.status, full.output).toBe(0);
  });

  it("哪一片都逃不掉的三样：没有库、库名有交集、Redis 前缀有交集（这一片不要求有前缀，有了也得各用各的）", () => {
    const empty = check(
      usageFile({ databases: [], redis: [] }),
      usageFile(bare("ib")),
      "--expect",
      "none",
    );
    expect(empty.status).toBe(1);
    expect(empty.output).toContain("甲的用量记录里没有库");
    const shared = { ...bare("ib"), databases: ["lyx_test_db_ia_1"], redis: ["lyx:test:ia:1:"] };
    const overlap = check(
      usageFile({ ...bare("ia"), redis: ["lyx:test:ia:1:"] }),
      usageFile(shared),
      "--expect",
      "none",
    );
    expect(overlap.status).toBe(1);
    expect(overlap.output).toContain("库名有交集：lyx_test_db_ia_1");
    expect(overlap.output).toContain("Redis 前缀有交集：lyx:test:ia:1:");
  });
});

describe("test:isolation 的分片（--shard）", () => {
  const SHARDS = 4;
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [SCRIPT, "--scope", "connected", ...args], {
      encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  };
  // 每问一次都要起一遍 Vitest 列文件：同一份名单只问一次
  const lists = new Map<string, string[]>();
  const listed = (...args: string[]) => {
    const key = args.join(" ");
    let lines = lists.get(key);
    if (lines === undefined) {
      const result = run(...args, "--list");
      expect(result.status, result.output).toBe(0);
      lines = result.output.split("\n").filter((line) => line.includes("\t"));
      lists.set(key, lines);
    }
    return lines;
  };
  const PARALLEL = "db\tpackages/db/src/testing/parallel.test.ts";
  const REDIS = "services\tpackages/services/src/testing/redis-isolation.test.ts";

  it("各片互不重叠，合起来就是不分片的那一遍；认记录的两个文件各恰好在一片里", () => {
    const all = listed();
    const parts = Array.from({ length: SHARDS }, (_, index) =>
      listed("--shard", `${index + 1}/${SHARDS}`),
    );
    expect(all.length).toBeGreaterThan(SHARDS);
    expect(parts.flat().sort()).toEqual([...all].sort());
    expect(new Set(parts.flat()).size).toBe(all.length);
    // 等分：各片的文件数最多差一个
    const sizes = parts.map((part) => part.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    // 范围里只有连库的项目；本文件自己也在里面
    expect(new Set(all.map((line) => line.split("\t")[0]))).toEqual(
      new Set(["api", "db", "services", "worker"]),
    );
    expect(all).toContain("services\tpackages/services/src/testing/isolation.test.ts");
    for (const anchor of [PARALLEL, REDIS]) {
      expect(parts.filter((part) => part.includes(anchor))).toHaveLength(1);
    }
  });

  it("每个会话的命令把 --shard 原样传给 Vitest；这一片要核对哪几项，照那两个文件在不在这一片里定", () => {
    // 挑两片看：分到 parallel.test.ts 的那一片，与两个文件都没分到的一片
    const indexes = Array.from({ length: SHARDS }, (_, at) => at + 1);
    const filesOf = (index: number) => listed("--shard", `${index}/${SHARDS}`);
    const withParallel = indexes.find((index) => filesOf(index).includes(PARALLEL));
    const plain = indexes.find(
      (index) => !filesOf(index).includes(PARALLEL) && !filesOf(index).includes(REDIS),
    );
    expect(withParallel).toBeDefined();
    expect(plain).toBeDefined();
    for (const index of [withParallel ?? 0, plain ?? 0]) {
      const shard = `${index}/${SHARDS}`;
      const files = filesOf(index);
      const result = run("--shard", shard, "--workers", "1", "--dry-run");
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain(
        `的第 ${index} 片（共 ${SHARDS} 片；这一片 ${files.length} 个用例文件），各 1 个 worker`,
      );
      expect(result.output).toMatch(
        new RegExp(
          `每个会话的命令：pnpm test --maxWorkers=1 (--project \\S+ )+--shard=${shard}\\n`,
        ),
      );
      const expectation = /这一片的核对：(.+)/.exec(result.output)?.[1] ?? "";
      expect(expectation).toContain("库名与 Redis 前缀没有交集；两边都要有库");
      expect(expectation.includes("“4 个 worker 同时在场”的记录")).toBe(files.includes(PARALLEL));
      expect(expectation.includes("、Redis 前缀（")).toBe(files.includes(REDIS));
    }
  });

  it("不分片时不提“这一片”，命令里也没有 --shard", () => {
    const result = run("--workers", "1", "--dry-run");
    expect(result.output).not.toContain("这一片");
    expect(result.output).not.toContain("--shard");
  });
});

describe("test:isolation 的范围与并行数", () => {
  const dryRun = (...args: string[]) => {
    const result = spawnSync(process.execPath, [SCRIPT, ...args, "--dry-run"], {
      encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  };
  const commandOf = (output: string) => /每个会话的命令：pnpm test (.+)/.exec(output)?.[1] ?? "";

  it("缺省跑全量；每个会话的 worker 数按核数定：合起来不超过可用核数，最多 4 个、至少 1 个", () => {
    const result = dryRun();
    expect(result.status, result.output).toBe(0);
    const match = /同时跑全量测试，各 (\d+) 个 worker（本机可用 (\d+) 核）/.exec(result.output);
    const [workers, cores] = [Number(match?.[1]), Number(match?.[2])];
    expect(cores).toBe(availableParallelism());
    expect(workers).toBeGreaterThanOrEqual(1);
    expect(workers).toBeLessThanOrEqual(4);
    // 不挤：两个会话合起来不超过核数（核数不到 2 时各 1 个是下限）
    expect(workers === 1 || workers * 2 <= cores).toBe(true);
    // 也不浪费：再多一个就超了，或者已经到 4 个的上限
    expect(workers === 4 || (workers + 1) * 2 > cores).toBe(true);
    // 不带 --project：全部项目都跑
    expect(commandOf(result.output)).toBe(`--maxWorkers=${workers}`);
  });

  it("--workers 显式指定；比核数多时提醒一句", () => {
    const result = dryRun("--workers", "3");
    expect(result.status, result.output).toBe(0);
    expect(commandOf(result.output)).toBe("--maxWorkers=3");
    const crowded = dryRun("--workers", "99");
    expect(crowded.output).toContain("两个会话合起来 198 个 worker");
  });

  it("--scope connected：只跑挂了 globalSetup 的项目，不连库的项目不在里面", () => {
    const result = dryRun("--scope", "connected", "--workers", "2");
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("同时跑连库的测试项目（挂了 globalSetup 的：");
    const command = commandOf(result.output);
    expect(command.startsWith("--maxWorkers=2 --project ")).toBe(true);
    const projects = [...command.matchAll(/--project (\S+)/g)].map((match) => match[1]);
    // 连库、连 Redis 的用例现在在这两个项目里；以后挂上 globalSetup 的包自动进来
    expect(projects).toContain("db");
    expect(projects).toContain("services");
    for (const pure of ["infra", "shared", "contract"]) expect(projects).not.toContain(pure);
  });
});
