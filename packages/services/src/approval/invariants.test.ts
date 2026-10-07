// 验收第 7 条（任务书 W1-06 第 7 节）：approval.I1、I2、I4 各造一例违规能查出；正常走完的库 0 违规。
// 库的 CHECK 与部分唯一索引本来就挡着其中几种：造违规时用属主身份把那条约束先拿掉（只在本文件自己的测试库里）。
import { beforeAll, describe, expect, it } from "vitest";

import { uuidv7 } from "../kernel/index.js";
import {
  assembleForTest,
  connectTestDatabase,
  SAMPLE_APPROVAL_KINDS,
  SAMPLE_APPROVAL_TABLE,
  sampleSystemContext,
} from "../testing/index.js";

import { SLOW, useApprovalWorld } from "./__fixtures__/world.js";
import type { Person } from "./__fixtures__/world.js";
import { findI1Violations, findI2Violations, findI4Violations } from "./invariants.js";

const world = useApprovalWorld();
const T = { timeout: SLOW };
let requester: Person;
let finance: Person;

/** 这张审批单上报出来的违规各是什么问题 */
const problemsOf = (violations: Awaited<ReturnType<typeof findI2Violations>>, approvalId: string) =>
  violations
    .filter(
      (item) =>
        item.subject !== undefined && "id" in item.subject && item.subject.id === approvalId,
    )
    .map((item) => item.detail["problem"]);

beforeAll(async () => {
  requester = await world.person({ role: "cs" });
  finance = await world.person();
}, SLOW);

