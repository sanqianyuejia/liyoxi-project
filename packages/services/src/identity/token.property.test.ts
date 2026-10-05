import { createHash } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "../kernel/index.js";
import {
  hashSecret,
  issueToken,
  parseToken,
  secretMatches,
  SESSION_SECRET_BYTES,
  SESSION_TOKEN_PREFIX,
} from "./token.js";

// 验收第 1 条的前一半（甲类的性质测试）：随机令牌解析回同一个 sid；改任一位即无效。
// 轮次与种子的约定同 packages/shared：PR 上固定种子、每个性质 200 轮；要加大或复现用环境变量，例：
//   LYX_FC_RUNS=5000 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/identity/token.property.test.ts
// 种子决定改哪一位、改成什么；令牌的随机部分来自 crypto。失败时把反例固化成下面的固定用例再修。
const runs = {
  numRuns: Number(process.env.LYX_FC_RUNS ?? 200),
  seed: Number(process.env.LYX_FC_SEED ?? 20261006),
};
const slow = { timeout: 60_000 };

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 一枚令牌对不对得上签发时落库的那一份：sid 相同、随机部分的摘要相同 */
function accepts(token: string, issued: { sessionId: string; tokenHash: Uint8Array }): boolean {
  const parsed = parseToken(token);
  return (
    parsed !== null &&
    parsed.sessionId === issued.sessionId &&
    secretMatches(parsed.secret, issued.tokenHash)
  );
}

describe("会话令牌：性质", () => {
  it("签发的令牌解析回同一个 sid，随机部分对得上落库的摘要", slow, () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const sessionId = uuidv7();
        const issued = issueToken(sessionId);
        const parsed = parseToken(issued.token);
        expect(parsed?.sessionId).toBe(sessionId);
        expect(parsed?.secret.length).toBe(SESSION_SECRET_BYTES);
        expect(issued.tokenHash.length).toBe(32);
        expect(accepts(issued.token, issued)).toBe(true);
        // 令牌里没有摘要本身
        expect(issued.token).not.toContain(issued.tokenHash.toString("base64url"));
      }),
      runs,
    );
  });

  it("改任意一个字符（换成别的字符）即无效：解析不了，或 sid 变了，或摘要对不上", slow, () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.integer({ min: 0, max: BASE64URL.length - 1 }),
        (position, replacement) => {
          const issued = issueToken();
          const index = position % issued.token.length;
          const original = issued.token[index] as string;
          const candidates = `${BASE64URL}.`.replace(original, "");
          const changed = candidates[replacement % candidates.length] as string;
          const tampered = issued.token.slice(0, index) + changed + issued.token.slice(index + 1);
          expect(tampered).not.toBe(issued.token);
          expect(accepts(tampered, issued)).toBe(false);
        },
      ),
      runs,
    );
  });

  it("随机部分翻任意一个比特即无效", slow, () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: SESSION_SECRET_BYTES * 8 - 1 }), (bit) => {
        const issued = issueToken();
        const parsed = parseToken(issued.token);
        if (parsed === null) throw new Error("签发的令牌解析不了");
        const flipped = Buffer.from(parsed.secret);
        flipped[bit >> 3] = (flipped[bit >> 3] as number) ^ (1 << (bit & 7));
        expect(secretMatches(flipped, issued.tokenHash)).toBe(false);
        const token = `${SESSION_TOKEN_PREFIX}${issued.sessionId}.${flipped.toString("base64url")}`;
        expect(accepts(token, issued)).toBe(false);
      }),
      runs,
    );
  });
});

describe("会话令牌：固定用例", () => {
  const sessionId = "0198c0de-1234-7abc-8def-0123456789ab";
  const secret = Buffer.alloc(SESSION_SECRET_BYTES, 0xfe);
  const good = `${SESSION_TOKEN_PREFIX}${sessionId}.${secret.toString("base64url")}`;

  it("写法不对的一律解析不了，不抛错", () => {
    expect(parseToken(good)?.sessionId).toBe(sessionId);
    const bad = [
      "",
      "Bearer x",
      good.slice(SESSION_TOKEN_PREFIX.length),
      good.replace("lyxm_", "lyxa_"),
      good.replace(sessionId, sessionId.toUpperCase()),
      good.replace(".", ":"),
      `${good}A`,
      good.slice(0, -1),
      `${good.slice(0, -1)}=`,
      `${SESSION_TOKEN_PREFIX}${sessionId}.`,
      `${SESSION_TOKEN_PREFIX}not-a-uuid.${secret.toString("base64url")}`,
    ];
    for (const token of bad) expect(parseToken(token), token).toBeNull();
  });

  it("末位不规范的写法（解出来是同样的字节）也拒掉：同一条会话只有一种令牌写法", () => {
    // 32 字节编成 43 个字符，末位只有 4 个有效比特：把无效的两个比特改掉，解出来的字节不变
    const last = BASE64URL.indexOf(good.at(-1) as string);
    const alias = good.slice(0, -1) + (BASE64URL[last ^ 1] as string);
    expect(Buffer.from(alias.slice(-43), "base64url").equals(secret)).toBe(true);
    expect(parseToken(alias)).toBeNull();
  });

  it("摘要是随机部分原始字节的 sha256；长度不对的摘要对不上，不抛错", () => {
    expect(hashSecret(secret).toString("hex")).toBe(
      createHash("sha256").update(secret).digest("hex"),
    );
    // 不是 base64url 文本的摘要
    expect(hashSecret(secret).toString("hex")).not.toBe(
      createHash("sha256").update(secret.toString("base64url")).digest("hex"),
    );
    expect(secretMatches(secret, hashSecret(secret))).toBe(true);
    expect(secretMatches(secret, hashSecret(secret).subarray(0, 16))).toBe(false);
    expect(secretMatches(secret, new Uint8Array(32))).toBe(false);
  });
});
