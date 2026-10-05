// 不变量校验的一次运行（W0-24）：用例函数 runInvariants。周期任务、发布编排、演练脚本、后台的手工触发都调它。
// 依据：15 分组 第 2.4、2.5 节；D7 第 9.6 节。各模块只登记检查项、返回违规；调度与落库在这里。
//
//   开始：短事务里把超过完成期限仍为 running 的行标成中断，插入本次的运行行（running）。
//   逐项：一项一个事务——检查、自愈（检查项自己做）、写违规同成同败。一项抛错只回滚它自己，其余照跑。
//   结束：短事务回写结果。全部检查项跑完即 succeeded（有没有违规看 violations_found）；
//         有检查项出错、或被中止，即 failed 并写错误摘要。
// 不设“同一方式至多一条运行中”：两次运行重叠无害，检查项是只读查询（自愈按状态幂等），违规按唯一索引合并。
import { TX_TIMEOUT_MAX_MS } from "../../kernel/index.js";
import type { Assembly, Clock, InvariantMode, TxRunner } from "../../kernel/index.js";
import { selectChecks } from "./select.js";
import type { InvariantTrigger } from "./select.js";
import {
  abandonStaleRuns,
  finishRun,
  insertRun,
  lastQuickStart,
  writeViolations,
} from "./store.js";
import type { InvariantRunStatus, StoredScope } from "./store.js";

export interface InvariantRunDeps {
  readonly tx: TxRunner;
  readonly assembly: Pick<Assembly, "invariants">;
  readonly clock: Clock;
}

export interface RunInvariantsInput {
  readonly mode: InvariantMode;
  readonly trigger: InvariantTrigger;
  /** 定时触发的计划时刻：every 按它判定 */
  readonly scheduledFor?: Date;
  /** quick 的起点；定时的 quick 不给时取上一次成功的定时 quick 运行的开始时间 */
  readonly since?: Date;
  /** 限定主体：传给检查项 */
  readonly entityIds?: readonly string[];
  /** 只跑这些模块登记的检查项 */
  readonly modules?: readonly string[];
  /** 只跑这些编号 */
  readonly codes?: readonly string[];
  /** 中止信号：两个检查项之间看一眼，已中止即收手，运行记 failed */
  readonly signal?: AbortSignal;
}

export interface InvariantCheckError {
  readonly code: string;
  readonly message: string;
}

export interface InvariantRunResult {
  readonly runId: string;
  readonly status: Exclude<InvariantRunStatus, "running">;
  /** 跑完的检查项数（出错的不算） */
  readonly checksRun: number;
  /** 各检查项返回的违规条数，含此前已存在、仍未解决的 */
  readonly violationsFound: number;
  /** 其中这次新建的未解决行 */
  readonly created: number;
  /** 其中 heal_only 自愈后自动关闭的 */
  readonly autoClosed: number;
  readonly errors: readonly InvariantCheckError[];
}

/** 一个检查项的事务上限：全表的只读查询，按批处理的上限给（只在任务进程里跑） */
const CHECK_TX = { timeoutMs: TX_TIMEOUT_MAX_MS } as const;

const summary = (error: unknown): string =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 300);

function storedScope(input: RunInvariantsInput, since: Date | undefined): StoredScope | null {
  const scope: StoredScope = {
    ...(since === undefined ? {} : { since: since.toISOString() }),
    ...(input.entityIds === undefined ? {} : { entityIds: input.entityIds }),
    ...(input.modules === undefined ? {} : { modules: input.modules }),
    ...(input.codes === undefined ? {} : { codes: input.codes }),
  };
  return Object.keys(scope).length === 0 ? null : scope;
}

export async function runInvariants(
  deps: InvariantRunDeps,
  input: RunInvariantsInput,
): Promise<InvariantRunResult> {
  const { tx, clock } = deps;
  const { runId, since } = await tx.run(async (handle) => {
    const startedAt = clock.now();
    await abandonStaleRuns(handle, startedAt);
    const from =
      input.since ??
      (input.mode === "quick" && input.trigger === "schedule"
        ? await lastQuickStart(handle)
        : undefined);
    const id = await insertRun(handle, {
      mode: input.mode,
      trigger: input.trigger,
      scope: storedScope(input, from),
      startedAt,
    });
    return { runId: id, since: from };
  });

  const scope = {
    ...(since === undefined ? {} : { since }),
    ...(input.entityIds === undefined ? {} : { entityIds: input.entityIds }),
  };
  const errors: InvariantCheckError[] = [];
  let checksRun = 0;
  let violationsFound = 0;
  let created = 0;
  let autoClosed = 0;
  for (const check of selectChecks(deps.assembly.invariants, input)) {
    if (input.signal?.aborted === true) {
      errors.push({ code: check.code, message: "已中止：本期被接管或取消" });
      break;
    }
    const run = check.run;
    if (run === undefined) continue;
    try {
      const written = await tx.run(async (handle) => {
        const now = clock.now();
        const violations = await run(handle, scope, { now });
        return writeViolations(
          handle,
          {
            runId,
            code: check.code,
            module: check.module,
            severity: check.severity,
            heal: check.heal ?? "none",
            now,
          },
          violations,
        );
      }, CHECK_TX);
      checksRun += 1;
      violationsFound += written.found;
      created += written.created;
      autoClosed += written.autoClosed;
    } catch (error) {
      errors.push({ code: check.code, message: summary(error) });
    }
  }

  const status = errors.length === 0 ? "succeeded" : "failed";
  await tx.run((handle) =>
    finishRun(handle, runId, {
      status,
      finishedAt: clock.now(),
      checksRun,
      violationsFound,
      ...(errors.length === 0
        ? {}
        : { error: errors.map((item) => `${item.code}：${item.message}`).join("；") }),
    }),
  );
  return { runId, status, checksRun, violationsFound, created, autoClosed, errors };
}
