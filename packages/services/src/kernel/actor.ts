// 操作人与身份上下文（W0-07）：“谁在操作”的统一类型，幂等、审计、状态历史、出站事件都用它。
// 只有类型与构造函数，不含鉴权链：能力点、权限点、数据范围在 M1 的 authz。
// 依据：06 第 3.3 节；01 分组 第 2.1、2.3 节（actor_key 的写法、操作人几列的 CHECK）。取值只从契约的枚举来。
// 不合法的组合在构造时就拦住：系统动作没有操作人 id 与客户端来源；其余类型必有操作人 id；角色快照只属于商家。
import { ACTOR_TYPE, AUDIT_LOG_CLIENT, MERCHANT_ROLE } from "@liyoxi/contract/enums";
import type { ActorType, Client, EnumValue, MerchantRole } from "@liyoxi/contract/enums";

import { isUuid } from "./ids.js";

/**
 * 客户端来源：weapp、portal、admin，另有 cli（运维命令行以员工身份执行）。
 * cli 只有审计日志的 client 列收；写别的表用 actorColumns，它把 cli 写成空。
 * portal 是客户端来源，不是操作人类型：下载页的请求，操作人是商家用户。
 */
export type ActorClient = EnumValue<typeof AUDIT_LOG_CLIENT>;

interface PersonActor<T extends ActorType, R> {
  readonly type: T;
  /** 操作人 id：商家用户或员工的 id */
  readonly id: string;
  readonly client: ActorClient;
  /** 商家角色快照（owner、clerk）：只属于商家；还没有成员身份时为空 */
  readonly role: R;
}

export type MerchantActor = PersonActor<"merchant", MerchantRole | null>;
/** partner 在 V1.0 只声明、不写入 */
export type StaffActor = PersonActor<"staff" | "partner", null>;
export interface SystemActor {
  readonly type: "system";
  readonly id: null;
  readonly client: null;
  readonly role: null;
  /** 任务名：定时器、回调、订阅者、周期任务的名字，进 actor_key */
  readonly job: string;
}
export type Actor = MerchantActor | StaffActor | SystemActor;

export interface ActorInput {
  type: ActorType;
  id?: string | null;
  client?: ActorClient | null;
  role?: MerchantRole | null;
  job?: string | null;
}

/** 任务名：小写字母开头，可带数字与 . _ : -，不超过 64 个字符 */
const JOB = /^[a-z][a-z0-9._:-]{0,63}$/;

const oneOf = (values: readonly string[], value: string | null): boolean =>
  value === null || values.includes(value);

function refuse(reason: string): never {
  throw new TypeError(`操作人或身份上下文不合法：${reason}`);
}

/** 构造操作人。组合不合法即抛 TypeError；返回的对象是冻结的 */
export function createActor(input: ActorInput): Actor {
  const { type, id = null, client = null, role = null, job = null } = input;
  if (!ACTOR_TYPE.values.includes(type)) {
    refuse(`操作人类型只能是 ${ACTOR_TYPE.values.join("、")}`);
  }
  if (!oneOf(AUDIT_LOG_CLIENT.values, client)) {
    refuse(`客户端来源只能是 ${AUDIT_LOG_CLIENT.values.join("、")}`);
  }
  if (!oneOf(MERCHANT_ROLE.values, role)) {
    refuse(`角色快照只能是 ${MERCHANT_ROLE.values.join("、")}`);
  }
  if (role !== null && type !== "merchant") refuse("角色快照只属于商家");
  if (type === "system") {
    if (id !== null || client !== null) refuse("系统动作没有操作人 id 与客户端来源");
    if (job === null || !JOB.test(job)) refuse("系统动作要给任务名（小写字母开头，进 actor_key）");
    return Object.freeze({ type, id: null, client: null, role: null, job });
  }
  if (id === null || !isUuid(id)) refuse(`${type} 必有操作人 id（小写的 UUID）`);
  if (client === null) refuse(`${type} 必有客户端来源；运维命令行写 cli`);
  if (job !== null) refuse("任务名只属于系统动作");
  return type === "merchant"
    ? Object.freeze({ type, id, client, role })
    : Object.freeze({ type, id, client, role: null });
}

/** actor_key：<类型>:<操作人 id>；系统动作是 system:<任务名>（01 分组 第 2.1 节） */
export const actorKey = (actor: Actor): string =>
  `${actor.type}:${actor.type === "system" ? actor.job : actor.id}`;

/** 写进普通表的操作人三列。cli 只有审计日志收，这里写空（01 分组 第 2.3 节） */
export function actorColumns(actor: Actor): {
  actorType: ActorType;
  actorId: string | null;
  client: Client | null;
} {
  const client = actor.client === "cli" ? null : actor.client;
  return { actorType: actor.type, actorId: actor.id, client };
}

/** 身份上下文：操作人、归属、请求元信息。用例函数从路由或任务处理器拿到它，往下传 */
export interface IdentityContext {
  readonly actor: Actor;
  /** 归属的主体；平台级或主体未知时为空 */
  readonly entityId: string | null;
  /** 归属的门店；有门店必有主体 */
  readonly storeId: string | null;
  /** 请求编号（X-Request-Id）；任务处理器沿用触发它的那个请求的编号 */
  readonly requestId: string | null;
  readonly ip: string | null;
  /** 客户端标识（User-Agent） */
  readonly userAgent: string | null;
}

export type IdentityContextInput = { actor: ActorInput } & Partial<Omit<IdentityContext, "actor">>;

/** 构造身份上下文：操作人按 createActor 再过一遍；归属不合法即抛 TypeError */
export function createIdentityContext(input: IdentityContextInput): IdentityContext {
  const { entityId = null, storeId = null, requestId = null, ip = null, userAgent = null } = input;
  for (const [name, value] of Object.entries({ entityId, storeId })) {
    if (value !== null && !isUuid(value)) refuse(`${name} 要是小写的 UUID`);
  }
  if (storeId !== null && entityId === null) refuse("有门店必有主体");
  const actor = createActor(input.actor);
  return Object.freeze({ actor, entityId, storeId, requestId, ip, userAgent });
}
