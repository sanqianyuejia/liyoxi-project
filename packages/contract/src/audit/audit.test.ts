import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { importsReachableFrom } from "../__fixtures__/import-scan.js";
import {
  AUDIT_ACTION_PATTERN,
  AUDIT_AUTH_METHODS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
  AuditDiffSchema,
  AuditMetaSchema,
  isAuditAction,
  isAuditCategory,
  isAuditTargetType,
  unknownAuditTargetTypes,
} from "../index.js";
import { STATE_MACHINE_NAMES } from "../registry/machines.js";

// 审计域登记值的自测（W0-14）：与 03 分组文档 第 3.3 节对账；写法；纯常量不带 Zod。
// 对象类型是不是库里真有的表，由 services 的 audit 用例连真库核对。

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(
  resolve(here, "../../../../docs/data-model/03-staff-authz-audit.md"),
  "utf8",
);

/** 03 分组 第 3.3 节的表里，第一格是 `列名` 的那一行的第二格 */
function registeredCell(column: string): string {
  const section = doc.slice(doc.indexOf("\n### 3.3 "), doc.indexOf("\n## 4. "));
  const line = section.split("\n").find((row) => row.startsWith(`| \`${column}\` |`));
  if (line === undefined) throw new Error(`03 分组 第 3.3 节没有 ${column} 一行`);
  return line.split(" | ")[1] as string;
}
const backticked = (text: string): string[] =>
  [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);

describe("类别编码", () => {
  it("与 03 分组 第 3.3 节的登记逐个一致，数量等于文档写的“共 N 个”", () => {
    const cell = registeredCell("audit_log.category");
    expect([...AUDIT_CATEGORIES].sort()).toEqual(backticked(cell).sort());
    expect(AUDIT_CATEGORIES).toHaveLength(Number(/共 (\d+) 个/.exec(cell)?.[1]));
  });

  it("不重复，都是小写蛇形", () => {
    expect(new Set(AUDIT_CATEGORIES).size).toBe(AUDIT_CATEGORIES.length);
    for (const category of AUDIT_CATEGORIES) expect(category).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(isAuditCategory("refund")).toBe(true);
    expect(isAuditCategory("退款")).toBe(false);
  });
});

describe("对象类型", () => {
  it("不重复，都过库里的格式 CHECK（小写蛇形）", () => {
    expect(new Set(AUDIT_TARGET_TYPES).size).toBe(AUDIT_TARGET_TYPES.length);
    for (const type of AUDIT_TARGET_TYPES) expect(type).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(isAuditTargetType("approval_request")).toBe(true);
    expect(AUDIT_TARGET_TYPES.filter((name) => name === "work_calendar_day")).toEqual([
      "work_calendar_day",
    ]);
    expect(isAuditTargetType("work_calendar_day")).toBe(true);
    expect(isAuditTargetType("ApprovalRequest")).toBe(false);
  });

  it("03 分组 第 3.3 节点了名的表都登记了", () => {
    // 这一格里另有几个不是表名的反引号词
    const notTables = ["target_id", "target_key", "target_type", "access", "packages/contract"];
    const named = backticked(registeredCell("audit_log.target_type")).filter(
      (name) => !notTables.includes(name),
    );
    expect(named.length).toBeGreaterThan(20);
    expect(named.filter((name) => !isAuditTargetType(name))).toEqual([]);
  });

  // KF-1：flow.transition 没收到审计内容时按状态机登记的默认描述补一条 activity，对象类型写状态机的表名；
  // 表名不在登记里，audit.record 会拒绝，迁移整个回滚
  it("25 张状态机表都是登记了的对象类型", () => {
    expect(STATE_MACHINE_NAMES.filter((machine) => !isAuditTargetType(machine))).toEqual([]);
  });

  it("对照表名单：库里没有的对象类型被列出来", () => {
    expect(unknownAuditTargetTypes(AUDIT_TARGET_TYPES)).toEqual([]);
    const withoutStaff = AUDIT_TARGET_TYPES.filter((type) => type !== "staff");
    expect(unknownAuditTargetTypes(new Set(withoutStaff))).toEqual(["staff"]);
  });
});

describe("登录方式与动作", () => {
  it("登录方式与 03 分组 第 3.3 节一致", () => {
    expect([...AUDIT_AUTH_METHODS]).toEqual(backticked(registeredCell("audit_log.auth_method")));
  });

  it("动作是 <领域>.<对象>.<动作>：小写蛇形，至少三段", () => {
    for (const action of ["finance.refund.execute", "cli.staff.bootstrap", "a.b.c.d", "a1.b_2.c"]) {
      expect(isAuditAction(action), action).toBe(true);
    }
    for (const action of [
      "",
      "refund",
      "finance.refund",
      "Finance.refund.execute",
      "a..c",
      "a.b.c.",
    ]) {
      expect(AUDIT_ACTION_PATTERN.test(action), action).toBe(false);
    }
  });
});

describe("jsonb 结构", () => {
  const digest = { keys: ["a", "b"], length: 20_000, sha256: "0".repeat(64) };

  it("AuditDiff：变化的字段，或超过 16KB 时的摘要", () => {
    expect(AuditDiffSchema.parse({ displayName: "王**", phone: "138****5678" })).toEqual({
      displayName: "王**",
      phone: "138****5678",
    });
    expect(AuditDiffSchema.parse(digest)).toEqual(digest);
    expect(AuditDiffSchema.safeParse(["a"]).success).toBe(false);
    expect(AuditDiffSchema.safeParse("x").success).toBe(false);
  });

  it("AuditMeta：已知的键有类型，别的键照收", () => {
    const meta = {
      approvalStatus: "approved",
      urlTtlSec: 300,
      rowCount: 12,
      impact: { tickets: 3 },
    };
    expect(AuditMetaSchema.parse({ ...meta, extra: [1, 2] })).toEqual({ ...meta, extra: [1, 2] });
    expect(AuditMetaSchema.parse(digest)).toEqual(digest);
    expect(AuditMetaSchema.safeParse({ urlTtlSec: "300" }).success).toBe(false);
    expect(AuditMetaSchema.safeParse({ rowCount: 1.5 }).success).toBe(false);
  });
});

describe("纯常量", () => {
  it("registry.ts 不引任何包，也不引别的文件", () => {
    const scan = importsReachableFrom(join(here, "registry.ts"));
    expect(scan.files).toEqual([join(here, "registry.ts")]);
    expect(scan.packages).toEqual([]);
    expect(scan.unresolved).toEqual([]);
  });
});
