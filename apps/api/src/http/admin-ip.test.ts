import { createApp } from "../app.js";
import { HANDLERS } from "../routes/index.js";
import { useTestApi } from "../testing/index.js";
import { signInAsStaff } from "@liyoxi/services/testing";
import { expect, it, describe } from "vitest";
import { createAdminIpPolicy } from "./admin-ip.js";
const testApi = useTestApi();
describe("后台来源检查", () => {
  it("空白默认不限；IPv4/IPv6/CIDR/映射地址规范化与无地址拒绝", () => {
    expect(createAdminIpPolicy([])(null)).toBe(true);
    const allowed = createAdminIpPolicy(["198.51.100.0/24", "2001:db8::/32"]);
    expect(allowed("198.51.100.20")).toBe(true);
    expect(allowed("::ffff:198.51.100.20")).toBe(true);
    expect(allowed("2001:DB8:1::20")).toBe(true);
    expect(allowed("203.0.113.10")).toBe(false);
    expect(allowed("2001:db9::20")).toBe(false);
    expect(allowed(null)).toBe(false);
    expect(() => createAdminIpPolicy(["198.51.100.0/33"])).toThrow();
    expect(() => createAdminIpPolicy(["10.0.0.0/1e1"])).toThrow();
  });
  it("真实admin认证前拒绝和独立offnet安全事实；伪造XFF无效，可信代理只用右边真实来源，已登录也拒绝", async () => {
    const live = await testApi.start(),
      prisma = await testApi.db.prisma();
    const signed = await signInAsStaff(prisma, { roleKey: "super_admin" });
    const runtime = {
      ...live.runtime,
      env: { ...live.runtime.env, ADMIN_IP_ALLOWLIST: ["198.51.100.0/24", "2001:db8::/32"] },
    };
    const { app } = createApp({
      runtime,
      handlers: HANDLERS,
      trustedProxy: { hops: 1, cidrs: ["10.0.0.0/8"] },
    });
    const request = (peer: string, headers: Record<string, string> = {}) =>
      app.request(
        "http://localhost/api/v1/admin/auth/me",
        { headers },
        { incoming: { socket: { remoteAddress: peer } } },
      );
    const blocked = await request("203.0.113.7", { "x-forwarded-for": "198.51.100.7" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: "IP_NOT_ALLOWED" });
    const logged = await request("203.0.113.7", signed.headers);
    expect(logged.status).toBe(403);
    const admitted = await request("10.0.0.2", { "x-forwarded-for": "203.0.113.99,198.51.100.7" });
    expect(admitted.status).toBe(401);
    const rejected = await request("10.0.0.2", { "x-forwarded-for": "198.51.100.7,203.0.113.99" });
    expect(rejected.status).toBe(403);
    const ipv6 = await request("2001:db9::1", signed.headers);
    expect(ipv6.status).toBe(403);
    const events = await prisma.authEvent.findMany({ where: { event: "offnet_denied" } });
    expect(events).toHaveLength(4);
    expect(
      events.every((row) => row.space === "staff" && row.subjectId === null && row.method === null),
    ).toBe(true);
    const staff = await prisma.staff.findUniqueOrThrow({ where: { id: signed.staff.id } });
    expect(staff).toMatchObject({
      status: "active",
      failTrusted: 0,
      failUntrusted: 0,
    });
  }, 60_000);
});
