// 审批类型的登记（W1-06）：按键端口 approval.kind，键是 approval_request.kind。
// 依据：03 分组 第 2.12 节“处理器约定”、第 3.2 节的对照表；01 第 5 节调用规则 5；a01 第 2.10 节。
// 拥有领域表的模块在自己的 register.ts 里登记：
//
//   portImplementations: [implementKeyed(approvalKindPort, "qualification", defineApprovalKind({ … }))]
//
// 六个处理器都在审批单迁移的同一个事务里调，第一个参数是事务句柄；领域行由处理器自己锁（次序在审批单之后）。
// 没登记的 kind 调 submit 即抛内部错误。登记写得对不对（键、大类、单号前缀、去重键）在 createApproval 时一次查全。
import type {
  ApprovalCategory,
  ApprovalExecutionKind,
  ApprovalKind,
  ApprovalStatus,
  ApprovalSummary,
} from "@liyoxi/contract";
import type { AdminModuleKey, PermissionKey } from "@liyoxi/contract/authz";

import { defineKeyedPort } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";

/** 审批单有单号的四种前缀（03 分组 第 2.12 节 request_no） */
export type ApprovalNumberPrefix = "TK" | "TZ" | "YQ" | "ZH";

/** 提交人类型（approval_request.submit_actor_type；partner 在 V1.0 只声明） */
export type ApprovalSubmitActorType = "merchant" | "staff" | "system" | "partner";

/** 审批单的一行：处理器与守卫读到的样子。提交时确定的列创建后不变（库里有触发器） */
export interface ApprovalRow {
  readonly id: string;
  readonly requestNo: string | null;
  readonly kind: ApprovalKind;
  readonly category: ApprovalCategory;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly entityId: string | null;
  readonly storeId: string | null;
  readonly deliveryTicketId: string | null;
  readonly roundNo: number;
  readonly status: ApprovalStatus;
  readonly summary: ApprovalSummary;
  readonly reasonCodes: readonly string[];
  readonly decisionNote: string | null;
  readonly submitActorType: ApprovalSubmitActorType;
  readonly submitActorId: string | null;
  readonly requesterStaffId: string | null;
  readonly requesterStaffGroupId: string | null;
  readonly submittedAt: Date;
  readonly dueAt: Date | null;
  readonly slaSnapshot: unknown;
  readonly decidedByStaffId: string | null;
  readonly isDecidedBySystem: boolean;
  readonly decidedAt: Date | null;
  readonly dedupeKey: string | null;
  readonly lockVersion: number;
}

/** 提交时交给处理器的东西。approvalId 已经定好：领域行可以先引用它，审批单在处理器之后插入 */
export interface ApprovalSubmission<I = unknown> {
  readonly approvalId: string;
  readonly kind: ApprovalKind;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly entityId: string | null;
  readonly storeId: string | null;
  readonly deliveryTicketId: string | null;
  /** 领域用例随提交传给处理器的东西（领域行的 id、申请的数额等），本模块不看 */
  readonly input: I;
}

/** 一次决定：处理器据此知道是谁、怎么决定的 */
export interface ApprovalDecision {
  /** 通过或驳回的员工；系统决定、撤回时为空 */
  readonly decidedByStaffId: string | null;
  readonly isDecidedBySystem: boolean;
  readonly decidedAt: Date;
  readonly note: string | null;
  readonly reasonCodes: readonly string[];
  /** 领域用例随决定传给处理器的东西，本模块不看 */
  readonly args: unknown;
}

/** 该类型的领域接口（a01 第 2.10 节的表），不适用的写 null */
export interface ApprovalOperations {
  readonly get: string | null;
  readonly approve: string | null;
  readonly reject: string | null;
  readonly withdraw: string | null;
}

export interface ApprovalExecutionSlaFacts {
  readonly status: string;
  readonly dueAt: Date | null;
  /** 是否已建立过真实执行交易，失败回待执行也不重新计时。 */
  readonly hasExecuted: boolean;
}

