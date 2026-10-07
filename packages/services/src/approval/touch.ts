// 待审内容更正只升锁版本：领域用例须先调本入口，再持有自己的领域行锁。
import { AppError, lockRows } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import type { ApprovalDeps } from "./context.js";

export interface TouchPendingInput {
  readonly approvalId: string;
  readonly lockVersion: number;
}
export async function touchPending(tx: Tx, deps: ApprovalDeps, input: TouchPendingInput) {
  await lockRows(tx, "approval_request", [input.approvalId]);
  const row = await tx.approvalRequest.findUnique({ where: { id: input.approvalId } });
  if (row === null) throw new AppError("NOT_FOUND");
  if (row.status !== "pending")
    throw new AppError("APPROVAL_NOT_PENDING", {
      details: { status: row.status, decidedAt: row.decidedAt?.toISOString() ?? null },
    });
  if (row.lockVersion !== input.lockVersion)
    throw new AppError("VERSION_CONFLICT", {
      details: { lockVersion: row.lockVersion },
    });
  const changed = await tx.approvalRequest.update({
    where: { id: row.id },
    data: {
      lockVersion: { increment: 1 },
      updatedAt: deps.clock.now(),
    },
  });
  return { approvalId: row.id, lockVersion: changed.lockVersion };
}
