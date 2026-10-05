// 运行与违规的落库（W0-24）。依据：15 分组 第 2.4、2.5 节（列、约束、状态机与处理过程）、第 4 节（scope、detail）。
//
//   1. 两张表都是技术状态：不经 flow.transition()，不写状态历史；带原状态条件的 UPDATE 推进。
//   2. 去重靠部分唯一索引 uq_invariant_violation_open：同一检查项对同一对象至多一行未解决。
//      再次发现只更新 last_seen_at（取较大值）、detail、auto_healed_at（用本次的值覆盖，没自愈即清空）；
//      invariant_run_id、first_seen_at 不动。已解决后再次发现，不在索引里，自然新建一行。
//   3. 自愈策略：none 不认 healed；heal_and_alert 写 auto_healed_at，仍未解决；
//      heal_only 自愈即关闭：有未解决行就关那一行，没有就直接插一行已关闭的。自愈没成的照未解决写。
//   4. 这里的函数收“能发语句的东西”：运行里传事务句柄；上报端口传连接池（一条语句自己就是一个短事务）。
//   5. 时间列（first_seen_at、started_at 等）写调用方给的业务时间；updated_at 是基础设施列，写数据库时间。
import type { EnumValue, INVARIANT_RUN_STATUS } from "@liyoxi/contract/enums";

import { uuidv7 } from "../../kernel/index.js";
import type {
  InvariantHeal,
  InvariantMode,
  InvariantSeverity,
  InvariantViolation,
} from "../../kernel/index.js";
import type { SqlRunner } from "../binding.js";
import type { InvariantTrigger } from "./select.js";

/** 完成期限：超过它仍为 running 的行，下一次运行开始前标成中断（15 分组 第 2.4 节状态机） */
export const RUN_DEADLINE_MIN = { full: 180, quick: 30 } as const satisfies Record<
  InvariantMode,
  number
>;
/** 被接任者标记中断时写的错误摘要 */
export const ABANDONED = "abandoned";
/** heal_only 检查项自动关闭时写的处理结论 */
export const AUTO_HEALED = "auto_healed";
/** 错误摘要的长度上限 */
export const RUN_ERROR_MAX = 2_000;
/** 一条语句至多写多少行违规 */
const WRITE_BATCH = 500;

export type InvariantRunStatus = EnumValue<typeof INVARIANT_RUN_STATUS>;

/** invariant_run.scope 的结构（契约 InvariantScope；15 分组 第 4 节） */
export interface StoredScope {
  readonly since?: string;
  readonly entityIds?: readonly string[];
  readonly modules?: readonly string[];
  readonly codes?: readonly string[];
}

export interface NewRun {
  readonly mode: InvariantMode;
  readonly trigger: InvariantTrigger;
  readonly scope: StoredScope | null;
  readonly startedAt: Date;
}

/** 把超过完成期限仍为 running 的行标成中断；返回标了几行 */
export async function abandonStaleRuns(db: SqlRunner, now: Date): Promise<number> {
  const rows = await db.$queryRawUnsafe<unknown[]>(
    `UPDATE invariant_run
        SET status = 'failed', error = $2::text, finished_at = $1::timestamptz, updated_at = now()
      WHERE status = 'running'
        AND started_at < $1::timestamptz
              - (CASE mode WHEN 'full' THEN $3::int ELSE $4::int END) * interval '1 minute'
      RETURNING id`,
    now,
    ABANDONED,
    RUN_DEADLINE_MIN.full,
    RUN_DEADLINE_MIN.quick,
  );
  return rows.length;
}

/** 上一次成功的定时 quick 运行的开始时间：quick 的“上次以来”。没有即 undefined */
export async function lastQuickStart(db: SqlRunner): Promise<Date | undefined> {
  const [row] = await db.$queryRawUnsafe<{ started_at: Date }[]>(
    `SELECT started_at FROM invariant_run
      WHERE mode = 'quick' AND trigger = 'schedule' AND status = 'succeeded'
      ORDER BY started_at DESC LIMIT 1`,
  );
  return row?.started_at;
}

