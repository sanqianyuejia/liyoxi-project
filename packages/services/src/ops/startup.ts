// 启动自检（W0-22 起；KF-1 接齐）：api 与 worker 启动时各跑一遍，有一项不过进程就起不来。
// 依据：docs/plan/tasks/README.md 第 5 节移交表第 1 行；D4 第 9.2 节；01 分组 第 2 节通用说明、第 3.4 节。
//
//   db.connect             成功连上一次数据库；连不上时后面三项读库的不跑，只报这一条
//   security.crypto        字段加密的密钥环：加密、解密、盲索引各走一遍（W0-14）
//   audit.target_type      契约登记的审计对象类型都是库里存在的表（W0-14）
//   events.aggregate_types 契约登记的聚合类型都是库里存在的表（W0-15）
//   flow.state_columns     迁移表登记的状态机表与状态列在库里存在（W0-16）
//
// 密钥没配：stg、prod 下不过；local、test 下放行并记一条告警（本地与 CI 不放密钥文件，M0 的两个进程也还没有用到
// 密钥的用例；第一个用到它的包再决定本地要不要必配）。配了的，任何环境都自检。
import { findUnknownAuditTargetTypes } from "../audit/index.js";
import type { AuditReader } from "../audit/index.js";
import { findMissingAggregateTables } from "../events/index.js";
import { findMissingStateColumns } from "../flow/index.js";
import type { AppEnv, BidxKeysConfig, DataKeysConfig } from "../kernel/index.js";
import { loadKeyring } from "../security/index.js";

/** 启动自检的一项：返回问题清单，空数组即通过。抛错也算不过 */
export interface StartupCheck {
  readonly name: string;
  run(): Promise<readonly string[]>;
}

/** 启动自检没过：进程起不来。issues 里是全部问题 */
export class StartupCheckError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`启动自检没过，共 ${issues.length} 处：\n- ${issues.join("\n- ")}`);
    this.name = "StartupCheckError";
    this.issues = issues;
  }
}

/** 逐项跑启动自检，问题一次报全：有一项不过即抛 StartupCheckError */
export async function runStartupChecks(checks: readonly StartupCheck[]): Promise<void> {
  const issues: string[] = [];
  for (const check of checks) {
    try {
      for (const problem of await check.run()) issues.push(`${check.name}：${problem}`);
    } catch (error) {
      // 只带错误的名字与消息里的第一行：连接失败的报错里可能有主机名，不带连接串
      const reason = error instanceof Error ? (error.message.split("\n")[0] ?? error.name) : "出错";
      issues.push(`${check.name}：${reason}`);
    }
  }
  if (issues.length > 0) throw new StartupCheckError(issues);
}

export interface StartupCheckDeps {
  /** 进程的业务连接池（只发只读查询） */
  readonly db: AuditReader;
  readonly appEnv: AppEnv;
  /** loadEnv 的结果里那两份密钥；没配就是两项都没有 */
  readonly keys: { readonly DATA_KEYS?: DataKeysConfig; readonly BIDX_KEYS?: BidxKeysConfig };
  /** 放行但要让人看见的事，往日志里记 */
  warn(message: string): void;
}

/** 两个进程共用的启动自检清单，顺序固定：先连库，再各项 */
export function createStartupChecks(deps: StartupCheckDeps): StartupCheck[] {
  const { db, appEnv, keys } = deps;
  let connected = false;
  /** 读库的一项：库没连上就不跑（db.connect 已经报过），不让一个原因刷出四条 */
  const reading = (name: string, find: () => Promise<readonly string[]>): StartupCheck => ({
    name,
    run: async () => (connected ? find() : []),
  });
  const missing = (what: string, names: readonly string[]): string[] =>
    names.length === 0 ? [] : [`${what}：${names.join("、")}`];

  return [
    {
      // 启动阶段要求成功连上一次数据库；之后就绪与否不再看库（h01 第 3.12 节）
      name: "db.connect",
      async run() {
        await db.$queryRawUnsafe("SELECT 1");
        connected = true;
        return [];
      },
    },
    {
      name: "security.crypto",
      async run() {
        const unset = keys.DATA_KEYS === undefined || keys.BIDX_KEYS === undefined;
        if (unset && (appEnv === "local" || appEnv === "test")) {
          deps.warn(
            "没有配置密钥（DATA_KEYS_FILE、BIDX_KEYS_FILE）：字段加密的启动自检没跑，用到敏感字段的用例会失败",
          );
          return [];
        }
        // 没配、不合格、自检不过都抛 SecurityError：消息只说哪一项不合格，不带密钥内容
        loadKeyring(keys);
        return [];
      },
    },
    reading("audit.target_type", async () =>
      missing("契约登记的审计对象类型在库里没有对应的表", await findUnknownAuditTargetTypes(db)),
    ),
    reading("events.aggregate_types", async () =>
      missing("契约登记的聚合类型在库里没有对应的表", await findMissingAggregateTables(db)),
    ),
    reading("flow.state_columns", async () =>
      missing("迁移表登记的状态机与状态列在库里对不上", await findMissingStateColumns(db)),
    ),
  ];
}
