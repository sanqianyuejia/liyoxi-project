// 后台登录的测试支架（W1-01a）。只给测试用，不进生产装配。
//   fakeAuthKeys、fakeKeyring      固定字节现造的假密钥：不读任何文件，不是任何环境在用的密钥
//   createTestStaffAuth(prisma)    测试装配 + events + flow + 可拨时钟之上建 staff 的凭据用例；告警记在 alerts 里
//   signInAsStaff(db, { … })       直接建员工与会话行，返回带 Cookie、X-LYX-Admin 与 Origin 的请求头：接口测试的登录态
//   totpNow(secret, clock)         按时钟算当下的动态口令
//   fakeKeyEnv()                   三份密钥写成 loadEnv 结果里的样子：建进程运行时的用例并进 env，runtime.staffAuth 才装得起来
import { defaultRoleActions, STAFF_ROLE_DEFAULTS } from "@liyoxi/contract";
import type { StaffRoleKey } from "@liyoxi/contract";
import type { Prisma, PrismaClient, Staff } from "@liyoxi/db";

import { createEvents } from "../events/index.js";
import { createFlow } from "../flow/index.js";
import type { Flow } from "../flow/index.js";
import { alertsOf, createTxRunner, uuidv7 } from "../kernel/index.js";
import type {
  AlertInput,
  AppEnv,
  AuthKeysConfig,
  BidxKeysConfig,
  Clock,
  DataKeysConfig,
  TxRunner,
} from "../kernel/index.js";
import { createAuthKeys, createKeyring } from "../security/index.js";
import type { AuthKeys, Keyring } from "../security/index.js";
import {
  base32Decode,
  createStaffAuth,
  hotp,
  newSessionToken,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  sessionTokenHash,
  staffCookieNames,
  totpStep,
} from "../staff/index.js";
import type { StaffAuth } from "../staff/index.js";
import { assembleForTest } from "./assembly.js";
import { createClock, DEFAULT_CLOCK_START } from "./clock.js";
import type { AdjustableClock } from "./clock.js";
import { createFactories } from "./data/index.js";
import type { FactoryDb } from "./data/index.js";
import { createRecordingPorts } from "./ports.js";

const fill = (byte: number): Buffer => Buffer.alloc(32, byte);
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/** 假的后台登录密钥：票据、设备 Cookie、MFA 三把，固定字节 */
export const fakeAuthKeys = (): AuthKeys =>
  createAuthKeys({
    ticket: fill(0x71),
    device: fill(0x72),
    mfa: { current: "t1", keys: { t1: fill(0x73) } },
  });

/** 假的字段加密密钥环：数据密钥一把、盲索引两把，固定字节 */
export const fakeKeyring = (): Keyring =>
  createKeyring({
    data: { current: "t1", keys: { t1: fill(0x74) } },
    bidx: { phone: fill(0x75), uscc: fill(0x76) },
  });

/**
 * 三份密钥写成 loadEnv 结果里的样子（文件内容解析之后）：接口测试支架把它并进 env 再建进程运行时。
 * 字段加密与盲索引那两份和测试数据工厂的 TEST_KEYRING 是同一组字节：工厂造的手机号，运行时解得开、按盲索引查得到；
 * 后台登录那一份和 fakeAuthKeys 是同一组字节。都是固定字节现造的，不是任何环境在用的密钥。
 */
export const fakeKeyEnv = (): {
  DATA_KEYS: DataKeysConfig;
  BIDX_KEYS: BidxKeysConfig;
  AUTH_KEYS: AuthKeysConfig;
} => {
  const b64 = (byte: number): string => fill(byte).toString("base64");
  return {
    DATA_KEYS: { current: "test", keys: { test: b64(0x51) } },
    BIDX_KEYS: { phone: b64(0x52), uscc: b64(0x53) },
    AUTH_KEYS: {
      ticket: b64(0x71),
      device: b64(0x72),
      mfa: { current: "t1", keys: { t1: b64(0x73) } },
    },
  };
};

export interface TestStaffAuth {
  readonly staff: StaffAuth;
  /** 同一套装配上的状态迁移：要直接调 flow.transition 的用例（演示种子）用它 */
  readonly flow: Flow;
  readonly clock: AdjustableClock;
  readonly tx: TxRunner;
  readonly keyring: Keyring;
  readonly authKeys: AuthKeys;
  /** 告警端口收到的调用，按先后 */
  readonly alerts: AlertInput[];
}

/**
 * 在传进来的测试库上建 staff 的凭据用例：真实模块的登记（含 staff.status 的守卫）、可拨时钟、假密钥。
 * 库要带种子（useSeededDatabase）：员工行的外键指着 8 个角色，引导出来的管理员进默认组。
 */
