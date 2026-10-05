// identity 用例共用的装配（W1-04）：测试装配上的 events、flow、docs、tenant、identity，假微信（带“事务内不外呼”的钩子），
// 假密钥环（security 用例的那一把，固定字节现造），以及一个可改的休眠天数。只给本目录的用例用。
import { createPrismaClient } from "@liyoxi/db";
import type { AgreementVersion, PrismaClient } from "@liyoxi/db";

import { createDocs } from "../../docs/index.js";
import type { Docs } from "../../docs/index.js";
import { createEvents } from "../../events/index.js";
import { createFlow } from "../../flow/index.js";
import { AppError, createTxRunner } from "../../kernel/index.js";
import type { TxRunner } from "../../kernel/index.js";
import { createKeyring, encryptField, sealPhone, sealUscc } from "../../security/index.js";
import { createTenant } from "../../tenant/index.js";
import type { Tenant } from "../../tenant/index.js";
import {
  assembleForTest,
  createClock,
  createFactories,
  createProviderHarness,
} from "../../testing/index.js";
import type {
  AdjustableClock,
  Factories,
  FakeWechat,
  ProviderHarness,
  TestDatabase,
} from "../../testing/index.js";
import { createIdentity } from "../index.js";
import type { Identity, RequestMeta } from "../index.js";

export const TEST_APPID = "wxlyxtest00000001";

/** 假密钥环：固定字节现造，不读任何文件，不是任何环境在用的密钥（CLAUDE.md 硬性规则 1） */
const fakeKey = (fill: number): Buffer => Buffer.alloc(32, fill);
export const keyring = createKeyring({
  data: { current: "idt", keys: { idt: fakeKey(0x61) } },
  bidx: { phone: fakeKey(0x62), uscc: fakeKey(0x63) },
});

/** 另开一个连到本文件测试库的客户端（并发用例：独立的连接）。用完自己 $disconnect() */
export async function openClient(
  db: TestDatabase,
  options: { max?: number; lockTimeoutMs?: number } = {},
): Promise<PrismaClient> {
  return createPrismaClient({
    connectionString: await db.url(),
    max: options.max ?? 1,
    lockTimeoutMs: options.lockTimeoutMs,
  });
}

/** 栅栏：n 方都到了才一起放行 */
export function barrier(n: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return () => {
    arrived += 1;
    if (arrived >= n) open();
    return opened;
  };
}

export interface Stack {
  readonly tx: TxRunner;
  readonly docs: Docs;
  readonly tenant: Tenant;
  readonly identity: Identity;
  /** 这一套开过几次事务 */
  txRuns(): number;
  /** docs.pendingConsents 被调过几次（协议同意的门“只比指纹”时应为 0） */
  pendingLookups(): number;
}

export interface Harness extends Stack {
  readonly prisma: PrismaClient;
  readonly clock: AdjustableClock;
  readonly make: Factories;
  readonly providers: ProviderHarness;
  readonly wechat: FakeWechat;
  /** 用户级两份协议此刻的当前版本 */
  readonly versions: { user: AgreementVersion; privacy: AgreementVersion };
  /** 参数 auth.dormant_days 的取值，用例可以改 */
  dormantDays: number;
  /** 最低客户端版本，用例可以改 */
  minClientVersion: string;
  /**
   * 建号那一步的对齐点：登录事务看到“没有这个手机号的账号”、还没插入时调（并发用例在这里放栅栏，
   * 让两边都看到没有账号之后再一起插入）。平时不设
   */
  onNewAccount?: (() => Promise<void>) | undefined;
  /** 在另一个客户端上再建一套（并发用例：两条独立的连接） */
  stackOn(prisma: PrismaClient): Stack;
  /** 预置一组登录用的 code，返回请求体里要的几样 */
  codes(input: { openid: string; phone: string; unionid?: string }): {
    loginCode: string;
    phoneCode: string;
  };
  /** 两份用户级协议当前版本的同意 */
  consents(): { agreementKey: string; agreementVersionId: string }[];
}

export const META: RequestMeta = {
  requestId: "0198c0de-0000-7000-8000-00000000abcd",
  ip: "203.0.113.9",
  userAgent: "lyxtest-weapp/1.0",
  clientVersion: "1.4.0",
};

