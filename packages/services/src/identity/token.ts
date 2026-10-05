// 商家端会话令牌（W1-04；约定 C3；D4 第 3.3 节）：lyxm_<sid>.<32 字节随机数的 base64url>，不透明。
// 库里只存随机部分的 sha256（user_session.token_hash），不存令牌本身；比较用定长比较。
// 只认规范写法：sid 是小写 UUID，随机部分恰好 43 个 base64url 字符、解出来再编码回去与原文相同
//（末位只有 4 个有效比特：不规范的末位会解出同样的字节，这里拒掉，所以改任何一位都无效）。
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { isUuid, uuidv7 } from "../kernel/index.js";

export const SESSION_TOKEN_PREFIX = "lyxm_";
/** 随机部分的字节数 */
export const SESSION_SECRET_BYTES = 32;

const SECRET_TEXT_LENGTH = 43;
const UUID_LENGTH = 36;

export interface IssuedToken {
  /** 给端上的令牌：只在签发的那一次响应里出现 */
  readonly token: string;
  /** 会话行的主键 */
  readonly sessionId: string;
  /** 落库的摘要 */
  readonly tokenHash: Buffer<ArrayBuffer>;
}

export interface ParsedToken {
  readonly sessionId: string;
  readonly secret: Buffer;
}

/** 随机部分的摘要：sha256，32 字节 */
export const hashSecret = (secret: Uint8Array): Buffer<ArrayBuffer> =>
  Buffer.from(createHash("sha256").update(secret).digest());

/** 签发一枚令牌。sessionId 不给即新取一个 UUID v7 */
export function issueToken(sessionId: string = uuidv7()): IssuedToken {
  const secret = randomBytes(SESSION_SECRET_BYTES);
  return {
    token: `${SESSION_TOKEN_PREFIX}${sessionId}.${secret.toString("base64url")}`,
    sessionId,
    tokenHash: hashSecret(secret),
  };
}

/** 拆令牌；写法不对返回 null（不抛：令牌是没校验过的输入） */
export function parseToken(token: string): ParsedToken | null {
  if (!token.startsWith(SESSION_TOKEN_PREFIX)) return null;
  const body = token.slice(SESSION_TOKEN_PREFIX.length);
  if (body.length !== UUID_LENGTH + 1 + SECRET_TEXT_LENGTH || body[UUID_LENGTH] !== ".") {
    return null;
  }
  const sessionId = body.slice(0, UUID_LENGTH);
  const text = body.slice(UUID_LENGTH + 1);
  if (!isUuid(sessionId) || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const secret = Buffer.from(text, "base64url");
  if (secret.length !== SESSION_SECRET_BYTES || secret.toString("base64url") !== text) return null;
  return { sessionId, secret };
}

/** 令牌的随机部分与库里的摘要对不对得上：定长比较 */
export function secretMatches(secret: Uint8Array, storedHash: Uint8Array): boolean {
  const actual = hashSecret(secret);
  return storedHash.length === actual.length && timingSafeEqual(actual, storedHash);
}
