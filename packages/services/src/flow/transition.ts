// flow.transition（W0-16）：25 张业务状态机表的状态只有这一个入口。
// 依据：03 第 3.1 节；06 第 3.4、5 节；01 分组 第 2.6 节；03 分组 第 2.10 节“迁移与审计行”；x01 第 2.3 节 P4、第 2.4 节 E1、E2；约定 C27、C53。
//
// 步骤固定，全在调用方的同一个事务里（第一个参数是事务句柄，自己不开事务）：
//   加锁 → 查迁移表 → 守卫 → 改状态 → 写状态历史 → 副作用 → 写审计 → 发事件
// 任何一步抛错，调用方的事务回滚，四处（状态列、历史、审计、事件）都不留痕。
//
// 两类错误分开：
//   业务上的拒绝：当前状态下这个事件不能发生、守卫不满足 → AppError("STATE_NOT_ALLOWED")（409）或守卫抛的领域码。
//   代码缺陷：事件码不在这条链上、行标了守卫没登记实现、没给审计或事件、工作分钟端口没注册…… → FlowError。
import type { AuditTargetType, EventPayloadName, EventPayloadOf } from "@liyoxi/contract";
import { ADMIN_FORCE_EVENT, checkTransition, findChain } from "@liyoxi/shared/machines";
import type { TransitionRow } from "@liyoxi/shared/machines";
import { calendarDate } from "@liyoxi/shared/time";

import { record as recordAudit } from "../audit/index.js";
import type { AuditEntry, AuditRequestMeta } from "../audit/index.js";
import type { EmitContext, EmitInput, Events } from "../events/index.js";
import { actorColumns, AppError, isUuid, lockRows, uuidv7 } from "../kernel/index.js";
import type { Clock, Tx } from "../kernel/index.js";
import {
  NO_ACTIVITY_MACHINES,
  rowKey,
  UNREGISTERED_WORK_MINUTES,
  WORK_MINUTE_MACHINES,
} from "./bindings.js";
import type { ChainRef, MachineBinding, TransitionFacts, WorkMinutes } from "./bindings.js";
import { FlowError } from "./errors.js";
import type { FlowRefusal } from "./errors.js";
import { insertTransition, selectLastTransition, selectState, updateState } from "./repo.js";

/** 事件载荷里由 flow 补的三个迁移键（x01 第 2.3 节 P4）：用例的载荷不用写它们 */
export type TransitionKeys = "fromState" | "toState" | "transition";

/** 随这次迁移发的出站事件。事件名是出站事件名，与迁移事件码是两套名字（x01 第 2.1 节 N4） */
export interface TransitionEvent<N extends string = string> {
  readonly type: N;
  /** { v: 1, … }，三个迁移键由 flow 补上之后按这个事件的 schema 校验 */
  readonly payload: N extends EventPayloadName
    ? Omit<EventPayloadOf<N>, TransitionKeys>
    : Readonly<Record<string, unknown>>;
  /** 聚合：不写即迁移的对象（表名与 id）；事件不带聚合的写 null */
  readonly aggregate?: { readonly type: string; readonly id: string } | null;
  readonly dedupeKey?: string | null;
}

/** 从属迁移：随主迁移联动，同一事实已由主事件表达，不另发（x01 第 2.4 节 E2）。primary 写明主事件名 */
export interface NoEvent {
  readonly none: true;
  readonly primary: string;
}

/** 并入别的审计行：随审批单联动的领域行迁移，并入审批单那一行，不另写（03 分组 第 2.10 节第 3 条） */
export interface MergedAudit {
  readonly mergedInto: { readonly approvalRequestId: string };
}