let codeSeq = 0;

export async function buildHarness(prisma: PrismaClient): Promise<Harness> {
  const clock = createClock();
  const make = createFactories({
    db: prisma,
    clock,
    // 被测代码按同一把密钥环算盲索引、解密文：工厂也用它
    seal: {
      phone: (column, phone) => sealPhone(keyring, column, phone),
      uscc: (column, uscc) => sealUscc(keyring, column, uscc),
      text: (column, plaintext) => encryptField(keyring, column, plaintext),
    },
  });
  const providers = createProviderHarness({ clock });
  const wechat = providers.providers.wechat;
  const assembly = assembleForTest({ entry: "api" });

  const staff = await make.staff({ staffRoleKey: "super_admin" });
  const file = await make.fileObject({ bucket: "secure", category: "legal_doc", ext: "pdf" });
  const shared = { createdByStaffId: staff.id, pdfFileId: file.id };
  const versions = {
    user: await make.agreementVersion({ agreementKey: "user", ...shared }),
    privacy: await make.agreementVersion({ agreementKey: "privacy", ...shared }),
  };

  const harness = {
    dormantDays: 180,
    minClientVersion: "0.0.0",
  } as Harness;

  function stackOn(client: PrismaClient): Stack {
    const inner = createTxRunner({ prisma: client, appEnv: "test" });
    let runs = 0;
    const tx: TxRunner = {
      run: (fn, options) => {
        runs += 1;
        return inner.run(fn, options);
      },
    };
    const events = createEvents({ assembly, clock, tx });
    const flow = createFlow({ assembly, clock, events });
    const realDocs = createDocs({ tx, clock });
    let lookups = 0;
    const docs: Docs = {
      ...realDocs,
      pendingConsents: (db, merchantUserId) => {
        lookups += 1;
        return realDocs.pendingConsents(db, merchantUserId);
      },
    };
    const realTenant = createTenant({ tx, clock, flow, assembly });
    const tenant: Tenant = {
      ...realTenant,
      // 只有建号的那条路径查登记码：借它做对齐点
      findActiveReferralCode: async (handle, codes) => {
        await harness.onNewAccount?.();
        return realTenant.findActiveReferralCode(handle, codes);
      },
    };
    const identity = createIdentity({
      tx,
      clock,
      flow,
      events,
      assembly,
      docs,
      tenant,
      config: {
        params: {
          get: (key: string) => {
            if (key !== "auth.dormant_days") throw new Error(`用例没给参数 ${key}`);
            return Promise.resolve(harness.dormantDays);
          },
        },
        flags: { minClientVersion: () => Promise.resolve(harness.minClientVersion) },
      } as never,
      keyring: () => keyring,
      wechat,
      appid: TEST_APPID,
    });
    return { tx, docs, tenant, identity, txRuns: () => runs, pendingLookups: () => lookups };
  }

  return Object.assign(harness, stackOn(prisma), {
    prisma,
    clock,
    make,
    providers,
    wechat,
    versions,
    stackOn,
    codes(input: { openid: string; phone: string; unionid?: string }) {
      codeSeq += 1;
      const loginCode = `login-${codeSeq}`;
      const phoneCode = `phone-${codeSeq}`;
      wechat.sessions.set(loginCode, {
        openid: input.openid,
        ...(input.unionid === undefined ? {} : { unionid: input.unionid }),
      });
      wechat.phones.set(phoneCode, input.phone);
      return { loginCode, phoneCode };
    },
    consents() {
      return [
        { agreementKey: "user", agreementVersionId: harness.versions.user.id },
        { agreementKey: "privacy", agreementVersionId: harness.versions.privacy.id },
      ];
    },
  });
}

let phoneSeq = 0;
/** 一个没用过的大陆手机号（138 开头：工厂造的假号是 139 开头，撞不上） */
export const nextPhone = (): string => {
  phoneSeq += 1;
  return `138${String(10_000_000 + phoneSeq).padStart(8, "0")}`;
};

let openidSeq = 0;
export const nextOpenid = (): string => {
  openidSeq += 1;
  return `oLyxTest_${String(openidSeq).padStart(6, "0")}`;
};

export async function appError(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return error;
  }
  throw new Error("本该抛业务错误，却成功了");
}
