import { describe, expect, it } from "vitest";

import { createAuthKeys } from "../security/index.js";
import {
  activationCodeHash,
  generateActivationCode,
  generateRecoveryCodes,
  recoveryCodeHash,
  recoveryHashesOf,
} from "./codes.js";
import {
  burnPasswordCheck,
  hashPassword,
  passwordViolations,
  SCRYPT_PARAMS,
  verifyPassword,
} from "./password.js";
import {
  deviceCookieMatches,
  issueDeviceCookie,
  issueTicket,
  readTicket,
  TICKET_TTL_MS,
} from "./ticket.js";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  matchTotpStep,
  otpauthUri,
  totpStep,
} from "./totp.js";

// 任务书 W1-01a 第 7 节验收 3：凭据原语。不连库。
const STAFF = "0199b2f0-0000-7000-8000-000000000001";
const OTHER = "0199b2f0-0000-7000-8000-000000000002";
const NOW = new Date("2026-01-05T04:00:00.000Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);
// 固定字节现造的假密钥：不读任何文件
const keys = createAuthKeys({
  ticket: Buffer.alloc(32, 0x71),
  device: Buffer.alloc(32, 0x72),
  mfa: { current: "t1", keys: { t1: Buffer.alloc(32, 0x73) } },
});
const slow = { timeout: 60_000 };

describe("动态口令", () => {
  const rfcSecret = Buffer.from("12345678901234567890", "ascii");

  it("RFC 6238 附录 B 的官方向量（SHA-1、8 位）", () => {
    const vectors: Array<[number, string]> = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [seconds, expected] of vectors) {
      expect(hotp(rfcSecret, totpStep(new Date(seconds * 1000)), 8), String(seconds)).toBe(
        expected,
      );
    }
  });

  it("RFC 4226 附录 D 的官方向量（6 位，计数器 0–9）", () => {
    const expected = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    expect(expected.map((_, counter) => hotp(rfcSecret, counter))).toEqual(expected);
  });

  it("前后各容一步；窗口之外、写法不对的不过", () => {
    const step = totpStep(NOW);
    for (const offset of [-1, 0, 1]) {
      expect(matchTotpStep(rfcSecret, hotp(rfcSecret, step + offset), NOW)).toBe(step + offset);
    }
    expect(matchTotpStep(rfcSecret, hotp(rfcSecret, step + 2), NOW)).toBeNull();
    expect(matchTotpStep(rfcSecret, hotp(rfcSecret, step - 2), NOW)).toBeNull();
    for (const code of ["", "12345", "1234567", "12345a", " 123456"]) {
      expect(matchTotpStep(rfcSecret, code, NOW)).toBeNull();
    }
  });

  it("同一时间步重放被拒：只认严格大于上一次的时间步", () => {
    const step = totpStep(NOW);
    const code = hotp(rfcSecret, step);
    expect(matchTotpStep(rfcSecret, code, NOW, step - 1)).toBe(step);
    expect(matchTotpStep(rfcSecret, code, NOW, step)).toBeNull();
    expect(matchTotpStep(rfcSecret, code, NOW, step + 5)).toBeNull();
    // 下一个时间步的码照样能用
    expect(matchTotpStep(rfcSecret, hotp(rfcSecret, step + 1), later(30_000), step)).toBe(step + 1);
  });

  it("Base32 往返；密钥是 32 个字符；扫码地址带发行方、位数与周期", () => {
    expect(base32Decode("JBSWY3DPEHPK3PXP").toString("latin1")).toBe("Hello!\xde\xad\xbe\xef");
    expect(base32Encode(Buffer.from("Hello!\xde\xad\xbe\xef", "latin1"))).toBe("JBSWY3DPEHPK3PXP");
    expect(base32Decode("jbsw y3dp ehpk 3pxp==").equals(base32Decode("JBSWY3DPEHPK3PXP"))).toBe(
      true,
    );
    expect(() => base32Decode("JBSW1")).toThrow(TypeError);
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(otpauthUri(secret, "138****6021")).toBe(
      `otpauth://totp/${encodeURIComponent("狸有戏")}:138****6021?secret=${secret}&issuer=${encodeURIComponent("狸有戏")}&digits=6&period=30`,
    );
  });
});

