import { describe, expect, it } from "vitest";

import { newSessionToken, sessionTokenHash, staffCookieNames } from "./session.js";

// 会话的两样不连库的东西：Cookie 名与令牌。会话的建、校验、吊销在 auth.db.test.ts。
describe("会话的 Cookie 与令牌", () => {
  it("Cookie 名：local、test 用无前缀的名字、不带 Secure；其余环境用 __Host- 前缀", () => {
    expect(staffCookieNames("test")).toEqual({
      session: "lyx_admin",
      device: "lyx_dev",
      secure: false,
    });
    expect(staffCookieNames("local").session).toBe("lyx_admin");
    expect(staffCookieNames("stg")).toEqual({
      session: "__Host-lyx_admin",
      device: "__Host-lyx_dev",
      secure: true,
    });
    expect(staffCookieNames("prod").secure).toBe(true);
  });

  it("会话令牌：32 字节随机数的 base64url；库里存的是它的 sha256；写法不对的不认", () => {
    const token = newSessionToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(sessionTokenHash(token)).toHaveLength(32);
    expect(sessionTokenHash(token)?.equals(sessionTokenHash(token) as Buffer)).toBe(true);
    for (const junk of ["", "abc", `${token}=`, token.slice(1), `${token}.x`]) {
      expect(sessionTokenHash(junk)).toBeNull();
    }
  });
});
