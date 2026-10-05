// emit（W0-15）：在业务事务里发一条出站事件。校验事件名、聚合、载荷 → 从身份上下文填信封 → 带去重的插入。
// 依据：x01 第 2.1、2.3 节；01 分组 第 2.3 节；01 第 5、7.1 节。
//
//   1. 第一个参数是事务句柄：事件行与业务写同一事务，业务回滚事件也没了。
//   2. 信封列在这里统一填，载荷里不重复；发生时间取注入的时钟，主键是 UUID v7。
//   3. 去重键冲突即该事实已发过：不插、不报错，返回 emitted: false，业务事务照常提交。
//   4. 校验不过都是代码缺陷（不是用户输入）：抛 EventEmitError，不落库。P5 的禁止内容不在这里扫，由各域 schema 的评审把关。
import type { EventPayloadName, EventPayloadOf } from "@liyoxi/contract";
import { matchesFormat, NAME_FORMATS } from "@liyoxi/contract/registry";

import { actorColumns, isUuid, uuidv7 } from "../kernel/index.js";
import type { Clock, IdentityContext, Tx } from "../kernel/index.js";
import type { EventCatalog } from "./catalog.js";
import { insertEvent } from "./repo.js";

export type EmitRefusal =
  "unknown_event" | "not_emitted" | "aggregate" | "tenant" | "no_schema" | "payload" | "dedupe_key";

/** emit 拒发：事件没登记、不是“发出”状态、聚合不对、没交 schema、载荷不合 schema、去重键不对 */
export class EventEmitError extends Error {
  readonly reason: EmitRefusal;
  readonly eventType: string;

  constructor(reason: EmitRefusal, eventType: string, message: string) {
    super(`事件 ${JSON.stringify(eventType)} 没有发出：${message}`);
    this.name = "EventEmitError";
    this.reason = reason;
    this.eventType = eventType;
  }
}

/**
 * 身份上下文之外，信封还要客户端平台与版本（请求头 X-Client-Platform、X-Client-Version）。
 * kernel 的 IdentityContext 现在没有这两个字段：带了就写，没带写空；系统动作一律写空。
 */
export type EmitContext = IdentityContext & {
  readonly clientPlatform?: string | null;
  readonly clientVersion?: string | null;
};

export interface EmitInput<N extends string = string> {
  /** 事件名：契约事件目录里状态为“发出”的 */
  readonly type: N;
  /** 聚合：类型是最终表名，要在这个事件登记的聚合之内；不带聚合的事件不写 */
  readonly aggregate?: { readonly type: string; readonly id: string } | null;
  /** 载荷 { v: 数字, … }，按这个事件的 schema 校验 */
  readonly payload: N extends EventPayloadName
    ? EventPayloadOf<N>
    : Readonly<Record<string, unknown>>;
  /** 去重键：同一事实只应发一次时写（取法见 x01 第 2.3 节），其余不写 */
  readonly dedupeKey?: string | null;
  /** 所属主体、门店：不写即取身份上下文的 */
  readonly entityId?: string | null;
  readonly storeId?: string | null;
}

export interface EmitResult {
  /** 是否真的写入；false 即去重键已发过，被跳过 */
  readonly emitted: boolean;
  /** 写入的事件 id；被跳过时为空 */
  readonly id: string | null;
}

export interface EmitDeps {
  readonly clock: Clock;
  readonly catalog: EventCatalog;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasVersion = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && typeof value["v"] === "number";

export async function emitEvent<const N extends string>(
  tx: Tx,
  deps: EmitDeps,
  ctx: EmitContext,
  input: EmitInput<N>,
): Promise<EmitResult> {
  const refuse: (reason: EmitRefusal, message: string) => never = (reason, message) => {
    throw new EventEmitError(reason, input.type, message);
  };

  const definition = deps.catalog.get(input.type);
  if (definition === undefined) {
    return refuse("unknown_event", "不在契约的事件目录里（新事件先登记，x01 第 2.1 节 N7）");
  }
  if (definition.status !== "v1") {
    refuse("not_emitted", `目录里它的状态是 ${definition.status}（不发或预留）`);
  }

  const aggregate = input.aggregate ?? null;
  if (aggregate === null) {
    if (definition.aggregates.length > 0) {
      refuse("aggregate", `要带聚合（${definition.aggregates.join("、")}）`);
    }
  } else if (
    !matchesFormat(NAME_FORMATS.aggregateType, aggregate.type) ||
    !definition.aggregates.includes(aggregate.type)
  ) {
    refuse("aggregate", `聚合类型 ${JSON.stringify(aggregate.type)} 不在这个事件登记的聚合之内`);
  } else if (!isUuid(aggregate.id)) {
    refuse("aggregate", "聚合 id 要是小写的 UUID");
  }

  const entityId = input.entityId === undefined ? ctx.entityId : input.entityId;
  const storeId = input.storeId === undefined ? ctx.storeId : input.storeId;
  if ([entityId, storeId].some((id) => id !== null && !isUuid(id))) {
    refuse("tenant", "所属主体、门店要是小写的 UUID");
  }
  if (storeId !== null && entityId === null) refuse("tenant", "有门店必有主体");

  if (definition.schema === undefined) {
    return refuse("no_schema", "还没有交载荷 schema（先在契约的事件载荷目录里交）");
  }
  if (!hasVersion(input.payload)) refuse("payload", "载荷要是对象，且带数字的 v");
  const parsed = definition.schema.safeParse(input.payload);
  if (!parsed.success) return refuse("payload", `载荷不合 schema：${parsed.error.message}`);
  if (!hasVersion(parsed.data)) return refuse("payload", "schema 校验后的载荷没有数字的 v");

  const dedupeKey = input.dedupeKey ?? null;
  if (dedupeKey !== null && (typeof dedupeKey !== "string" || dedupeKey.trim() === "")) {
    refuse("dedupe_key", "去重键写了就不得为空");
  }

  const id = uuidv7();
  const system = ctx.actor.type === "system";
  const emitted = await insertEvent(tx, {
    id,
    eventType: input.type,
    aggregateType: aggregate?.type ?? null,
    aggregateId: aggregate?.id ?? null,
    entityId,
    storeId,
    payload: parsed.data,
    ...actorColumns(ctx.actor),
    actorRole: ctx.actor.role,
    clientPlatform: system ? null : (ctx.clientPlatform ?? null),
    clientVersion: system ? null : (ctx.clientVersion ?? null),
    requestId: ctx.requestId,
    occurredAt: deps.clock.now(),
    dedupeKey,
  });
  return { emitted, id: emitted ? id : null };
}
