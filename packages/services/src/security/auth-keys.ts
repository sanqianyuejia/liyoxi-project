// 后台登录的三把密钥（W1-01a；D4 第 6.3、9.2 节；任务书 第 10 节第 3 项）：
//   ticket  登录票据的签名（HMAC-SHA256）
//   device  设备 Cookie 的签名（HMAC-SHA256）
//   mfa     动态口令密钥的加密（AES-256-GCM，与字段加密同一种写法），带 kid，可轮换
// 只从 loadEnv 读出来的 AUTH_KEYS_FILE 的内容来（authKeysFromEnv）；测试里用固定字节现造（createAuthKeys）。
// 密钥字节收在闭包里，报错不带任何密钥内容。三把互不相同：一把泄漏不连带另外两样。
import { createHmac, timingSafeEqual } from "node:crypto";

import type { AuthKeysConfig } from "../kernel/index.js";
import { decryptField, encryptField } from "./crypto.js";
import type { SensitiveColumn } from "./crypto.js";
import { SecurityError } from "./keyring.js";
import type { Keyring } from "./keyring.js";

/** 签名的用途：两把签名密钥各管一样，互不通用 */
export type AuthSignPurpose = "ticket" | "device";

type KeyMaterial = string | Uint8Array;
export interface AuthKeysInput {
  readonly ticket: KeyMaterial;
  readonly device: KeyMaterial;
  /** current 是当前 kid；keys 是 kid → 32 字节 */
  readonly mfa: { readonly current: string; readonly keys: Readonly<Record<string, KeyMaterial>> };
}

export interface AuthKeys {
  /** 签名：HMAC-SHA256，32 字节 */
  sign(purpose: AuthSignPurpose, data: string): Buffer;
  /** 验签：定长比较 */
  verify(purpose: AuthSignPurpose, data: string, mac: Uint8Array): boolean;
  /** MFA 密钥的当前 kid 与全部 kid */
  readonly mfaCurrentKid: string;
  readonly mfaKids: readonly string[];
  /** 只给本文件的 sealMfaSecret、openMfaSecret 用 */
  readonly mfaRing: Keyring;
}

const KID = /^[A-Za-z0-9_-]{1,32}$/;
const invalid = (reason: string): never => {
  throw new SecurityError("keyring_invalid", `后台登录的密钥不合格：${reason}`);
};
const toKey = (material: KeyMaterial, what: string): Buffer => {
  const key =
    typeof material === "string" ? Buffer.from(material, "base64") : Buffer.from(material);
  return key.length === 32 ? key : invalid(`${what} 不是 32 字节`);
};

/** 造后台登录的密钥；不合格即抛 SecurityError（keyring_invalid） */
export function createAuthKeys(input: AuthKeysInput): AuthKeys {
  const signing: Record<AuthSignPurpose, Buffer> = {
    ticket: toKey(input.ticket, "票据签名密钥"),
    device: toKey(input.device, "设备 Cookie 签名密钥"),
  };
  const mfa = new Map<string, Buffer>();
  for (const [kid, material] of Object.entries(input.mfa.keys)) {
    if (!KID.test(kid)) invalid("kid 只能用字母、数字、下划线、连字符，不超过 32 个字符");
    mfa.set(kid, toKey(material, `MFA 密钥 ${kid}`));
  }
  if (!mfa.has(input.mfa.current)) invalid("MFA 的当前 kid 不在密钥环里");
  const all = [signing.ticket, signing.device, ...mfa.values()].map((key) => key.toString("hex"));
  if (new Set(all).size !== all.length) invalid("有两把密钥相同：三种用途的密钥要互不相同");

  const sign = (purpose: AuthSignPurpose, data: string): Buffer =>
    createHmac("sha256", signing[purpose]).update(`lyx-${purpose}\n${data}`, "utf8").digest();
  const mfaRing: Keyring = Object.freeze({
    currentKid: input.mfa.current,
    kids: Object.freeze([...mfa.keys()]),
    dataKey: (kid: string) => mfa.get(kid),
    bidxKey: () => invalid("MFA 密钥环没有盲索引密钥"),
  });
  return Object.freeze({
    sign,
    verify(purpose: AuthSignPurpose, data: string, mac: Uint8Array) {
      const expected = sign(purpose, data);
      return mac.length === expected.length && timingSafeEqual(expected, mac);
    },
    mfaCurrentKid: mfaRing.currentKid,
    mfaKids: mfaRing.kids,
    mfaRing,
  });
}

/** 由 loadEnv 的结果造密钥。AUTH_KEYS_FILE 没配即抛 SecurityError（keyring_missing） */
export function authKeysFromEnv(env: { readonly AUTH_KEYS?: AuthKeysConfig }): AuthKeys {
  if (env.AUTH_KEYS === undefined) {
    throw new SecurityError(
      "keyring_missing",
      "没有配置后台登录的密钥：要给 AUTH_KEYS_FILE（写法见 .env.example）",
    );
  }
  return createAuthKeys(env.AUTH_KEYS);
}

/** 用 MFA 密钥加密动态口令密钥。column 写密文所在的列，如 staff.totp_secret_enc */
export const sealMfaSecret = (keys: AuthKeys, column: SensitiveColumn, plaintext: string): string =>
  encryptField(keys.mfaRing, column, plaintext);

/** 解出动态口令密钥。只有 staff 的仓储层调 */
export const openMfaSecret = (
  keys: AuthKeys,
  column: SensitiveColumn,
  ciphertext: string,
): string => decryptField(keys.mfaRing, column, ciphertext);

const PROBE = "lyx-selfcheck-JBSWY3DPEHPK3PXP";
const COLUMN = "selfcheck.probe_enc";

/** 启动自检：两种签名验得过、互不通用，MFA 密钥加密后解得回原文。不过即抛 SecurityError（selfcheck_failed） */
export function selfCheckAuthKeys(keys: AuthKeys): void {
  const fail = (what: string): never => {
    throw new SecurityError("selfcheck_failed", `后台登录密钥的启动自检不过：${what}`);
  };
  try {
    const ticket = keys.sign("ticket", PROBE);
    if (!keys.verify("ticket", PROBE, ticket)) fail("票据签名验不过");
    if (keys.verify("device", PROBE, ticket)) fail("两种签名能互相通过");
    if (!keys.verify("device", PROBE, keys.sign("device", PROBE))) fail("设备 Cookie 签名验不过");
    if (openMfaSecret(keys, COLUMN, sealMfaSecret(keys, COLUMN, PROBE)) !== PROBE) {
      fail("MFA 密钥加密后解不回原文");
    }
  } catch (error) {
    if (error instanceof SecurityError && error.code === "selfcheck_failed") throw error;
    const failure = new SecurityError("selfcheck_failed", "后台登录密钥的启动自检不过：走不通");
    failure.cause = error;
    throw failure;
  }
}

/** 进程启动时调：由 loadEnv 的结果造密钥并自检。没配、不合格、自检不过都抛错 */
export function loadAuthKeys(env: Parameters<typeof authKeysFromEnv>[0]): AuthKeys {
  const keys = authKeysFromEnv(env);
  selfCheckAuthKeys(keys);
  return keys;
}
