// staff 连库用例的共用部分（W1-01a）：只给本目录的测试用。
// 直接把员工摆成“已设密码、已绑动态口令”的样子：走一遍激活四步要多算几次 scrypt，这里一个口令只算一次哈希。
import type { StaffRoleKey } from "@liyoxi/contract";
import { createPrismaClient } from "@liyoxi/db";
import type { PrismaClient, Staff } from "@liyoxi/db";

import { isAppError } from "../../kernel/index.js";
import { sealMfaSecret, sealPhone } from "../../security/index.js";
import { createFactories } from "../../testing/index.js";
import type { TestDatabase, TestStaffAuth } from "../../testing/index.js";
import { generateRecoveryCodes } from "../codes.js";
import { hashPassword } from "../password.js";
import { generateTotpSecret } from "../totp.js";
import type { RequestMeta } from "../types.js";

/** 连库的用例与钩子的时限：机器忙的时候建库、播种都慢 */
export const SLOW = 180_000;
export const PASSWORD = "Liyoxi-2026-ok";
export const META: RequestMeta = {
  ip: "10.0.0.8",
  userAgent: "lyxtest/1.0",
  requestId: "req-staff-0001",
};

const hashes = new Map<string, Promise<string>>();
const hashOnce = (password: string): Promise<string> => {
  const known = hashes.get(password) ?? hashPassword(password);
  hashes.set(password, known);
  return known;
};

/** 另开一个连到本文件测试库的客户端：一个客户端就是一条独立的连接。用完自己 $disconnect() */
export async function openClient(db: TestDatabase): Promise<PrismaClient> {
  return createPrismaClient({ connectionString: await db.url(), max: 1 });
}

let phoneSeq = 0;
/** 一个没用过的手机号：137 开头，与工厂的 139 号段不撞 */
export const nextPhone = (): string => `137${String(10_000_000 + (phoneSeq += 1)).slice(-8)}`;

export interface ProvisionedStaff {
  readonly row: Staff;
  readonly id: string;
  readonly phone: string;
  readonly password: string;
  /** 动态口令密钥（Base32）；没绑时为空串 */
  readonly secret: string;
  /** 恢复码明文；没绑时为空 */
  readonly recoveryCodes: readonly string[];
}

export interface ProvisionOptions {
  readonly roleKey?: StaffRoleKey;
  readonly status?: "active" | "pending" | "disabled";
  /** null：没设过密码（待激活） */
  readonly password?: string | null;
  /** false：还没绑动态口令 */
  readonly totp?: boolean;
  readonly isLead?: boolean;
  readonly staffGroupId?: string | null;
}

/** 插一名员工：手机号用真的三件套（按盲索引查得到），缺省已设密码、已绑动态口令 */
export async function provisionStaff(
  t: TestStaffAuth,
  prisma: PrismaClient,
  options: ProvisionOptions = {},
): Promise<ProvisionedStaff> {
  const phone = nextPhone();
  const password = options.password === undefined ? PASSWORD : options.password;
  const enrolled = options.totp !== false;
  const secret = enrolled ? generateTotpSecret() : "";
  const recovery = enrolled ? generateRecoveryCodes() : { codes: [], hashes: [] };
  const now = t.clock.now();
  const status = options.status ?? "active";
  const make = createFactories({
    db: prisma,
    clock: t.clock,
    seal: {
      phone: (column, value) => sealPhone(t.keyring, column, value),
      uscc: () => {
        throw new Error("用不到");
      },
      text: () => {
        throw new Error("用不到");
      },
    },
  });
  const row = await make.staff({
    phone,
    staffRoleKey: options.roleKey ?? "delivery_manager",
    isLead: options.isLead ?? false,
    staffGroupId: options.staffGroupId ?? null,
    status,
    ...(status === "disabled" ? { disabledAt: now, disabledReason: "other" } : {}),
    passwordHash: password === null ? null : await hashOnce(password),
    passwordChangedAt: password === null ? null : now,
    ...(enrolled
      ? {
          totpSecretEnc: sealMfaSecret(t.authKeys, "staff.totp_secret_enc", secret),
          totpEnrolledAt: now,
          recoveryCodes: recovery.hashes,
        }
      : {}),
  });
  return {
    row,
    id: row.id,
    phone,
    password: password ?? "",
    secret,
    recoveryCodes: recovery.codes,
  };
}

/** 跑一个该失败的用例，返回它抛的业务错误的符号名、文案与 details；没抛或抛了别的即让用例红 */
export async function failureOf(
  run: Promise<unknown>,
): Promise<{ error: string; message: string; details: unknown }> {
  try {
    await run;
  } catch (thrown) {
    if (isAppError(thrown)) {
      return { error: thrown.error, message: thrown.message, details: thrown.details };
    }
    throw thrown;
  }
  throw new Error("本该抛业务错误，却成功了");
}

/** 某个账号的登录与安全事件，按先后 */
export const eventsOf = async (prisma: PrismaClient, staffId: string): Promise<string[]> =>
  (await prisma.authEvent.findMany({ where: { subjectId: staffId }, orderBy: { seq: "asc" } })).map(
    (row) => row.event,
  );
