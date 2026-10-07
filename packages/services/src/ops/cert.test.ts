import { describe, expect, it, vi } from "vitest";
import { createClock } from "../testing/index.js";
import { failed, ok } from "../providers/types.js";
import { createCertChecker } from "./cert.js";
import type { TlsCertificateProbe } from "./cert.js";

const clock = createClock(new Date("2026-10-01T00:00:00Z"));
const expires = (days: number) => new Date(clock.now().getTime() + days * 86_400_000);
describe("证书检查", () => {
  it("没有明确域名就未配置，不触发网络且不假绿色", async () => {
    const probe = vi.fn<TlsCertificateProbe>();
    expect(await createCertChecker({ clock, domains: [], probe }).run()).toEqual({
      configured: false,
      certificates: [],
    });
    expect(probe).not.toHaveBeenCalled();
  });
  it("21/7天边界准确，已过期P1；同一域名只检查一次", async () => {
    const days = [21, 20.99, 7, 6.99, -1];
    const probe = vi.fn<TlsCertificateProbe>(async () =>
      ok({ expiresAt: expires(days.shift()!), trusted: true }),
    );
    const domains = [
      "api.example.invalid",
      "portal.example.invalid",
      "a.example.invalid",
      "b.example.invalid",
      "c.example.invalid",
    ];
    const result = await createCertChecker({
      clock,
      domains: [...domains, domains[0]!],
      probe,
    }).run();
    expect(result.certificates.map((entry) => [entry.status, entry.priority])).toEqual([
      ["healthy", undefined],
      ["expiring", "P2"],
      ["expiring", "P2"],
      ["expiring", "P1"],
      ["expiring", "P1"],
    ]);
    expect(probe).toHaveBeenCalledTimes(5);
  });
  it("不可信证书P1、连接失败P2而非健康，异常被固定降级", async () => {
    const probe = vi
      .fn<TlsCertificateProbe>()
      .mockResolvedValueOnce(ok({ expiresAt: expires(30), trusted: false }))
      .mockResolvedValueOnce(failed("unavailable", "脱敏失败"))
      .mockRejectedValueOnce(new Error("private-provider-config"));
    const result = await createCertChecker({
      clock,
      domains: ["a.example.invalid", "b.example.invalid", "c.example.invalid"],
      probe,
    }).run();
    expect(result.certificates.map((entry) => [entry.status, entry.priority])).toEqual([
      ["untrusted", "P1"],
      ["unavailable", "P2"],
      ["unavailable", "P2"],
    ]);
    expect(JSON.stringify(result)).not.toContain("private-provider-config");
  });
  it.each([
    "https://example.invalid",
    "localhost",
    "1.2.3.4",
    "a.example.invalid:443",
    "*.example.invalid",
    "a.example.invalid/path",
  ])("拒绝猜测或非DNS目标%s", (domain) => {
    expect(() => createCertChecker({ clock, domains: [domain] })).toThrow("显式DNS域名");
  });
});
