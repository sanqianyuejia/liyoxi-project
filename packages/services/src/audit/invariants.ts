// 审计的两条每日校验与对象类型的启动自检（W0-14；03 分组 第 2.10 节“不变量”）。
// 形状照 D7 第 9.6 节的 InvariantCheck。调度与落库在 ops：这里只给检查，登记在 register.ts
//（W0-24 补，docs/plan/tasks/README.md 第 5 节移交表第 5 行）。audit.I1（敏感操作与审计配对）随 M1。
// 违规说明 audit.record 有缺陷：修代码，不改历史行。
import { unknownAuditTargetTypes } from "@liyoxi/contract";
import type { PrismaClient } from "@liyoxi/db";

/** 只读的查询入口：Prisma 客户端或事务句柄都行 */
export type AuditReader = Pick<PrismaClient, "$queryRawUnsafe">;

export interface AuditViolation {
  readonly subjectType: "audit_log";
  /** 审计行的 id */
  readonly subjectId: string;
  readonly detail: { readonly logNo: string; readonly rule: string };
}

export interface AuditInvariantCheck {
  readonly code: "audit.I2" | "audit.I3";
  readonly module: "audit";
  readonly severity: "P2";
  readonly modes: readonly ("quick" | "full")[];
  /** since：只查这个时刻之后写入的行；不给即全表。一次至多报 200 条 */
  run(db: AuditReader, scope?: { since?: Date }): Promise<AuditViolation[]>;
}

interface Row {
  id: string;
  log_no: string;
  rule: string;
}

const check = (code: AuditInvariantCheck["code"], ruleSql: string): AuditInvariantCheck => ({
  code,
  module: "audit",
  severity: "P2",
  modes: ["full"],
  async run(db, scope = {}) {
    const rows = await db.$queryRawUnsafe<Row[]>(
      `SELECT id::text AS id, log_no, rule
         FROM (SELECT id, seq, log_no, ${ruleSql} AS rule
                 FROM audit_log
                WHERE $1::timestamptz IS NULL OR created_at >= $1::timestamptz) AS checked
        WHERE rule IS NOT NULL
        ORDER BY seq
        LIMIT 200`,
      scope.since ?? null,
    );
    return rows.map((row) => ({
      subjectType: "audit_log",
      subjectId: row.id,
      detail: { logNo: row.log_no, rule: row.rule },
    }));
  },
});

/** audit.I2：log_no 的日期部分等于 created_at 按北京时间取的日期 */
export const auditI2 = check(
  "audit.I2",
  `CASE WHEN left(log_no, 10) <> 'RZ' || to_char(created_at AT TIME ZONE 'Asia/Shanghai', 'YYYYMMDD')
        THEN 'log_no_date_mismatch' END`,
);

/** audit.I3：规范化复核（操作人与客户端、命令行、对象两列、门店与主体） */
export const auditI3 = check(
  "audit.I3",
  `CASE
     WHEN actor_type = 'system' AND (actor_id IS NOT NULL OR client IS NOT NULL)
       THEN 'system_with_actor_or_client'
     WHEN actor_type <> 'system' AND (actor_id IS NULL OR client IS NULL)
       THEN 'person_without_actor_or_client'
     WHEN client = 'cli' AND (actor_type <> 'staff' OR job_name IS NULL
          OR NOT starts_with(job_name, 'cli.') OR session_id IS NOT NULL)
       THEN 'cli_shape'
     WHEN target_id IS NOT NULL AND target_key IS NOT NULL THEN 'target_id_and_key'
     WHEN (target_id IS NOT NULL OR target_key IS NOT NULL) AND target_type IS NULL
       THEN 'target_without_type'
     WHEN store_id IS NOT NULL AND entity_id IS NULL THEN 'store_without_entity'
   END`,
);

export const AUDIT_INVARIANTS: readonly AuditInvariantCheck[] = [auditI2, auditI3];

/**
 * 启动自检：契约登记的对象类型都是库里存在的表。返回登记了、库里却没有的；空数组即通过。
 * 接到 api、worker 的启动由 W0-22、W0-23 做（移交表第 1 行）。
 */
export async function findUnknownAuditTargetTypes(db: AuditReader): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>(
    "SELECT tablename::text AS name FROM pg_tables WHERE schemaname = current_schema()",
  );
  return unknownAuditTargetTypes(rows.map((row) => row.name));
}
