// W2-24 的必要 owned 公口；W2-17 场景派发复用此定义与去重，不另造告警 producer。
import { z } from "zod";
import { AppError, uuidv7 } from "../kernel/index.js";
import type { AlertSeverity, Tx } from "../kernel/index.js";

export const SYSTEM_ALERT_SCENE = {
  key: "s.system_alert",
  audience: "staff",
  vars: z.object({
    alertId: z.uuid(),
    fingerprint: z.string().min(1).max(320),
    severity: z.enum(["P1", "P2", "P3"]),
    recovered: z.boolean(),
  }),
} as const;
export interface SystemAlertInput {
  readonly alertId: string;
  readonly fingerprint: string;
  readonly severity: AlertSeverity;
  readonly recovered: boolean;
  /** 同一 alert 的通知序号；恢复有独立命名空间。调用失败后复用，不制造重复铃铛。 */
  readonly noticeNo: number;
  readonly at: Date;
}
export interface SystemAlertResult {
  readonly status: "sent" | "disabled" | "no_recipients";
  readonly recipients: number;
  readonly created: number;
}
/** 与 notification、staff_message、inbox delivery 同一个事务；不做外呼。 */
export async function sendSystemAlert(tx: Tx, input: SystemAlertInput): Promise<SystemAlertResult> {
  const vars = SYSTEM_ALERT_SCENE.vars.parse({
    alertId: input.alertId,
    fingerprint: input.fingerprint,
    severity: input.severity,
    recovered: input.recovered,
  });
  if (!Number.isSafeInteger(input.noticeNo) || input.noticeNo < 0)
    throw new TypeError("告警通知序号不合法");
  const scene = await tx.notifyScene.findUnique({ where: { sceneKey: SYSTEM_ALERT_SCENE.key } });
  if (scene === null || scene.audience !== SYSTEM_ALERT_SCENE.audience)
    throw new AppError("INTERNAL", { message: "系统告警通知场景尚未播种" });
  if (!scene.sceneEnabled) return { status: "disabled", recipients: 0, created: 0 };
  const recipients = await tx.staff.findMany({
    where: { staffRoleKey: "super_admin", status: "active" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (recipients.length === 0) return { status: "no_recipients", recipients: 0, created: 0 };
  let created = 0;
  for (const staff of recipients) {
    const notificationId = uuidv7();
    const dedupeKey = `alert:${input.alertId}:${input.recovered ? "recovered" : "open"}:${input.noticeNo}:N0:${staff.id}`;
    const inserted = await tx.notification.createMany({
      data: [
        {
          id: notificationId,
          notifySceneKey: SYSTEM_ALERT_SCENE.key,
          dedupeKey,
          bizType: "alert_event",
          bizId: input.alertId,
          node: "N0",
          staffId: staff.id,
          vars,
          createdAt: input.at,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) continue;
    const title = input.recovered ? "系统告警已恢复" : `系统告警 ${input.severity}`;
    await tx.staffMessage.create({
      data: {
        id: uuidv7(),
        notificationId,
        staffId: staff.id,
        kind: "alert",
        title,
        body: `${input.recovered ? "已恢复" : "待处理"}：${input.fingerprint}`,
        link: { route: "/sys/health", params: { alertId: input.alertId } },
        createdAt: input.at,
        updatedAt: input.at,
      },
    });
    await tx.notificationDelivery.create({
      data: {
        id: uuidv7(),
        notificationId,
        channel: "inbox",
        origin: "primary",
        status: "sent",
        dueAt: input.at,
        sentAt: input.at,
        finishedAt: input.at,
        createdAt: input.at,
        updatedAt: input.at,
      },
    });
    created++;
  }
  return { status: "sent", recipients: recipients.length, created };
}
