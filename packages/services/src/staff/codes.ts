// 一次性的码（W1-01a；03 分组 第 2.3、2.4、4 节；a01 第 3.2、3.3、3.6 节）：恢复码与激活码。库里只存 sha256。
//   恢复码：10 个，每个 10 位，展示成 XXXXX-XXXXX；staff.recovery_codes 存十六进制小写的 sha256，用掉即移除。
//   激活码：8 位；staff_activation.code_hash 存 sha256 的 32 字节。
// 字符表去掉了 0、1、I、O：抄写、口头转交时不会认错。输入不分大小写，可带连字符与空格。
import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 个：一个随机字节取低 5 位，没有偏差
export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;
const ACTIVATION_CODE_LENGTH = 8;

const randomCode = (length: number): string =>
  Array.from(randomBytes(length), (byte) => ALPHABET[byte & 31]).join("");

/** 归一化：去掉连字符与空白、转大写；长度不对或有字母数字以外的字符即 null */
function normalize(code: string, length: number): string | null {
  const clean = code.replace(/[\s-]/g, "").toUpperCase();
  return clean.length === length && /^[0-9A-Z]+$/.test(clean) ? clean : null;
}
const sha256 = (text: string): Buffer => createHash("sha256").update(text, "utf8").digest();

/** 生成一组恢复码：codes 是只展示一次的明文，hashes 入库 */
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const raw = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomCode(RECOVERY_CODE_LENGTH));
  return {
    codes: raw.map((code) => `${code.slice(0, 5)}-${code.slice(5)}`),
    hashes: raw.map((code) => sha256(code).toString("hex")),
  };
}

/** 输入的恢复码 → 入库的那种哈希；写法不对即 null */
export function recoveryCodeHash(code: string): string | null {
  const clean = normalize(code, RECOVERY_CODE_LENGTH);
  return clean === null ? null : sha256(clean).toString("hex");
}

/** staff.recovery_codes 读出来的值 → 哈希列表；形状不对的项丢掉 */
export const recoveryHashesOf = (stored: unknown): string[] =>
  Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : [];

/** 新的激活码明文（8 位） */
export const generateActivationCode = (): string => randomCode(ACTIVATION_CODE_LENGTH);

/** 输入的激活码 → 入库的哈希（32 字节）；写法不对即 null */
export function activationCodeHash(code: string): Buffer<ArrayBuffer> | null {
  const clean = normalize(code, ACTIVATION_CODE_LENGTH);
  return clean === null ? null : Buffer.from(sha256(clean));
}