describe("票据", () => {
  it("签发的票据验得过，带着员工、用途、过期时刻与激活码行；不超过 512 个字符", () => {
    const issued = issueTicket(keys, {
      staffId: STAFF,
      purpose: "set_password",
      now: NOW,
      activationId: OTHER,
    });
    expect(issued.expiresAt).toEqual(later(TICKET_TTL_MS.set_password));
    expect(issued.ticket.length).toBeLessThanOrEqual(512);
    expect(readTicket(keys, issued.ticket, "set_password", NOW)).toEqual({
      staffId: STAFF,
      purpose: "set_password",
      expiresAt: issued.expiresAt,
      activationId: OTHER,
    });
    expect(TICKET_TTL_MS).toEqual({ mfa: 300_000, set_password: 900_000, enroll_totp: 900_000 });
  });

  it("篡改、过期、用途不符、别的密钥签的、设备 Cookie 的签名、乱写的，都不过", () => {
    const { ticket } = issueTicket(keys, { staffId: STAFF, purpose: "mfa", now: NOW });
    expect(readTicket(keys, ticket, "mfa", later(299_999))?.staffId).toBe(STAFF);
    expect(readTicket(keys, ticket, "mfa", later(300_000))).toBeNull(); // 过期
    expect(readTicket(keys, ticket, "enroll_totp", NOW)).toBeNull(); // 用途不符
    expect(readTicket(keys, ticket, "set_password", NOW)).toBeNull();

    const [body = "", mac = ""] = ticket.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), s: OTHER }),
    ).toString("base64url");
    expect(readTicket(keys, `${forged}.${mac}`, "mfa", NOW)).toBeNull(); // 改了内容
    expect(readTicket(keys, `${body}.${mac.slice(0, -2)}AA`, "mfa", NOW)).toBeNull(); // 改了签名
    expect(
      readTicket(keys, `${body}.${keys.sign("device", body).toString("base64url")}`, "mfa", NOW),
    ).toBeNull();

    const others = createAuthKeys({
      ticket: Buffer.alloc(32, 1),
      device: Buffer.alloc(32, 2),
      mfa: { current: "k", keys: { k: Buffer.alloc(32, 3) } },
    });
    expect(readTicket(others, ticket, "mfa", NOW)).toBeNull();
    for (const junk of ["", ".", "a.b.c", body, `${body}.`, "x".repeat(600)]) {
      expect(readTicket(keys, junk, "mfa", NOW)).toBeNull();
    }
  });
});

describe("设备 Cookie", () => {
  it("本人的、验签通过、90 天之内才算；别人的、改过的、过期的不算", () => {
    const cookie = issueDeviceCookie(keys, STAFF, NOW);
    const day = 24 * 60 * 60_000;
    expect(deviceCookieMatches(keys, cookie, STAFF, NOW)).toBe(true);
    expect(deviceCookieMatches(keys, cookie, STAFF, later(90 * day - 1_000))).toBe(true);
    expect(deviceCookieMatches(keys, cookie, STAFF, later(90 * day))).toBe(false);
    expect(deviceCookieMatches(keys, cookie, OTHER, NOW)).toBe(false);
    expect(deviceCookieMatches(keys, cookie.replace(STAFF, OTHER), OTHER, NOW)).toBe(false);
    for (const junk of [null, undefined, "", "a.b.c.d", `${STAFF}.1.x.y`]) {
      expect(deviceCookieMatches(keys, junk, STAFF, NOW)).toBe(false);
    }
  });
});