/** 插入一行运行中的记录，返回它的 id */
export async function insertRun(db: SqlRunner, run: NewRun): Promise<string> {
  const id = uuidv7();
  await db.$queryRawUnsafe(
    `INSERT INTO invariant_run (id, mode, trigger, scope, status, started_at)
     VALUES ($1::uuid, $2::text, $3::text, $4::jsonb, 'running', $5::timestamptz)
     RETURNING id`,
    id,
    run.mode,
    run.trigger,
    run.scope === null ? null : JSON.stringify(run.scope),
    run.startedAt,
  );
  return id;
}

export interface RunOutcome {
  readonly status: Exclude<InvariantRunStatus, "running">;
  readonly finishedAt: Date;
  readonly checksRun: number;
  readonly violationsFound: number;
  /** failed 必有，succeeded 没有 */
  readonly error?: string;
}

/** 回写运行结果。行已不是 running（被接任者标成中断）时不动，返回 false */
export async function finishRun(db: SqlRunner, id: string, outcome: RunOutcome): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<unknown[]>(
    `UPDATE invariant_run
        SET status = $2::text, finished_at = $3::timestamptz, checks_run = $4::int,
            violations_found = $5::int, error = $6::text, updated_at = now()
      WHERE id = $1::uuid AND status = 'running'
      RETURNING id`,
    id,
    outcome.status,
    outcome.finishedAt,
    outcome.checksRun,
    outcome.violationsFound,
    outcome.status === "failed" ? (outcome.error ?? "出错").slice(0, RUN_ERROR_MAX) : null,
  );
  return rows.length === 1;
}

/** 这批违规是谁报的、按什么策略写 */
export interface ViolationSource {
  /** 首次发现它的运行；经端口上报的为 null */
  readonly runId: string | null;
  readonly code: string;
  readonly module: string;
  readonly severity: InvariantSeverity;
  readonly heal: InvariantHeal;
  /** 发现的时刻（业务时间） */
  readonly now: Date;
}

export interface WriteResult {
  /** 写了几行（同一对象在一批里出现多次只算一次） */
  readonly found: number;
  /** 其中新建的未解决行 */
  readonly created: number;
  /** 其中自愈后自动关闭的 */
  readonly autoClosed: number;
}

interface Row {
  id: string;
  subject_type: string | null;
  subject_id: string | null;
  subject_key: string | null;
  detail: Record<string, unknown>;
  auto_healed_at: string | null;
}

const RECORDSET = `jsonb_to_recordset($6::jsonb) AS v(
       id uuid, subject_type text, subject_id uuid, subject_key text, detail jsonb, auto_healed_at timestamptz)`;

const UPSERT_OPEN = `
  INSERT INTO invariant_violation
         (id, invariant_run_id, code, module, severity, subject_type, subject_id, subject_key, detail,
          first_seen_at, last_seen_at, auto_healed_at)
  SELECT v.id, $1::uuid, $2::text, $3::text, $4::text, v.subject_type, v.subject_id, v.subject_key, v.detail,
         $5::timestamptz, $5::timestamptz, v.auto_healed_at
    FROM ${RECORDSET}
  ON CONFLICT (code, (COALESCE(subject_type, '')), (COALESCE(subject_id::text, subject_key, '')))
        WHERE resolved_at IS NULL
  DO UPDATE SET last_seen_at = GREATEST(invariant_violation.last_seen_at, EXCLUDED.last_seen_at),
                detail = EXCLUDED.detail,
                auto_healed_at = EXCLUDED.auto_healed_at,
                updated_at = now()
  RETURNING (xmax = 0) AS created`;