export type TransitionInput<N extends string = string> = ChainRef & {
  /** 对象行的 id */
  readonly id: string;
  /** 迁移事件码（status_transition.event） */
  readonly event: string;
  /** 新状态：候选只有一个时不用给 */
  readonly to?: string;
  /** 文档行（分组:行号）：同一组“当前状态、事件码、新状态”来自几行文档时必须给，守卫与副作用按它取 */
  readonly ref?: string;
  /**
   * 对象新建：业务行已由用例按初始状态插入，这里只校验初始状态合法，写历史、审计、事件。
   * 只用于本事务刚插入的行：它不加锁，只查“这条链还没有历史”，对早已提交的行并发地传它会写出两行“第一行”
   */
  readonly created?: boolean;
  /** 随迁列 → 值，与状态在同一条 UPDATE 里写。列要先在状态机登记的 companions 里 */
  readonly set?: Readonly<Record<string, unknown>>;
  readonly reasonCode?: string | null;
  readonly note?: string | null;
  /** 状态历史的载荷摘要（版本号、轮次、数量、暂停原因等） */
  readonly payload?: Readonly<Record<string, unknown>> | null;
  /** 所属主体、门店：不写即取身份上下文的（员工替商家操作时另给） */
  readonly entityId?: string | null;
  readonly storeId?: string | null;
  /** 审计：传内容即只写这一行（stream 由用例定）；声明并入即不写；不传即补一条 activity 行 */
  readonly audit?: AuditEntry | MergedAudit;
  /** 请求元信息（登录方式、会话等）；不给即从身份上下文取请求号、IP、UA，其余写空 */
  readonly meta?: AuditRequestMeta;
  /** 事件：必写。从属迁移写 { none: true, primary } */
  readonly emit: TransitionEvent<N> | NoEvent;
  /** 随迁移传给守卫与副作用的东西 */
  readonly args?: unknown;
};

export interface TransitionResult {
  /** 写下的那一行状态历史的 id */
  readonly id: string;
  readonly from: string | null;
  readonly to: string;
  readonly ref: string;
  /** 写下的审计行；并入别的行时为空 */
  readonly auditId: string | null;
  /** 写下的事件；没发（从属迁移）或被去重键跳过时为空 */
  readonly eventId: string | null;
}

export interface TransitionDeps {
  readonly clock: Clock;
  readonly events: Pick<Events, "emit">;
  readonly bindings: ReadonlyMap<string, MachineBinding>;
  readonly workMinutes: WorkMinutes;
  /** 状态机表各有哪些列；runtime 里按进程缓存 */
  readonly columns: (tx: Tx) => Promise<ReadonlyMap<string, ReadonlySet<string>>>;
  /** 各事务里经 created 新建的行（“表:id”）：同一事务里它们之后的迁移也不加锁 */
  readonly fresh: WeakMap<Tx, Set<string>>;
}