export function createTestStaffAuth(
  prisma: PrismaClient,
  options: { clock?: AdjustableClock; roleCacheTtlMs?: number } = {},
): TestStaffAuth {
  const ports = createRecordingPorts({ module: "lyxtest_staff_ports" });
  const assembly = assembleForTest({ entry: "api", extra: [ports.registration] });
  const clock = options.clock ?? createClock();
  const tx = createTxRunner({ prisma, appEnv: "test" });
  const events = createEvents({ assembly, clock, tx });
  const flow = createFlow({ assembly, clock, events });
  const keyring = fakeKeyring();
  const authKeys = fakeAuthKeys();
  const staff = createStaffAuth({
    tx,
    db: prisma,
    clock,
    keyring,
    authKeys,
    flow,
    alerts: alertsOf(assembly),
    ...(options.roleCacheTtlMs === undefined ? {} : { roleCacheTtlMs: options.roleCacheTtlMs }),
  });
  return { staff, flow, clock, tx, keyring, authKeys, alerts: ports.alerts };
}

/** 按时钟算当下的动态口令（secret 是 Base32 写法）；offsetSteps 取前后的时间步 */
export const totpNow = (secret: string, clock: Clock, offsetSteps = 0): string =>
  hotp(base32Decode(secret), totpStep(clock.now()) + offsetSteps);

export interface SignInAsStaffOptions {
  /** 角色；缺省交付经理 */
  readonly roleKey?: StaffRoleKey;
  /** 是否主管；缺省否 */
  readonly isLead?: boolean;
  /** 会话的登录时刻；缺省是可拨时钟的缺省起点（接口测试支架的时钟从那里起） */
  readonly now?: Date;
  /** 所属分组；不给即该角色的默认组（库里有的话） */
  readonly staffGroupId?: string | null;
  /** 哪个环境的 Cookie 名；缺省 test */
  readonly appEnv?: AppEnv;
  /** 覆盖员工行的其余列（姓名、手机号等） */
  readonly staff?: Parameters<ReturnType<typeof createFactories>["staff"]>[0];
  /** 请求头里的 Origin；缺省是接口测试支架发请求的那个源（http://localhost），与它同源 */
  readonly origin?: string;
}

/** 接口测试支架（apps/api 的 useTestApi）发请求的源：app.request() 的地址都在它下面 */
export const TEST_API_ORIGIN = "http://localhost";

export interface SignedInStaff {
  readonly staff: Staff;
  readonly sessionId: string;
  /** 会话 Cookie 的值 */
  readonly sessionToken: string;
  /** 发请求时带上：会话 Cookie 与防跨站的 X-LYX-Admin、Origin（后台的非 GET 请求两样都查） */
  readonly headers: {
    readonly cookie: string;
    readonly "x-lyx-admin": "1";
    readonly origin: string;
  };
}

/**
 * 接口测试的登录态（任务书 第 10 节第 13 项）：绕开登录流程直接建员工与会话行。
 * 库里没有这个角色时照种子的写法补上（接口测试支架的库不带种子）。db 传 Prisma 客户端或事务句柄。
 */
export async function signInAsStaff(
  db: FactoryDb,
  options: SignInAsStaffOptions = {},
): Promise<SignedInStaff> {
  const roleKey = options.roleKey ?? "delivery_manager";
  const now = options.now ?? new Date(DEFAULT_CLOCK_START);
  const role = STAFF_ROLE_DEFAULTS.find((item) => item.key === roleKey);
  if (role === undefined) throw new TypeError(`没有这个角色：${roleKey}`);
  await db.staffRole.createMany({
    data: [
      {
        key: role.key,
        name: role.name,
        description: role.description,
        moduleLevels: json(role.moduleLevels),
        actions: json(defaultRoleActions(role.key)),
        dataScope: role.dataScope,
        isLocked: role.isLocked,
        availableFrom: role.availableFrom,
        createdAt: now,
        updatedAt: now,
      },
    ],
    skipDuplicates: true,
  });
  const group =
    options.staffGroupId === undefined
      ? await db.staffGroup.findFirst({ where: { staffRoleKey: roleKey, isDefault: true } })
      : null;
  const staff = await createFactories({ db, clock: { now: () => now } }).staff({
    staffRoleKey: roleKey,
    isLead: options.isLead ?? false,
    staffGroupId: options.staffGroupId === undefined ? (group?.id ?? null) : options.staffGroupId,
    ...options.staff,
  });
  const sessionToken = newSessionToken();
  const sessionId = uuidv7();
  await db.staffSession.create({
    data: {
      id: sessionId,
      staffId: staff.id,
      tokenHash: sessionTokenHash(sessionToken) as Buffer<ArrayBuffer>,
      authMethod: "password+totp",
      ip: "127.0.0.1",
      userAgent: "lyxtest",
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      stepupAt: now,
      updatedAt: now,
    },
  });
  const cookie = `${staffCookieNames(options.appEnv ?? "test").session}=${sessionToken}`;
  return {
    staff,
    sessionId,
    sessionToken,
    headers: { cookie, "x-lyx-admin": "1", origin: options.origin ?? TEST_API_ORIGIN },
  };
}
