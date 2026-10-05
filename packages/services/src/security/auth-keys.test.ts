import { describe, expect, it } from "vitest";

import {
  authKeysFromEnv,
  createAuthKeys,
  loadAuthKeys,
  openMfaSecret,
  sealMfaSecret,
  selfCheckAuthKeys,
} from "./auth-keys.js";
import { fakeKey } from "./__fixtures__/keys.js";
import { kidOf } from "./crypto.js";
import { SecurityError } from "./keyring.js";

// 后台登录的三把密钥（W1-01a）。密钥是固定字节现造的，不读任何文件。
const input = {
  ticket: fakeKey(0x11),
  device: fakeKey(0x12),
  mfa: { current: "m1", keys: { m1: fakeKey(0x13) } },
};
const keys = createAuthKeys(input);
const codeOf = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    return error instanceof SecurityError ? error.code : String(error);
  }
  return undefined;
};

describe("后台登录的密钥", () => {
  it("签名稳定、验得过；改一个字、换一种用途都验不过", () => {
    const mac = keys.sign("ticket", "abc");
    expect(mac).toHaveLength(32);
    expect(keys.verify("ticket", "abc", mac)).toBe(true);
    expect(keys.verify("ticket", "abd", mac)).toBe(false);
    expect(keys.verify("device", "abc", mac)).toBe(false);
    expect(keys.verify("ticket", "abc", mac.subarray(0, 31))).toBe(false);
  });

  it("MFA 密钥加密后解得回；换列解不开；轮换后旧密文照样能解，新密文用新 kid", () => {
    const sealed = sealMfaSecret(keys, "staff.totp_secret_enc", "JBSWY3DPEHPK3PXP");
    expect(kidOf(sealed)).toBe("m1");
    expect(openMfaSecret(keys, "staff.totp_secret_enc", sealed)).toBe("JBSWY3DPEHPK3PXP");
    expect(codeOf(() => openMfaSecret(keys, "staff.totp_pending_secret_enc", sealed))).toBe(
      "decrypt_failed",
    );
    const rotated = createAuthKeys({
      ...input,
      mfa: { current: "m2", keys: { m1: fakeKey(0x13), m2: fakeKey(0x14) } },
    });
    expect(openMfaSecret(rotated, "staff.totp_secret_enc", sealed)).toBe("JBSWY3DPEHPK3PXP");
    expect(kidOf(sealMfaSecret(rotated, "staff.totp_secret_enc", "x"))).toBe("m2");
    expect(rotated.mfaKids).toEqual(["m1", "m2"]);
  });

  it("不合格的密钥：长度不对、当前 kid 不在、两把相同，都拒绝", () => {
    expect(codeOf(() => createAuthKeys({ ...input, ticket: Buffer.alloc(31, 1) }))).toBe(
      "keyring_invalid",
    );
    expect(
      codeOf(() => createAuthKeys({ ...input, mfa: { current: "m9", keys: input.mfa.keys } })),
    ).toBe("keyring_invalid");
    expect(codeOf(() => createAuthKeys({ ...input, device: input.ticket }))).toBe(
      "keyring_invalid",
    );
    expect(
      codeOf(() =>
        createAuthKeys({ ...input, mfa: { current: "m1", keys: { m1: input.device } } }),
      ),
    ).toBe("keyring_invalid");
  });

  it("没配 AUTH_KEYS_FILE：keyring_missing；配了：自检通过并给出可用的密钥", () => {
    expect(codeOf(() => authKeysFromEnv({}))).toBe("keyring_missing");
    const b64 = (fill: number) => fakeKey(fill).toString("base64");
    const loaded = loadAuthKeys({
      AUTH_KEYS: { ticket: b64(1), device: b64(2), mfa: { current: "k", keys: { k: b64(3) } } },
    });
    expect(loaded.mfaCurrentKid).toBe("k");
    expect(() => selfCheckAuthKeys(keys)).not.toThrow();
  });

  it("报错与打印都带不出密钥", () => {
    expect(JSON.stringify(keys)).not.toContain(fakeKey(0x11).toString("base64"));
    const error = (() => {
      try {
        createAuthKeys({ ...input, ticket: "x".repeat(40) });
      } catch (thrown) {
        return thrown as Error;
      }
      return undefined;
    })();
    expect(error?.message).not.toContain("xxxx");
  });
});
