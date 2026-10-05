// 再验证与二次确认回显两件工具（约定 C54、C66、C86；D4 第 7.5 节）。
import { PERMISSIONS, STEP_UP_PERMISSION_KEYS } from "@liyoxi/contract/authz";
import { describe, expect, it } from "vitest";

import { isAppError } from "../kernel/index.js";

import { assertConfirm } from "./confirm.js";
import {
  assertStepUp,
  isStepUpFresh,
  requiresStepUp,
  STEP_UP_TTL_MS,
  stepUpValidUntil,
} from "./step-up.js";

function errorOf(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (isAppError(error)) return error.error;
    throw error;
  }
}

describe("再验证", () => {
  const at = new Date("2026-01-05T04:00:00.000Z");
  const after = (ms: number): Date => new Date(at.getTime() + ms);

  it("要不要再验证只看注册表", () => {
    expect(STEP_UP_TTL_MS).toBe(600_000);
    for (const item of PERMISSIONS) {
      expect(requiresStepUp(item.key), item.key).toBe(STEP_UP_PERMISSION_KEYS.includes(item.key));
    }
    expect(requiresStepUp("sys.role.edit")).toBe(true);
    expect(requiresStepUp("self.mfa.reset")).toBe(true);
    expect(requiresStepUp("sys.staff.manage")).toBe(false);
  });

  it("窗口 10 分钟：恰好 10 分钟还在，多 1 毫秒即过期；没验证过算过期", () => {
    expect(stepUpValidUntil(at)).toEqual(after(STEP_UP_TTL_MS));
    expect(stepUpValidUntil(null)).toBeNull();
    expect(isStepUpFresh(at, at)).toBe(true);
    expect(isStepUpFresh(at, after(STEP_UP_TTL_MS))).toBe(true);
    expect(isStepUpFresh(at, after(STEP_UP_TTL_MS + 1))).toBe(false);
    expect(isStepUpFresh(null, at)).toBe(false);
  });

  it("过期且权限点标了再验证才抛 STEP_UP_REQUIRED；声明跳过的不查", () => {
    const late = after(STEP_UP_TTL_MS + 1);
    const session = { stepUpAt: at };
    expect(errorOf(() => assertStepUp(session, "sys.role.edit", after(1_000)))).toBeNull();
    expect(errorOf(() => assertStepUp(session, "sys.role.edit", late))).toBe("STEP_UP_REQUIRED");
    expect(errorOf(() => assertStepUp({ stepUpAt: null }, "sys.role.edit", at))).toBe(
      "STEP_UP_REQUIRED",
    );
    expect(errorOf(() => assertStepUp(session, "sys.staff.manage", late))).toBeNull();
    expect(
      errorOf(() => assertStepUp(session, "sys.role.edit", late, { skipStepUp: true })),
    ).toBeNull();
    // 再验证之后（stepup_at 更新）同一个请求重放即过
    expect(errorOf(() => assertStepUp({ stepUpAt: late }, "sys.role.edit", late))).toBeNull();
  });
});

describe("二次确认回显", () => {
  const current = { refundNo: "TK20260105001", amountFen: 19_900 };

  it("逐字段严格相等才过；多带的字段不看", () => {
    expect(errorOf(() => assertConfirm({ ...current }, current))).toBeNull();
    expect(errorOf(() => assertConfirm({ ...current, note: "x" }, current))).toBeNull();
    expect(errorOf(() => assertConfirm({}, {}))).toBeNull();
  });

  it.each([
    ["金额变了", { refundNo: "TK20260105001", amountFen: 19_800 }],
    ["单号变了", { refundNo: "TK20260105002", amountFen: 19_900 }],
    ["类型不同（金额回成字符串）", { refundNo: "TK20260105001", amountFen: "19900" }],
    ["缺字段", { refundNo: "TK20260105001" }],
    ["没带 confirm", undefined],
    ["confirm 是 null", null],
    ["confirm 不是对象", "TK20260105001"],
    ["confirm 是数组", ["TK20260105001", 19_900]],
  ])("%s：409 CONFIRM_MISMATCH", (_name, confirm) => {
    expect(errorOf(() => assertConfirm(confirm, current))).toBe("CONFIRM_MISMATCH");
  });

  it("库里是 null 的字段要回 null，不回不算", () => {
    expect(errorOf(() => assertConfirm({ dueDate: null }, { dueDate: null }))).toBeNull();
    expect(errorOf(() => assertConfirm({}, { dueDate: null }))).toBe("CONFIRM_MISMATCH");
    expect(errorOf(() => assertConfirm({ dueDate: null }, { dueDate: "2026-01-05" }))).toBe(
      "CONFIRM_MISMATCH",
    );
  });
});
