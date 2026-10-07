// approval 的每日校验（W1-06；03 分组 第 2.12 节“不变量”）：I1、I2、I4。调度与落库在 ops（invariant.full）。
//   I1 有领域表的类型，每张审批单恰有一行领域行指向它；领域行不指向别的 kind；有执行步的类型，领域行状态与审批单对应。
//   I2 审批人 ≠ 发起人；同一对象至多一张在途的同类申请。库的 CHECK 与部分唯一索引已经挡着，这里查的是被绕过的。
//   I4 驳回原因都在字典 reject_reason 里；清单编码与版本号指向存在的清单模板版本。
// I3（定时器）、I5（时限与超期）在 sla-invariants.ts。每一项至多报 500 条，按审批单 id 排。
import type { InvariantViolation } from "../kernel/index.js";

import type { ApprovalKindRegistration } from "./kinds.js";

/** 只读查询用得上的最小形状：事务句柄与 Prisma 客户端都合 */
export interface RawReader {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export const APPROVAL_INVARIANT_LIMIT = 500;

type Kinds = ReadonlyMap<
  string,
  Pick<ApprovalKindRegistration, "domain" | "hasExecution" | "executionSla">
>;

// I1 要知道各类型的领域表，那是装配之后才有的：createApproval 把校验过的登记绑到这里。
// 一个进程一份，后绑的顶掉先绑的；没绑时（这个进程没有装配 approval）I1 没有可查的类型
let bound: Kinds = new Map();
export function bindApprovalKinds(kinds: Kinds): void {
  bound = kinds;
}
export const boundApprovalKinds = (): Kinds => bound;

interface Found {
  id: string;
  entityId: string | null;
  [key: string]: unknown;
}

const violation = ({ id, entityId, ...detail }: Found, problem: string): InvariantViolation => ({
  subject: { type: "approval_request", id },
  ...(entityId === null ? {} : { entityId }),
  detail: { problem, ...detail },
});

const ident = (name: string): string => {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new TypeError(`不是合法的表名或列名：${name}`);
  return `"${name}"`;
};

export async function findI1Violations(
  db: RawReader,
  kinds: Kinds = bound,
): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  // 同一张领域表可以承接几个 kind（cancel_request 承接三类取消）
  const tables = new Map<
    string,
    { name: string; table: string; column: string; kinds: string[] }
  >();
  for (const [kind, { domain, hasExecution }] of kinds) {
    const table = ident(domain.table);
    const column = ident(domain.column);
    const shared = tables.get(`${table}.${column}`) ?? {
      name: domain.table,
      table,
      column,
      kinds: [],
    };
    tables.set(`${table}.${column}`, { ...shared, kinds: [...shared.kinds, kind] });

    const counted = await db.$queryRawUnsafe<Found[]>(
      `SELECT a.id::text AS id, a.entity_id::text AS "entityId", n.rows::int AS "domainRows"
         FROM approval_request a
         CROSS JOIN LATERAL (SELECT count(*) AS rows FROM ${table} d WHERE d.${column} = a.id) n
        WHERE a.kind = $1 AND n.rows <> 1
        ORDER BY a.id LIMIT ${APPROVAL_INVARIANT_LIMIT}`,
      kind,
    );
    violations.push(...counted.map((found) => violation(found, "domain_row_count")));
    if (!hasExecution) continue;
    const mismatched = await db.$queryRawUnsafe<Found[]>(
      `SELECT a.id::text AS id, a.entity_id::text AS "entityId", a.status AS "approvalStatus",
              d.status AS "domainStatus", d.close_reason AS "closeReason"
         FROM approval_request a JOIN ${table} d ON d.${column} = a.id
        WHERE a.kind = $1 AND NOT (
              (a.status = 'pending' AND d.status = 'pending_approval')
           OR (a.status IN ('rejected', 'withdrawn') AND d.status = 'not_executed')
           OR (a.status = 'approved' AND (d.status IN ('pending_execution', 'executing', 'done')
               OR (d.status = 'not_executed' AND d.close_reason = 'voided'))))
        ORDER BY a.id LIMIT ${APPROVAL_INVARIANT_LIMIT}`,
      kind,
    );
    violations.push(...mismatched.map((found) => violation(found, "domain_status_mismatch")));
  }
  for (const { name, table, column, kinds: owners } of tables.values()) {
    const foreign = await db.$queryRawUnsafe<Found[]>(
      `SELECT a.id::text AS id, a.entity_id::text AS "entityId", a.kind
         FROM ${table} d JOIN approval_request a ON a.id = d.${column}
        WHERE a.kind <> ALL($1::text[])
        ORDER BY a.id LIMIT ${APPROVAL_INVARIANT_LIMIT}`,
      owners,
    );
    violations.push(
      ...foreign.map((found) =>
        violation({ ...found, domainTable: name }, "domain_row_wrong_kind"),
      ),
    );
  }
  return violations;
}

