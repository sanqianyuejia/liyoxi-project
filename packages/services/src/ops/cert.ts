import { checkServerIdentity, connect } from "node:tls";

import type { Clock } from "../kernel/index.js";
import type { ProviderResult } from "../providers/types.js";
import { failed, ok } from "../providers/types.js";

export type TlsCertificateProbe = (
  domain: string,
  options: { signal: AbortSignal; timeoutMs: number },
) => Promise<ProviderResult<{ expiresAt: Date; trusted: boolean }>>;
export interface CertificateResult {
  readonly domain: string;
  readonly status: "healthy" | "expiring" | "unavailable" | "untrusted";
  readonly remainingDays?: number;
  readonly priority?: "P1" | "P2";
}

/** 只检查显式部署域名的443端口，不推导DNS或扫描其他节点。 */
export const probeTlsCertificate: TlsCertificateProbe = (domain, options) =>
  new Promise((resolve) => {
    if (options.signal.aborted) {
      resolve(failed("unavailable", "证书检查已中止"));
      return;
    }
    const socket = connect({
      host: domain,
      servername: domain,
      port: 443,
      rejectUnauthorized: false,
    });
    let finished = false;
    const finish = (result: ProviderResult<{ expiresAt: Date; trusted: boolean }>) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      options.signal.removeEventListener("abort", aborted);
      clearTimeout(timer);
      resolve(result);
    };
    const aborted = () => finish(failed("unavailable", "证书检查已中止"));
    const timer = setTimeout(
      () => finish(failed("unavailable", "证书检查超时")),
      options.timeoutMs,
    );
    timer.unref();
    options.signal.addEventListener("abort", aborted, { once: true });
    socket.once("error", () => finish(failed("unavailable", "证书检查连接失败")));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      const expiresAt = new Date(certificate.valid_to);
      if (!Number.isFinite(expiresAt.getTime())) {
        finish(failed("rejected", "证书有效期不合格"));
        return;
      }
      finish(
        ok({
          expiresAt,
          trusted: socket.authorized && checkServerIdentity(domain, certificate) === undefined,
        }),
      );
    });
  });

export function createCertChecker(options: {
  readonly clock: Clock;
  readonly domains: readonly string[];
  readonly probe?: TlsCertificateProbe;
  readonly timeoutMs?: number;
}) {
  const domains = [...new Set(options.domains)];
  if (
    domains.some(
      (domain) =>
        domain.length > 253 ||
        !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(domain),
    )
  )
    throw new TypeError("证书检查仅接受显式DNS域名");
  const probe = options.probe ?? probeTlsCertificate;
  return {
    async run(
      input: { signal?: AbortSignal } = {},
    ): Promise<{ configured: boolean; certificates: readonly CertificateResult[] }> {
      if (domains.length === 0) return { configured: false, certificates: [] };
      const signal = input.signal ?? new AbortController().signal;
      const certificates: CertificateResult[] = [];
      for (const domain of domains) {
        let result: Awaited<ReturnType<TlsCertificateProbe>>;
        try {
          result = await probe(domain, { signal, timeoutMs: options.timeoutMs ?? 2_000 });
        } catch {
          result = failed("unavailable", "证书检查失败");
        }
        if (!result.ok) {
          certificates.push({ domain, status: "unavailable", priority: "P2" });
          continue;
        }
        if (!Number.isFinite(result.value.expiresAt.getTime())) {
          certificates.push({ domain, status: "unavailable", priority: "P2" });
          continue;
        }
        const remainingDays =
          (result.value.expiresAt.getTime() - options.clock.now().getTime()) / 86_400_000;
        if (!result.value.trusted) {
          certificates.push({ domain, remainingDays, status: "untrusted", priority: "P1" });
          continue;
        }
        certificates.push({
          domain,
          remainingDays,
          status: remainingDays < 21 ? "expiring" : "healthy",
          ...(remainingDays < 7
            ? { priority: "P1" as const }
            : remainingDays < 21
              ? { priority: "P2" as const }
              : {}),
        });
      }
      return { configured: true, certificates };
    },
  };
}