// 有未解决行就关它（invariant_run_id、first_seen_at 不动），没有才插一行已关闭的
const CLOSE_HEALED = `
  WITH v AS (SELECT * FROM ${RECORDSET}),
  closed AS (
    UPDATE invariant_violation t
       SET last_seen_at = GREATEST(t.last_seen_at, $5::timestamptz), detail = v.detail,
           auto_healed_at = v.auto_healed_at, resolved_at = v.auto_healed_at, resolution = '${AUTO_HEALED}',
           updated_at = now()
      FROM v
     WHERE t.code = $2::text AND t.resolved_at IS NULL
       AND COALESCE(t.subject_type, '') = COALESCE(v.subject_type, '')
       AND COALESCE(t.subject_id::text, t.subject_key, '') = COALESCE(v.subject_id::text, v.subject_key, '')
    RETURNING v.id
  )
  INSERT INTO invariant_violation
         (id, invariant_run_id, code, module, severity, subject_type, subject_id, subject_key, detail,
          first_seen_at, last_seen_at, auto_healed_at, resolved_at, resolution)
  SELECT v.id, $1::uuid, $2::text, $3::text, $4::text, v.subject_type, v.subject_id, v.subject_key, v.detail,
         $5::timestamptz, $5::timestamptz, v.auto_healed_at, v.auto_healed_at, '${AUTO_HEALED}'
    FROM v
   WHERE v.id NOT IN (SELECT id FROM closed)
  RETURNING id`;

function toRow(violation: InvariantViolation, heal: InvariantHeal): Row {
  const subject = violation.subject;
  const healed = heal === "none" ? undefined : violation.healed;
  return {
    id: uuidv7(),
    subject_type: subject !== undefined && "type" in subject ? subject.type : null,
    subject_id: subject !== undefined && "id" in subject ? subject.id : null,
    subject_key: subject !== undefined && "key" in subject ? subject.key : null,
    detail: {
      ...violation.detail,
      ...(violation.entityId === undefined ? {} : { entityId: violation.entityId }),
      ...(healed === undefined
        ? {}
        : { healed: { action: healed.action, at: healed.at.toISOString() } }),
    },
    auto_healed_at: healed === undefined ? null : healed.at.toISOString(),
  };
}

const subjectOf = (row: Row): string =>
  `${row.subject_type ?? ""}\u0000${row.subject_id ?? row.subject_key ?? ""}`;

/**
 * 写一批违规：去重、按自愈策略落库。同一对象在这一批里出现多次的，留最后一次
 * （一条语句不能两次碰同一行）。约束拒掉的（对象类型不是表名的写法、entityId 不是 uuid 等）照常抛错。
 */
export async function writeViolations(
  db: SqlRunner,
  source: ViolationSource,
  violations: readonly InvariantViolation[],
): Promise<WriteResult> {
  const bySubject = new Map<string, Row>();
  for (const violation of violations) {
    const row = toRow(violation, source.heal);
    bySubject.set(subjectOf(row), row);
  }
  const rows = [...bySubject.values()];
  const closing = source.heal === "heal_only";
  const healed = rows.filter((row) => closing && row.auto_healed_at !== null);
  const open = rows.filter((row) => !(closing && row.auto_healed_at !== null));
  const send = <T>(sql: string, batch: readonly Row[]): Promise<T[]> =>
    db.$queryRawUnsafe<T[]>(
      sql,
      source.runId,
      source.code,
      source.module,
      source.severity,
      source.now,
      JSON.stringify(batch),
    );

  let created = 0;
  for (let from = 0; from < open.length; from += WRITE_BATCH) {
    const written = await send<{ created: boolean }>(
      UPSERT_OPEN,
      open.slice(from, from + WRITE_BATCH),
    );
    created += written.filter((row) => row.created).length;
  }
  for (let from = 0; from < healed.length; from += WRITE_BATCH) {
    await send(CLOSE_HEALED, healed.slice(from, from + WRITE_BATCH));
  }
  return { found: rows.length, created, autoClosed: healed.length };
}