describe("approval 的每日校验（验收 7）", () => {
  it("三项都登记进了装配：P2、只在 full 运行里查", () => {
    const registered = assembleForTest({ entry: "worker" }).invariants.filter((item) =>
      item.code.startsWith("approval."),
    );
    expect(registered.map((item) => [item.code, item.severity, item.modes])).toEqual([
      ["approval.I1", "P2", ["full"]],
      ["approval.I2", "P2", ["full"]],
      ["approval.I3", "P2", ["full"]],
      ["approval.I4", "P2", ["full"]],
      ["approval.I5", "P2", ["full"]],
    ]);
  });

  it("各种走法都走一遍之后 0 违规", T, async () => {
    const { sample, input, prisma } = world;
    const merchant = await world.merchant();
    const approved = await sample.submit(requester.identity, input.pointsAdjust(merchant));
    await sample.approve(finance.identity, {
      approvalId: approved.approvalId,
      staff: finance.staff,
      lockVersion: 0,
    });
    const rejected = await sample.submit(merchant.identity, input.qualification(merchant));
    await sample.reject(sampleSystemContext("lyxtest.reject"), {
      approvalId: rejected.approvalId,
      note: "样例",
    });
    const cancel = await sample.submit(requester.identity, input.orderCancel(merchant));
    await sample.approve(finance.identity, {
      approvalId: cancel.approvalId,
      staff: finance.staff,
      lockVersion: 0,
    });
    await sample.execute(finance.identity, cancel.approvalId);
    const withdrawn = await sample.submit(requester.identity, input.orderCancel(merchant));
    await sample.withdraw(requester.identity, {
      approvalId: withdrawn.approvalId,
      staff: requester.staff,
    });
    await sample.submit(merchant.identity, input.channelAccount(merchant));

    expect(await findI1Violations(prisma)).toEqual([]);
    expect(await findI2Violations(prisma)).toEqual([]);
    expect(await findI4Violations(prisma)).toEqual([]);
  });

  it(
    "I1：领域行没了、多了；有执行步的类型领域行状态与审批单对不上；领域行指向别的类型的审批单",
    T,
    async () => {
      const { sample, input, prisma } = world;
      const merchant = await world.merchant();
      const missing = await sample.submit(requester.identity, input.pointsAdjust(merchant));
      await prisma.$executeRawUnsafe(
        `DELETE FROM ${SAMPLE_APPROVAL_TABLE} WHERE approval_request_id = $1::uuid`,
        missing.approvalId,
      );
      const doubled = await sample.submit(merchant.identity, input.qualification(merchant));
      await prisma.$executeRawUnsafe(
        `INSERT INTO ${SAMPLE_APPROVAL_TABLE} (id, approval_request_id, status) VALUES ($1::uuid, $2::uuid, 'pending')`,
        uuidv7(),
        doubled.approvalId,
      );
      const drifted = await sample.submit(requester.identity, input.orderCancel(merchant));
      await prisma.$executeRawUnsafe(
        `UPDATE ${SAMPLE_APPROVAL_TABLE} SET status = 'done' WHERE approval_request_id = $1::uuid`,
        drifted.approvalId,
      );

      const found = await findI1Violations(prisma);
      expect(found.map((item) => [item.subject, item.detail["problem"]]).sort()).toEqual(
        [
          [{ type: "approval_request", id: missing.approvalId }, "domain_row_count"],
          [{ type: "approval_request", id: doubled.approvalId }, "domain_row_count"],
          [{ type: "approval_request", id: drifted.approvalId }, "domain_status_mismatch"],
        ].sort(),
      );
      expect(
        found.find((item) => item.detail["problem"] === "domain_status_mismatch"),
      ).toMatchObject({
        entityId: merchant.entityId,
        detail: { approvalStatus: "pending", domainStatus: "done" },
      });

      // 假设探针表只承接积分调整：指向别的类型的领域行都算错
      const onlyAdjust = new Map([["points_adjust", SAMPLE_APPROVAL_KINDS.points_adjust!]]);
      const foreign = await findI1Violations(prisma, onlyAdjust);
      expect(problemsOf(foreign, doubled.approvalId)).toEqual([
        "domain_row_wrong_kind",
        "domain_row_wrong_kind",
      ]);
      expect(problemsOf(foreign, drifted.approvalId)).toEqual(["domain_row_wrong_kind"]);
    },
  );

  it("I2：同一对象两张在途的同类申请；审批人就是发起人（约束被绕过时）", T, async () => {
    const { sample, input, prisma, db } = world;
    const merchant = await world.merchant();
    // 有执行步的类型没有去重键，在途唯一本该由领域表的索引保证：样例的探针表没有那道索引
    const dramaOrderId = uuidv7();
    const first = await sample.submit(
      requester.identity,
      input.orderCancel(merchant, dramaOrderId),
    );
    await sample.submit(requester.identity, input.orderCancel(merchant, dramaOrderId));

    const self = await sample.submit(requester.identity, input.pointsAdjust(merchant));
    await sample.approve(finance.identity, {
      approvalId: self.approvalId,
      staff: finance.staff,
      lockVersion: 0,
    });
    const owner = await connectTestDatabase(db.name, { role: null });
    try {
      await owner.query(
        "ALTER TABLE approval_request DROP CONSTRAINT ck_approval_request_decider_not_requester",
      );
      await owner.query(
        "UPDATE approval_request SET decided_by_staff_id = requester_staff_id WHERE id = $1",
        [self.approvalId],
      );
    } finally {
      await owner.end();
    }

    const found = await findI2Violations(prisma);
    expect(problemsOf(found, self.approvalId)).toEqual(["decided_by_requester"]);
    expect(problemsOf(found, first.approvalId)).toEqual(["duplicate_pending"]);
    expect(
      found.find((item) => item.detail["problem"] === "duplicate_pending")?.detail,
    ).toMatchObject({
      pending: 2,
      object: `order_cancel:drama_order:${dramaOrderId}`,
    });
  });

  it("I4：驳回原因不在字典里；清单编码与版本号指不到清单模板", T, async () => {
    const { sample, input, prisma } = world;
    const merchant = await world.merchant();
    const rejected = await sample.submit(requester.identity, input.pointsAdjust(merchant));
    await sample.reject(finance.identity, {
      approvalId: rejected.approvalId,
      staff: finance.staff,
      note: "数额有误",
      reasonCodes: ["R20"],
    });
    expect(await findI4Violations(prisma)).toEqual([]);
    await prisma.$executeRawUnsafe(
      `UPDATE approval_request SET reason_codes = '{R20,ZZ9,ZZ1}' WHERE id = $1::uuid`,
      rejected.approvalId,
    );
    const stale = await sample.submit(merchant.identity, input.channelAccount(merchant));
    await prisma.$executeRawUnsafe(
      `UPDATE approval_request SET checklist_code = 'account.verify', checklist_version_no = 999 WHERE id = $1::uuid`,
      stale.approvalId,
    );

    const found = await findI4Violations(prisma);
    expect(found).toEqual([
      {
        subject: { type: "approval_request", id: rejected.approvalId },
        entityId: merchant.entityId,
        detail: { problem: "unknown_reason_code", codes: ["ZZ1", "ZZ9"] },
      },
      {
        subject: { type: "approval_request", id: stale.approvalId },
        entityId: merchant.entityId,
        detail: {
          problem: "unknown_checklist_version",
          checklistCode: "account.verify",
          checklistVersionNo: 999,
        },
      },
    ]);
  });
});
