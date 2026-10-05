// 直接插一行定时器（W0-17）：造“很久以前就触发了”的行给清理项的用例用，绕过 arm。只给本目录的测试用。
import type { PrismaClient } from "@liyoxi/db";

import { uuidv7 } from "../../kernel/index.js";
import type { TimerStatus, TimerSubject } from "../index.js";

export interface RawTimer {
  kind: string;
  key: string;
  fireAt: Date;
  status: TimerStatus;
  subject?: TimerSubject;
}

export async function insertTimer(prisma: PrismaClient, row: RawTimer): Promise<string> {
  const id = uuidv7();
  const done = row.status === "fired" || row.status === "skipped";
  await prisma.$executeRawUnsafe(
    `INSERT INTO timer (id, kind, subject_type, subject_id, fire_at, dedupe_key, status, fired_at, lease_until)
     VALUES ($1::uuid, $2::text, $3::text, $4::uuid, $5::timestamptz, $6::text, $7::text,
             CASE WHEN $8::boolean THEN $5::timestamptz END,
             CASE WHEN $7::text = 'dispatched' THEN now() + interval '5 minutes' END)`,
    id,
    row.kind,
    row.subject?.type ?? null,
    row.subject?.id ?? null,
    row.fireAt,
    row.key,
    row.status,
    done,
  );
  return id;
}
