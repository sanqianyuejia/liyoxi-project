// approval 的装配入口（W1-06）：api 与 worker 启动时各调一次 createApproval（createFlow 之后），拿到四个写函数与 recordExecuted。
// 构造时把各模块登记的审批类型校验一遍，写错的一次列全，抛 ApprovalError（进程启动失败）。
// 四个写函数的第一个参数都是事务句柄：本模块不开事务、不挂写路由，决定与撤回的路由在各领域资源上（约定 C67）。
import { APPROVAL_EXECUTION_KINDS, APPROVAL_KIND } from "@liyoxi/contract";
import type { ApprovalKind } from "@liyoxi/contract";

import type { EmitContext, Events } from "../events/index.js";
import type { Sla } from "../sla/index.js";
import type { Timers } from "../timers/index.js";
import { touchPending } from "./touch.js";
import type { TouchPendingInput } from "./touch.js";

import type { Flow } from "../flow/index.js";
import type { Assembly, BizNoIssuer, Clock, Tx } from "../kernel/index.js";

import type { ApprovalDeps } from "./context.js";
import { approve, reject, withdraw } from "./decide.js";
import type { ApproveInput, DecisionResult, RejectInput, WithdrawInput } from "./decide.js";
import { ApprovalError } from "./errors.js";
import { recordExecuted } from "./execute.js";
import type { RecordExecutedInput } from "./execute.js";
import { bindApprovalKinds } from "./invariants.js";
import { approvalKindPort } from "./kinds.js";
import type { ApprovalKindRegistration, ApprovalNumberPrefix } from "./kinds.js";
import { submit } from "./submit.js";
import type { SubmitInput, SubmitResult } from "./submit.js";
import { createApprovalReads } from "./read.js";
import type { ApprovalReads } from "./read.js";

export interface ApprovalOptions {
  /** 装配结果：各模块登记的审批类型从这里取 */
  readonly assembly: Pick<Assembly, "portEntries">;
  readonly clock: Clock;
  /** createFlow 给的：审批单的状态只经它迁移 */
  readonly flow: Pick<Flow, "transition">;
  /** createEvents 给的：approval.executed 不随迁移，直接发 */
  readonly events: Pick<Events, "emit">;
  readonly bizNo: Pick<BizNoIssuer, "next">;
  /** 决定时限依赖成对注入；旧的单模块样例可以均不传。实际 runtime 必须提供。 */
  readonly sla?: Pick<Sla, "dueAt">;
  readonly timers?: Pick<Timers, "arm" | "cancel">;
}

export interface Approval extends ApprovalReads {
  /** 已登记的审批类型，键是 kind */
  readonly kinds: ReadonlyMap<string, ApprovalKindRegistration>;
  /** 提交：建一张待审的审批单。同对象已有在途单 → 409 APPROVAL_ALREADY_PENDING */
  submit<I>(tx: Tx, ctx: EmitContext, input: SubmitInput<I>): Promise<SubmitResult>;
  /** 通过：守卫 → 迁移 → onApproved → 审计 → approval.approved */
  approve(tx: Tx, ctx: EmitContext, input: ApproveInput): Promise<DecisionResult>;
  /** 驳回：说明必填，不校验锁版本 */
  reject(tx: Tx, ctx: EmitContext, input: RejectInput): Promise<DecisionResult>;
  /** 撤回：提交人本人、代撤、系统三种来源 */
  withdraw(tx: Tx, ctx: EmitContext, input: WithdrawInput): Promise<DecisionResult>;
  /** 领域更正在同事务中先锁待审单并升版本；不迁移、不写决定记录。 */
  touchPending(
    tx: Tx,
    input: TouchPendingInput,
  ): Promise<{ approvalId: string; lockVersion: number }>;
  /** 有执行步的类型执行成功后调：发 approval.executed，审批单不动 */
  recordExecuted(
    tx: Tx,
    ctx: EmitContext,
    input: RecordExecutedInput,
  ): Promise<{ emitted: boolean }>;
}