export interface ApprovalKindRegistration<I = unknown> {
  /** 有执行步的领域所属模块提供真实执行事实；尚无 producer 的类型不得伪造。 */
  readonly executionSla?: (tx: Tx, row: ApprovalRow) => Promise<ApprovalExecutionSlaFacts | null>;
  /** review：商家提交的审核，审计写 activity 流；approval：员工发起的审批，写 ops 流 */
  readonly category: ApprovalCategory;
  /** 一对一的领域表与它指向审批单的列（approval.I1 据此核对） */
  readonly domain: { readonly table: string; readonly column: string };
  /** 查看所需的模块等级：这些模块里有一个不低于“查看”即可读（读侧用） */
  readonly viewModules: readonly AdminModuleKey[];
  /** 决定权限点。“仅主管”已算在员工上下文生效的权限点里 */
  readonly decidePermission: PermissionKey;
  /** 仅限发起人所在组的主管审批（补偿延长）；超级管理员是兜底审批人，不受它限制 */
  readonly groupBound: boolean;
  /** 角色队列（账号核验）：持决定权限点即全量可见、可决定，不套数据范围 */
  readonly roleQueue?: boolean;
  /** 有执行步：审批单停在 approved，执行是领域用例的另一个事务，成功后调 recordExecuted */
  readonly hasExecution: boolean;
  /** 单号前缀；没有单号的类型写 null */
  readonly numberPrefix: ApprovalNumberPrefix | null;
  /** 在途去重键 kind:对象。没有执行步的类型必给，有执行步的不给（在途唯一由领域表表达） */
  readonly dedupeKey?: (submission: ApprovalSubmission<I>) => string;
  /** 第几次提交；不给即 1。审核类取领域轮次行的轮次 */
  readonly roundNo?: (tx: Tx, submission: ApprovalSubmission<I>) => Promise<number>;
  readonly operations: ApprovalOperations;
  /** 提交前校验：不满足抛 AppError */
  readonly validate: (tx: Tx, submission: ApprovalSubmission<I>) => Promise<void>;
  /** 生成展示摘要：已脱敏；不放领域内容与敏感明文。提交后不再变 */
  readonly summarize: (tx: Tx, submission: ApprovalSubmission<I>) => Promise<ApprovalSummary>;
  /** 通过前按当前数据重算业务前提：已变化即抛 AppError("PRECONDITION_CHANGED")，审批单保持 pending */
  readonly revalidate: (tx: Tx, row: ApprovalRow, args: unknown) => Promise<void>;
  /** 通过：没有执行步的类型在这里生效；有执行步的把领域行推到待执行 */
  readonly onApproved: (tx: Tx, row: ApprovalRow, decision: ApprovalDecision) => Promise<void>;
  /** 驳回：关闭领域行、清掉随审批结束要清的数据 */
  readonly onRejected: (tx: Tx, row: ApprovalRow, decision: ApprovalDecision) => Promise<void>;
  /** 撤回：同上 */
  readonly onWithdrawn: (tx: Tx, row: ApprovalRow, decision: ApprovalDecision) => Promise<void>;
  /** 读队列时从领域表派生的角标（比对异常、终局驳回）；读侧用，可不给 */
  readonly badges?: (tx: Tx, row: ApprovalRow) => Promise<readonly string[]>;
  /** 当前处理人（链接核验取所属工单的发布专员）。不给或返回 null：处理人为空，数据范围退回门店范围 */
  readonly handlerOf?: (tx: Tx, row: ApprovalRow) => Promise<string | null>;
}

/** 写登记时用它带上 input 的类型；端口里存的是不带类型参数的形状 */
export function defineApprovalKind<I>(
  registration: ApprovalKindRegistration<I>,
): ApprovalKindRegistration {
  return registration as ApprovalKindRegistration;
}

/** 审批类型的登记：按 kind 多实现。可以一个实现都没有（M1 的 a 只交框架，真实类型随各域） */
export const approvalKindPort = defineKeyedPort<ApprovalKindRegistration>("approval.kind");

export type { ApprovalCategory, ApprovalExecutionKind, ApprovalKind, ApprovalStatus };
