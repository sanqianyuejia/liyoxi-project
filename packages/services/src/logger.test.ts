// 日志构造的用例（W0-22；D7 第 9.1 节）：固定字段、脱敏。不连库。
import { describe, expect, it } from "vitest";

import { createLogger, LOG_REDACT_KEYS } from "./logger.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    svc: "api",
    env: "test",
    level: "debug",
    version: "sha-test",
    destination: { write: (text: string) => void lines.push(JSON.parse(text)) },
  });
  return { logger, lines };
}

describe("createLogger", () => {
  it("每条日志带固定字段：ts、level、svc、env、ver、node", () => {
    const { logger, lines } = capture();
    logger.info({ evt: "probe" }, "探针跑完");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      svc: "api",
      env: "test",
      ver: "sha-test",
      evt: "probe",
      msg: "探针跑完",
    });
    expect(typeof lines[0]?.node).toBe("string");
    expect(Number.isNaN(Date.parse(String(lines[0]?.ts)))).toBe(false);
  });

  it("登记的键不论在顶层还是嵌套里，值都被遮住", () => {
    const { logger, lines } = capture();
    const secret = "不该出现在日志里";
    const flat = Object.fromEntries(LOG_REDACT_KEYS.map((key) => [key, secret]));
    logger.info({ ...flat, headers: { ...flat }, req: { headers: { ...flat } } }, "脱敏");
    expect(JSON.stringify(lines)).not.toContain(secret);
    expect(lines[0]).toMatchObject({ password: "***", headers: { "set-cookie": "***" } });
  });

  it("code 只在顶层与装入参的容器里遮；错误对象的 code 留着", () => {
    const { logger, lines } = capture();
    const error = Object.assign(new Error("事务超时"), { code: "P2028" });
    logger.error({ code: "wx-login-code", query: { code: "c", page: 1 }, err: error }, "出错");
    expect(lines[0]).toMatchObject({
      code: "***",
      query: { code: "***", page: 1 },
      err: { code: "P2028", message: "事务超时" },
    });
  });
});