export async function findI2Violations(db: RawReader): Promise<InvariantViolation[]> {
  const self = await db.$queryRawUnsafe<Found[]>(
    `SELECT id::text AS id, entity_id::text AS "entityId", decided_by_staff_id::text AS "staffId"
       FROM approval_request
      WHERE decided_by_staff_id IS NOT NULL AND decided_by_staff_id = requester_staff_id
      ORDER BY id LIMIT ${APPROVAL_INVARIANT_LIMIT}`,
  );
  // 在途唯一：有去重键的按键，没有的（有执行步的四类）按“类型 + 对象”。每组报最早的那一张
  const duplicated = await db.$queryRawUnsafe<Found[]>(
    `SELECT (array_agg(id ORDER BY id))[1]::text AS id,
            (array_agg(entity_id ORDER BY id))[1]::text AS "entityId",
            count(*)::int AS pending,
            COALESCE(dedupe_key, kind || ':' || subject_type || ':' || subject_id) AS "object"
       FROM approval_request
      WHERE status = 'pending'
      GROUP BY COALESCE(dedupe_key, kind || ':' || subject_type || ':' || subject_id)
     HAVING count(*) > 1
      ORDER BY 1 LIMIT ${APPROVAL_INVARIANT_LIMIT}`,
  );
  return [
    ...self.map((found) => violation(found, "decided_by_requester")),
    ...duplicated.map((found) => violation(found, "duplicate_pending")),
  ];
}

export async function findI4Violations(db: RawReader): Promise<InvariantViolation[]> {
  const reasons = await db.$queryRawUnsafe<Found[]>(
    `SELECT a.id::text AS id, a.entity_id::text AS "entityId", array_agg(r.code ORDER BY r.code) AS codes
       FROM approval_request a CROSS JOIN LATERAL unnest(a.reason_codes) AS r(code)
      WHERE NOT EXISTS (SELECT 1 FROM dict_item d
                         WHERE d.dict_type_key = 'reject_reason' AND d.code = r.code)
      GROUP BY a.id, a.entity_id
      ORDER BY a.id LIMIT ${APPROVAL_INVARIANT_LIMIT}`,
  );
  const checklists = await db.$queryRawUnsafe<Found[]>(
    `SELECT a.id::text AS id, a.entity_id::text AS "entityId", a.checklist_code AS "checklistCode",
            a.checklist_version_no AS "checklistVersionNo"
       FROM approval_request a
      WHERE a.checklist_code IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM checklist_template t
                         WHERE t.code = a.checklist_code AND t.version_no = a.checklist_version_no)
      ORDER BY a.id LIMIT ${APPROVAL_INVARIANT_LIMIT}`,
  );
  return [
    ...reasons.map((found) => violation(found, "unknown_reason_code")),
    ...checklists.map((found) => violation(found, "unknown_checklist_version")),
  ];
}