/** 商家提交的三类审核（库的 CHECK：review ⇔ 这三个 kind） */
const REVIEW_KINDS: readonly ApprovalKind[] = ["qualification", "channel_account", "launch_link"];
/** 各类型的单号前缀（库的 CHECK ck_approval_request_request_no）；没列的没有单号 */
const NUMBER_PREFIX: Partial<Record<ApprovalKind, ApprovalNumberPrefix>> = {
  order_cancel: "TK",
  ad_cancel: "TK",
  qualification_cancel: "TK",
  plan_refund: "TK",
  points_adjust: "TZ",
  subscription_extend: "YQ",
  account_change: "ZH",
};
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

/** 取出装配结果里的审批类型登记，对照 03 分组 第 3.2 节的对照表校验。库的 CHECK 也会挡，这里是早一步、一次报全 */
export function approvalKindsOf(
  assembly: Pick<Assembly, "portEntries">,
): ReadonlyMap<string, ApprovalKindRegistration> {
  const kinds = assembly.portEntries(approvalKindPort);
  const problems: string[] = [];
  for (const [key, kind] of kinds) {
    if (!(APPROVAL_KIND.values as readonly string[]).includes(key)) {
      problems.push(`${key}：不是审批类型（approval_request.kind 的 12 个取值之一）`);
      continue;
    }
    const review = REVIEW_KINDS.includes(key as ApprovalKind);
    if ((kind.category === "review") !== review) {
      problems.push(`${key}：大类应是 ${review ? "review" : "approval"}`);
    }
    const executes = (APPROVAL_EXECUTION_KINDS as readonly string[]).includes(key);
    if (kind.hasExecution !== executes) {
      problems.push(`${key}：${executes ? "有" : "没有"}执行步`);
    }
    if ((kind.dedupeKey === undefined) !== executes) {
      problems.push(`${key}：有执行步的类型不给在途去重键，其余必给`);
    }
    const prefix = NUMBER_PREFIX[key as ApprovalKind] ?? null;
    if (kind.numberPrefix !== prefix) problems.push(`${key}：单号前缀应是 ${String(prefix)}`);
    if (!IDENTIFIER.test(kind.domain.table) || !IDENTIFIER.test(kind.domain.column)) {
      problems.push(`${key}：领域表名或列名的写法不对`);
    }
    if (kind.viewModules.length === 0) problems.push(`${key}：没写查看所需的模块`);
  }
  if (problems.length > 0) {
    throw new ApprovalError(
      "registry",
      `审批类型的登记有 ${problems.length} 处不对：${problems.join("；")}`,
    );
  }
  return kinds;
}

export function createApproval(options: ApprovalOptions): Approval {
  if ((options.sla === undefined) !== (options.timers === undefined)) {
    throw new TypeError("approval 的 sla 与 timers 必须成对注入");
  }
  const kinds = approvalKindsOf(options.assembly);
  bindApprovalKinds(kinds);
  const deps: ApprovalDeps = {
    clock: options.clock,
    flow: options.flow,
    events: options.events,
    bizNo: options.bizNo,
    kinds,
    fresh: new WeakMap(),
    ...(options.sla === undefined || options.timers === undefined
      ? {}
      : {
          sla: {
            flow: options.flow,
            clock: options.clock,
            events: options.events,
            sla: options.sla,
            timers: options.timers,
            kinds,
          },
        }),
  };
  return {
    ...createApprovalReads({ kinds, clock: options.clock }),
    kinds,
    touchPending: (tx, input) => touchPending(tx, deps, input),
    submit: (tx, ctx, input) => submit(tx, deps, ctx, input),
    approve: (tx, ctx, input) => approve(tx, deps, ctx, input),
    reject: (tx, ctx, input) => reject(tx, deps, ctx, input),
    withdraw: (tx, ctx, input) => withdraw(tx, deps, ctx, input),
    recordExecuted: (tx, ctx, input) => recordExecuted(tx, deps, ctx, input),
  };
}
