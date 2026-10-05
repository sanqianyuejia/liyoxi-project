// 动态口令（W1-01a；RFC 4226、RFC 6238；D4 第 6.2 节）：HMAC-SHA1、30 秒一步、6 位。只用 node:crypto。
// 没有借参考工程的代码：照 RFC 直接写的，用例里跑 RFC 6238 附录 B 的官方向量。
// 重放：通过校验的时间步记在 staff.totp_last_step，新的校验只认严格大于它的时间步。
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_PERIOD_SEC = 30;
export const TOTP_DIGITS = 6;
/** 前后各容一步：手机与服务器的钟差在 30 秒以内都能过 */
export const TOTP_DRIFT_STEPS = 1;

/** RFC 4226 的 HOTP：密钥、计数器 → digits 位数字 */
export function hotp(secret: Uint8Array, counter: number, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/** 一个时刻落在第几个时间步 */
export const totpStep = (at: Date): number => Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SEC);

/**
 * 校验动态口令：在当前时间步前后各一步里找对得上、且严格大于 lastStep 的那一步，返回它；没有即 null。
 * 每一步都比完再给结论，不因为先对上就少算。
 */
export function matchTotpStep(
  secret: Uint8Array,
  code: string,
  at: Date,
  lastStep: number | null = null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const given = Buffer.from(code);
  const current = totpStep(at);
  let matched: number | null = null;
  for (let step = current - TOTP_DRIFT_STEPS; step <= current + TOTP_DRIFT_STEPS; step += 1) {
    const same = timingSafeEqual(Buffer.from(hotp(secret, step)), given);
    if (same && step > (lastStep ?? -1) && matched === null) matched = step;
  }
  return matched;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 的 Base32，不带补位：验证器收的就是这种写法 */
export function base32Encode(bytes: Uint8Array): string {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let text = "";
  for (let index = 0; index < bits.length; index += 5) {
    text += BASE32[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return text;
}

/** 解 Base32：不分大小写，忽略空格与补位；有别的字符即抛 TypeError */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, "");
  let bits = "";
  for (const char of clean) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new TypeError("不是合法的 Base32");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
}

/** 新的动态口令密钥：20 字节随机数，Base32 写法（32 个字符） */
export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

/** 给验证器扫的地址。account 写手机号脱敏串 */
export function otpauthUri(secret: string, account: string, issuer = "狸有戏"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = `secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SEC}`;
  return `otpauth://totp/${label}?${query}`;
}
