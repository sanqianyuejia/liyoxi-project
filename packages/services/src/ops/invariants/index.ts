// 不变量校验的出口（W0-24）。用法见本目录的 README.md。
export { reportingInvariants } from "./report.js";
export { runInvariants } from "./run.js";
export type {
  InvariantCheckError,
  InvariantRunDeps,
  InvariantRunResult,
  RunInvariantsInput,
} from "./run.js";
export { isMonday, isTopOfHour, selectChecks } from "./select.js";
export type { CheckSelection, InvariantTrigger } from "./select.js";
export {
  ABANDONED,
  abandonStaleRuns,
  AUTO_HEALED,
  finishRun,
  insertRun,
  lastQuickStart,
  RUN_DEADLINE_MIN,
  writeViolations,
} from "./store.js";
export type {
  InvariantRunStatus,
  NewRun,
  RunOutcome,
  StoredScope,
  ViolationSource,
  WriteResult,
} from "./store.js";
