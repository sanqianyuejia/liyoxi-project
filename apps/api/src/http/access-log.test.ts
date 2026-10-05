// 访问日志里查询参数的遮盖（约定 C7、A3）。不连库。
import { describe, expect, it } from "vitest";

import { REDACTED_QUERY_KEYS, redactUrl } from "./access-log.js";

describe("redactUrl", () => {
  it("token、code、sig 等的值被遮住，别的参数原样", () => {
    expect(redactUrl("http://x/api/v1/hooks/ci/media-jobs/1?sig=abc123&page=2")).toBe(
      "/api/v1/hooks/ci/media-jobs/1?sig=***&page=2",
    );
    expect(redactUrl("http://x/api/v1/m/portal-tickets/lookup?code=K7Q2M9XA")).toBe(
      "/api/v1/m/portal-tickets/lookup?code=***",
    );
    expect(redactUrl("http://x/api/v1/hooks/sms/status-reports?Token=t0k&TOKEN=again")).toBe(
      "/api/v1/hooks/sms/status-reports?Token=***&TOKEN=***",
    );
  });

  it("登记的每个参数名都遮；没有查询串只给路径", () => {
    const query = REDACTED_QUERY_KEYS.map((key) => `${key}=secret-value`).join("&");
    expect(redactUrl(`http://x/p?${query}`)).not.toContain("secret-value");
    expect(redactUrl("http://x/healthz")).toBe("/healthz");
  });
});