function refuse(reason: FlowRefusal, message: string): never {
  throw new FlowError(reason, message);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function transition<const N extends string>(
  tx: Tx,
  deps: TransitionDeps,
  ctx: EmitContext,
  input: TransitionInput<N>,
): Promise<TransitionResult> {
  const { machine, stateField, id, event } = input;
  const name = `${machine}.${stateField}`;
  const chain = findChain(machine, stateField) ?? refuse("unknown_chain", `迁移表里没有 ${name}`);
  if (!isUuid(id)) refuse("unknown_chain", "对象 id 要是小写的 UUID");
  if (event === ADMIN_FORCE_EVENT) refuse("unknown_event", "人工纠偏不走 transition()");
  if (!chain.rows.some((row) => row.event === event)) {
    refuse("unknown_event", `${name} 上没有事件码 ${JSON.stringify(event)}`);
  }
  // 审计与事件都不能靠缺省：先查，免得写到一半才发现
  const emit = input.emit as TransitionEvent | NoEvent | undefined;
  if (!isPlainObject(emit) || ("none" in emit ? !emit.primary : !emit.type)) {
    refuse(
      "event_required",
      "既没传事件，也没声明不发（从属迁移写 { none: true, primary: 主事件名 }）",
    );
  }
  if (input.audit === undefined && NO_ACTIVITY_MACHINES.includes(machine)) {
    refuse("audit_required", `${machine} 的迁移不补 activity 行，审计内容由用例传入`);
  }
  const payload = input.payload ?? null;
  if (payload !== null && !isPlainObject(payload)) refuse("payload", "状态历史的载荷要是对象");
  const created = input.created === true;
  const set = input.set ?? {};
  if (created && Object.keys(set).length > 0)
    refuse("created", "新建时业务行由用例插入，不带随迁列");
  const binding = deps.bindings.get(name) ?? {};
  const timed = WORK_MINUTE_MACHINES.includes(machine);
  if (timed && deps.workMinutes === UNREGISTERED_WORK_MINUTES) {
    refuse("work_minutes", `${machine} 要写 elapsed_work_min，而工作分钟端口还没有模块注册`);
  }

  // 1. 加锁：对象行 FOR UPDATE，过锁序断言；调用方已经锁过的再锁一遍是幂等的。
  //    新建的行是本事务刚插入的，别的事务看不见：不加锁，也不进锁序；同一事务里它之后的迁移同理
  const rowId = `${machine}:${id}`;
  const mine = created || deps.fresh.get(tx)?.has(rowId) === true;
  const present = mine || (await lockRows(tx, machine, [id], "update")).length > 0;
  const current = present ? await selectState(tx, machine, stateField, id) : undefined;
  if (current === undefined) throw new AppError("NOT_FOUND");

  // 2. 查迁移表。新建：当前状态记作“无”，业务行里已有的值就是目标
  const from = created ? null : current;
  if (created && input.to !== undefined && input.to !== current) {
    refuse("created", `新建的目标 ${input.to} 与业务行的当前值 ${current} 不一致`);
  }
  const check = checkTransition(chain, { from, event, to: created ? current : input.to });
  if (!check.ok) {
    if (check.reason === "target_required") {
      refuse(
        "ambiguous",
        `${name} 的 ${event} 有几个新状态可去（${check.candidates.join("、")}），要给 to`,
      );
    }
    throw new AppError("STATE_NOT_ALLOWED", {
      details: { machine, stateField, state: from, event, reason: check.reason },
    });
  }
  const to = check.to;
  const row = pickRow(name, event, check.rows, input.ref);

  const now = deps.clock.now();
  const entityId = input.entityId === undefined ? ctx.entityId : input.entityId;
  const storeId = input.storeId === undefined ? ctx.storeId : input.storeId;
  const facts: TransitionFacts = {
    machine,
    stateField,
    subjectId: id,
    from,
    to,
    event,
    ref: row.ref,
    now,
    ctx,
    entityId,
    storeId,
    reasonCode: input.reasonCode ?? null,
    note: input.note ?? null,
    payload,
    args: input.args,
  };

  // 3. 守卫：行标了守卫而没有登记实现，不放行
  const key = rowKey(row.ref, row.event);
  const guard = binding.guards?.[key];
  if (guard === undefined && row.guard) {
    refuse(
      "guard_missing",
      `${name} 的 ${row.ref}（${event}）写了守卫，拥有它的模块还没有登记实现`,
    );
  }
  if (guard !== undefined && !(await guard(tx, facts))) {
    throw new AppError("STATE_NOT_ALLOWED", {
      details: { machine, stateField, state: from, event, reason: "guard" },
    });
  }

  // 4. 改状态（新建时业务行已是目标状态，不改）
  if (!created) {
    const columns = (await deps.columns(tx)).get(machine) ?? new Set<string>();
    for (const column of Object.keys(set)) {
      if (!(binding.companions ?? []).includes(column) || !columns.has(column)) {
        refuse("column", `${name} 的随迁列 ${JSON.stringify(column)} 没有登记，或库里没有这一列`);
      }
    }
    await updateState(tx, {
      machine,
      stateField,
      id,
      to,
      now,
      bumpVersion: columns.has("lock_version"),
      touch: columns.has("updated_at"),
      set,
    });
  }

  // 5. 状态历史：恰一行。停留时长取同一链上一行起算，链的第一行为空
  const previous = await selectLastTransition(tx, machine, id, stateField);
  if (created && previous !== undefined)
    refuse("created", `${name} 的这个对象已经有状态历史，不是新建`);
  if (created) deps.fresh.set(tx, (deps.fresh.get(tx) ?? new Set<string>()).add(rowId));
  const elapsedMs = previous === undefined ? null : now.getTime() - previous.occurredAt.getTime();
  let elapsedWorkMin: number | null = null;
  if (timed && elapsedMs !== null && elapsedMs <= 0)
    elapsedWorkMin = 0; // 时钟回拨：记 0，不去问端口
  else if (timed && previous !== undefined) {
    elapsedWorkMin = await deps.workMinutes.between(tx, {
      machine,
      from: previous.occurredAt,
      to: now,
    });
    if (!Number.isInteger(elapsedWorkMin) || elapsedWorkMin < 0) {
      refuse("work_minutes", `工作分钟端口返回了 ${String(elapsedWorkMin)}，要的是非负整数`);
    }
  }
  const historyId = uuidv7();
  await insertTransition(tx, {
    id: historyId,
    machine,
    subjectId: id,
    stateField,
    entityId,
    storeId,
    fromState: from,
    toState: to,
    event,
    ...actorColumns(ctx.actor),
    reasonCode: facts.reasonCode,
    note: facts.note,
    payload,
    occurredAt: now,
    bizDate: calendarDate(now),
    elapsedSeconds: elapsedMs === null ? null : Math.max(0, Math.floor(elapsedMs / 1000)),
    elapsedWorkMin,
    requestId: ctx.requestId,
  });

  // 6. 副作用
  await binding.effects?.[key]?.(tx, facts);

  // 7. 审计：恰一行（并入别的行的除外）
  const auditId = await writeAudit(tx, ctx, input, binding, facts);

  // 8. 事件：补上三个迁移键再发
  let eventId: string | null = null;
  if (!("none" in emit)) {
    const emitted = await deps.events.emit(tx, ctx, {
      type: emit.type,
      aggregate: emit.aggregate === undefined ? { type: machine, id } : emit.aggregate,
      payload: { ...emit.payload, fromState: from, toState: to, transition: event },
      dedupeKey: emit.dedupeKey,
      entityId,
      storeId,
    } as EmitInput);
    eventId = emitted.id;
  }
  return { id: historyId, from, to, ref: row.ref, auditId, eventId };
}

/** 放行这次迁移的行里取一行：只有一行就是它；有几行时按用例给的 ref 取 */
function pickRow(
  name: string,
  event: string,
  rows: readonly TransitionRow[],
  ref: string | undefined,
): TransitionRow {
  const matched = ref === undefined ? rows : rows.filter((row) => row.ref === ref);
  const [row, ...rest] = matched;
  if (row === undefined) {
    return refuse("ambiguous", `${name} 的 ${event}：文档行 ${String(ref)} 不放行这次迁移`);
  }
  if (rest.length > 0) {
    const refs = rows.map((item) => item.ref).join("、");
    return refuse("ambiguous", `${name} 的 ${event} 有几行文档都放行（${refs}），要给 ref`);
  }
  return row;
}

async function writeAudit(
  tx: Tx,
  ctx: EmitContext,
  input: Pick<TransitionInput, "audit" | "meta">,
  binding: MachineBinding,
  facts: TransitionFacts,
): Promise<string | null> {
  const { audit } = input;
  if (audit !== undefined && "mergedInto" in audit) return null;
  const meta: AuditRequestMeta = input.meta ?? {
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    authMethod: null,
    sessionId: null,
  };
  if (audit !== undefined) return (await recordAudit(tx, ctx.actor, meta, audit)).id;
  const described = binding.activity?.(facts) ?? null;
  if (described === null) {
    return refuse(
      "audit_required",
      `${facts.machine}.${facts.stateField} 的 ${facts.event} 没传审计内容，状态机也没有登记活动流默认描述`,
    );
  }
  const scope = facts.entityId === null ? {} : { entityId: facts.entityId, storeId: facts.storeId };
  const recorded = await recordAudit(tx, ctx.actor, meta, {
    stream: "activity",
    category: described.category,
    action: described.action,
    summary: described.summary,
    // 对象类型要在契约的 AUDIT_TARGET_TYPES 里；没登记的由 audit.record 拒绝
    target: {
      type: facts.machine as AuditTargetType,
      id: facts.subjectId,
      label: described.targetLabel,
    },
    ...scope,
  });
  return recorded.id;
}