describe("口令", () => {
  it("哈希串自带参数；对的过、错的不过；同一口令两次的哈希不同", slow, async () => {
    const stored = await hashPassword("Liyoxi-2026-ok");
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword("Liyoxi-2026-ok", stored)).toBe(true);
    expect(await verifyPassword("Liyoxi-2026-no", stored)).toBe(false);
    expect(await hashPassword("Liyoxi-2026-ok")).not.toBe(stored);
    expect(SCRYPT_PARAMS).toEqual({ N: 16384, r: 8, p: 1 });
  });

  it("旧参数的哈希串仍能校验：N = 2^12 的，与撞 Node 默认内存上限的 N = 2^15", slow, async () => {
    for (const N of [4096, 32768]) {
      const stored = await hashPassword("History-2025-pw", { N, r: 8, p: 1 });
      expect(stored.startsWith(`scrypt$${N}$8$1$`)).toBe(true);
      expect(await verifyPassword("History-2025-pw", stored)).toBe(true);
      expect(await verifyPassword("History-2025-px", stored)).toBe(false);
    }
  });

  it("哈希串写坏了：不抛错，按不过算；白跑的那一次恒为 false", slow, async () => {
    const bad = [
      "",
      "scrypt$16384$8$1$only-salt",
      "bcrypt$10$abc$def",
      "scrypt$1000$8$1$c2FsdA==$aGFzaGhhc2hoYXNoaGFzaA==",
      "scrypt$1073741824$8$1$c2FsdA==$aGFzaGhhc2hoYXNoaGFzaA==",
    ];
    for (const stored of bad) expect(await verifyPassword("whatever-123", stored)).toBe(false);
    expect(await burnPasswordCheck("whatever-123")).toBe(false);
    expect(await burnPasswordCheck("")).toBe(false);
  });

  it("五条规则各有用例：少于 10 位、没有字母、没有数字、含手机号、在弱口令表里", () => {
    const phone = "13800136021";
    expect(passwordViolations("Liyoxi-2026-ok", phone)).toEqual([]);
    expect(passwordViolations("Ab1234567", phone)).toEqual(["min_length"]);
    expect(passwordViolations("12345678901234", phone)).toEqual(["letters_and_digits"]);
    expect(passwordViolations("abcdefghijklmn", phone)).toEqual(["letters_and_digits"]);
    expect(passwordViolations(`a${phone}`, phone)).toEqual(["contains_phone"]);
    expect(passwordViolations("Password123", phone)).toEqual(["weak_password"]);
    expect(passwordViolations("1q2w3e4r5t", phone)).toEqual(["weak_password"]);
    // 几条一起不满足：都列出来
    expect(passwordViolations("abc", phone)).toEqual(["min_length", "letters_and_digits"]);
    expect(passwordViolations("十位以上的中文口令也要有字母与数字", phone)).toEqual([
      "letters_and_digits",
    ]);
  });
});

describe("恢复码与激活码", () => {
  it("恢复码 10 个、各 10 位、互不相同；入库的是 sha256；输入不分大小写、可带连字符", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const first = codes[0] as string;
    expect(recoveryCodeHash(first)).toBe(hashes[0]);
    expect(recoveryCodeHash(first.replace("-", "").toLowerCase())).toBe(hashes[0]);
    expect(recoveryCodeHash(` ${first} `)).toBe(hashes[0]);
    for (const junk of ["", "ABCDE", `${first}X`, "ABCDE_FGHJK"])
      expect(recoveryCodeHash(junk)).toBeNull();
    expect(recoveryHashesOf(hashes)).toEqual(hashes);
    expect(recoveryHashesOf({ not: "array" })).toEqual([]);
    expect(recoveryHashesOf([1, "a", null])).toEqual(["a"]);
  });

  it("激活码 8 位；哈希 32 字节；不分大小写；写法不对的不认", () => {
    const code = generateActivationCode();
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(activationCodeHash(code)).toHaveLength(32);
    expect(activationCodeHash(code.toLowerCase())?.equals(activationCodeHash(code) as Buffer)).toBe(
      true,
    );
    for (const junk of ["", "ABCDEFG", "ABCDEFGHJ", "ABCD-EFG!"])
      expect(activationCodeHash(junk)).toBeNull();
  });
});
