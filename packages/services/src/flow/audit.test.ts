import type { PrismaClient } from "@liyoxi/db";
import { chainOf } from "@liyoxi/shared/machines";
import { beforeAll, describe, expect, it } from "vitest";

import { uuidv7 } from "../kernel/index.js";
import {
  createSampleFlow,
  sampleActivity,
  sampleGuards,
  useTestDatabase,
} from "../testing/index.js";
import type { SampleFlow } from "../testing/index.js";
import {
  changed,
  companionsFor,
  insertEntity,
  insertStaff,
  opsAudit,
  seedStaffRole,
  SLOW,
  staffContext,
  tally,
} from "./__fixtures__/db.js";
import { chainKey } from "./bindings.js";
import type { TransitionInput } from "./transition.js";

// 验收第 4 条：每次迁移在 audit_log 恰一行（03 分组 第 2.10 节“迁移与审计行”）。
// 传入审计内容：只有这一行，stream 是传入值；没传：补 1 条 activity；声明并入：0 条；staff 没传：内部错误。

const db = useTestDatabase("services");
let prisma: PrismaClient;
let sample: SampleFlow;
const ctx = staffContext();

beforeAll(async () => {
  prisma = await db.prisma();
  sample = createSampleFlow(prisma);
  await seedStaffRole(prisma);
}, SLOW);

/** 主体的“放弃”：active → abandoned */
const abandon = (id: string): TransitionInput => ({
  machine: "entity",
  stateField: "lifecycle",
  id,
  event: "entity.abandon",
  emit: changed,
  entityId: id,
  set: companionsFor("entity.lifecycle", "abandoned", sample.clock.now()),
});

const auditOf = (targetId: string) =>
  prisma.auditLog.findMany({ where: { targetId }, orderBy: { seq: "asc" } });

describe("transition：审计恰一行（验收 4）", () => {
  it(
    "传入审计内容：只写这一行，stream 是传入值，不另补 activity",
    async () => {
      const id = await insertEntity(prisma);
      const result = await sample.tx.run((tx) =>
        sample.flow.transition(tx, ctx, {
          ...abandon(id),
          audit: {
            stream: "ops",
            category: "merchant_lifecycle",
            action: "lyxtest.entity.abandon",
            summary: "样例：放弃主体",
            target: { type: "entity", id },
            entityId: id,
            reason: { code: "duplicate" },
          },
        }),
      );
      const rows = await auditOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: result.auditId,
        stream: "ops",
        action: "lyxtest.entity.abandon",
        reasonCode: "duplicate",
        actorType: "staff",
        requestId: "req-flow-0001",
      });
    },
    SLOW,
  );

  it(
    "没传：按状态机登记的默认描述补 1 条 activity，对象与归属取自这次迁移",
    async () => {
      const id = await insertEntity(prisma);
      const result = await sample.tx.run((tx) => sample.flow.transition(tx, ctx, abandon(id)));
      const rows = await auditOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: result.auditId,
        stream: "activity",
        category: "flow",
        action: "lyxtest.entity.transition",
        summary: "entity 经 entity.abandon 进入 abandoned",
        targetType: "entity",
        targetId: id,
        entityId: id,
        storeId: null,
      });
    },
    SLOW,
  );

  it(
    "声明并入审批单那一行：0 条，状态历史照写",
    async () => {
      const id = await insertEntity(prisma);
      const before = await tally(prisma);
      const result = await sample.tx.run((tx) =>
        sample.flow.transition(tx, ctx, {
          ...abandon(id),
          audit: { mergedInto: { approvalRequestId: uuidv7() } },
        }),
      );
      expect(result.auditId).toBeNull();
      expect(await auditOf(id)).toHaveLength(0);
      const after = await tally(prisma);
      expect(after).toEqual({ ...before, history: before.history + 1, events: before.events + 1 });
    },
    SLOW,
  );

  it(
    "staff 没传：内部错误，四处都没有写入；传了就只有那一行 ops",
    async () => {
      const id = await insertStaff(prisma);
      const disable = {
        machine: "staff",
        stateField: "status",
        id,
        event: "staff.disable",
        emit: changed,
        set: companionsFor("staff.status", "disabled", sample.clock.now()),
      } as const;
      const before = await tally(prisma);
      const error = await sample.tx
        .run((tx) => sample.flow.transition(tx, ctx, disable))
        .catch((reason: unknown) => reason);
      expect(error).toMatchObject({ name: "FlowError", reason: "audit_required" });
      expect(await tally(prisma)).toEqual(before);

      await sample.tx.run((tx) =>
        sample.flow.transition(tx, ctx, { ...disable, audit: opsAudit(id) }),
      );
      const rows = await auditOf(id);
      expect(rows.map((row) => [row.stream, row.category])).toEqual([["ops", "staff_authz"]]);
    },
    SLOW,
  );

  // 复审的变异：去掉“staff 没传审计即拒绝”的前置判断，上一条照样绿（样例登记里 staff 没有默认描述，被后面的兜底拒掉）。
  // 这里给 staff 登记上默认描述：它没有主体与门店，仍然不补 activity 行（03 分组 第 2.10 节第 4 条）
  it(
    "staff 登记了默认描述、没传审计：照样是内部错误，不补 activity 行，四处都没有写入",
    async () => {
      const id = await insertStaff(prisma);
      const described = createSampleFlow(prisma, {
        bindings: {
          [chainKey("staff", "status")]: {
            companions: ["disabled_at", "disabled_reason"],
            activity: sampleActivity,
            guards: sampleGuards(chainOf("staff", "status")),
          },
        },
      });
      const before = await tally(prisma);
      const error = await described.tx
        .run((tx) =>
          described.flow.transition(tx, ctx, {
            machine: "staff",
            stateField: "status",
            id,
            event: "staff.disable",
            emit: changed,
            set: companionsFor("staff.status", "disabled", described.clock.now()),
          }),
        )
        .catch((reason: unknown) => reason);
      expect(error).toMatchObject({ name: "FlowError", reason: "audit_required" });
      expect(await tally(prisma)).toEqual(before);
      expect(await auditOf(id)).toHaveLength(0);
    },
    SLOW,
  );

  it(
    "没传、状态机也没有登记默认描述：内部错误，四处都没有写入",
    async () => {
      const id = await insertEntity(prisma);
      const silent = createSampleFlow(prisma, {
        bindings: {
          [chainKey("entity", "lifecycle")]: {
            companions: ["closed_at"],
            guards: sampleGuards(chainOf("entity", "lifecycle")),
          },
        },
      });
      const before = await tally(prisma);
      const error = await silent.tx
        .run((tx) => silent.flow.transition(tx, ctx, abandon(id)))
        .catch((reason: unknown) => reason);
      expect(error).toMatchObject({ name: "FlowError", reason: "audit_required" });
      expect(await tally(prisma)).toEqual(before);
    },
    SLOW,
  );
});
