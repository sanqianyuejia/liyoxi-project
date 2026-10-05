// events 的仓储（W0-15）：本模块的原生 SQL 只写在这里。依据：01 分组 第 2.3、2.4 节；D3 第 20.2 节。
// 两张表都不在加锁顺序表里（lock_rank = null）：业务事务只插入事件行，中继用 FOR UPDATE SKIP LOCKED，不经 lockRows。
import type { Tx } from "../kernel/index.js";

/** 只读查询用得上的最小形状：事务句柄与 Prisma 客户端都合 */
export interface RawReader {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export interface OutboxEventRow {
  readonly id: string;
  readonly eventType: string;
  readonly aggregateType: string | null;
  readonly aggregateId: string | null;
  readonly entityId: string | null;
  readonly storeId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly client: string | null;
  readonly actorRole: string | null;
  readonly clientPlatform: string | null;
  readonly clientVersion: string | null;
  readonly requestId: string | null;
  readonly occurredAt: Date;
  readonly dedupeKey: string | null;
}

/**
 * 插入一行事件。去重键冲突（该事实已发过）时一行都不插，返回 false；不带去重键的从不冲突。
 * created_at 用库默认值；published_at 留空，等中继展开。
 */
export async function insertEvent(tx: Tx, row: OutboxEventRow): Promise<boolean> {
  const inserted = await tx.$queryRawUnsafe<unknown[]>(
    `INSERT INTO outbox_event (id, event_type, aggregate_type, aggregate_id, entity_id, store_id, payload,
       actor_type, actor_id, client, actor_role, client_platform, client_version, request_id, occurred_at, dedupe_key)
     VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6::uuid, $7::jsonb,
       $8, $9::uuid, $10, $11, $12, $13, $14, $15::timestamptz, $16)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING 1 AS inserted`,
    row.id,
    row.eventType,
    row.aggregateType,
    row.aggregateId,
    row.entityId,
    row.storeId,
    JSON.stringify(row.payload),
    row.actorType,
    row.actorId,
    row.client,
    row.actorRole,
    row.clientPlatform,
    row.clientVersion,
    row.requestId,
    row.occurredAt.toISOString(),
    row.dedupeKey,
  );
  return inserted.length > 0;
}

export interface UnpublishedEvent {
  readonly id: string;
  readonly eventType: string;
}

/** 锁住最老的若干条未展开事件；别的事务正锁着的跳过（多个中继实例各拿各的一批） */
export function lockUnpublished(tx: Tx, limit: number): Promise<UnpublishedEvent[]> {
  return tx.$queryRawUnsafe<UnpublishedEvent[]>(
    `SELECT id::text AS id, event_type AS "eventType" FROM outbox_event
     WHERE published_at IS NULL ORDER BY seq LIMIT $1::int FOR UPDATE SKIP LOCKED`,
    limit,
  );
}

/** 一对（事件, 订阅者）插一行 pending 的投递行，已有的不动；返回实际插入的行数。其余列用库默认值（数据库时间） */
export function insertDeliveries(
  tx: Tx,
  pairs: ReadonlyArray<{ eventId: string; subscriber: string }>,
): Promise<number> {
  return tx.$executeRawUnsafe(
    `INSERT INTO outbox_delivery (outbox_event_id, subscriber)
     SELECT * FROM unnest($1::uuid[], $2::text[])
     ON CONFLICT (outbox_event_id, subscriber) DO NOTHING`,
    pairs.map((pair) => pair.eventId),
    pairs.map((pair) => pair.subscriber),
  );
}

/** 把 published_at 从空写成数据库时间；返回写到的行数 */
export function markPublished(tx: Tx, eventIds: readonly string[]): Promise<number> {
  return tx.$executeRawUnsafe(
    `UPDATE outbox_event SET published_at = now() WHERE id = ANY($1::uuid[]) AND published_at IS NULL`,
    eventIds,
  );
}

/** 数据库时间 */
export async function databaseNow(db: RawReader): Promise<Date> {
  const rows = await db.$queryRawUnsafe<Array<{ now: Date }>>("SELECT now() AS now");
  return (rows[0] as { now: Date }).now;
}

export interface StaleEvent {
  readonly id: string;
  readonly eventType: string;
  readonly entityId: string | null;
  readonly occurredAt: Date;
}

/** 发生时间早于 before、仍未展开的事件，最老的在前 */
export function selectStaleEvents(tx: Tx, before: Date, limit: number): Promise<StaleEvent[]> {
  return tx.$queryRawUnsafe<StaleEvent[]>(
    `SELECT id::text AS id, event_type AS "eventType", entity_id::text AS "entityId", occurred_at AS "occurredAt"
     FROM outbox_event WHERE published_at IS NULL AND occurred_at < $1::timestamptz
     ORDER BY seq LIMIT $2::int`,
    before.toISOString(),
    limit,
  );
}

export interface StaleDelivery {
  readonly eventId: string;
  readonly subscriber: string;
  readonly status: string;
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  readonly eventType: string;
  readonly entityId: string | null;
}

/** 到期时间早于 before、仍待派发（pending、retry）的投递行；退避中的行到期时间在后面，不在其中 */
export function selectStaleDeliveries(
  tx: Tx,
  before: Date,
  limit: number,
): Promise<StaleDelivery[]> {
  return tx.$queryRawUnsafe<StaleDelivery[]>(
    `SELECT d.outbox_event_id::text AS "eventId", d.subscriber, d.status, d.attempts::int AS attempts,
            d.next_attempt_at AS "nextAttemptAt", e.event_type AS "eventType", e.entity_id::text AS "entityId"
     FROM outbox_delivery d JOIN outbox_event e ON e.id = d.outbox_event_id
     WHERE d.status IN ('pending', 'retry') AND d.next_attempt_at < $1::timestamptz
     ORDER BY d.next_attempt_at, d.outbox_event_id, d.subscriber LIMIT $2::int`,
    before.toISOString(),
    limit,
  );
}

/** names 里哪些是当前 schema 下存在的表（普通表与分区表） */
export async function selectExistingTables(
  db: RawReader,
  names: readonly string[],
): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT c.relname::text AS name FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p') AND c.relname = ANY($1::text[])`,
    names,
  );
  return rows.map((row) => row.name);
}
