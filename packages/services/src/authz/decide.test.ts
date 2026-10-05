// 验收第 1 条的表驱动部分（任务书 W1-01a 第 7 节）：8 角色 × 13 模块 × 两种需求、每个 V1.0 权限点 × 主管与否，
// 结果与角色的代码默认配置逐格相同。期望不经被测代码：模块那一半直接读契约的等级矩阵，
// 权限点那一半直接读注册表的“默认授予”，另钉几格照 PRD 第 3.3 节矩阵与 D4 第 7.1 节的表抄下来的。
import {
  ADMIN_MODULE_KEYS,
  PERMISSIONS,
  STEP_UP_PERMISSION_KEYS,
  staffRoleDefault,
} from "@liyoxi/contract/authz";
import type {
  AdminModuleKey,
  PermissionDef,
  PermissionKey,
  StaffRoleKey,
} from "@liyoxi/contract/authz";
import { describe, expect, it } from "vitest";

import { isAppError } from "../kernel/index.js";

import { contextOf, ROLE_KEYS } from "./__fixtures__/contexts.js";
import {
  assertAccess,
  assertPermission,
  authorize,
  decideAccess,
  hasPermission,
  satisfiesLevel,
} from "./decide.js";
import type { ModuleNeed } from "./decide.js";
import { V1_PERMISSION_KEYS } from "./role-config.js";
import { STEP_UP_TTL_MS } from "./step-up.js";

const NEEDS: readonly ModuleNeed[] = ["view", "edit"];
const V1 = PERMISSIONS.filter((item) => item.since === "v1.0");

function errorOf(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (isAppError(error)) return error.error;
    throw error;
  }
}

/** 注册表的“默认授予”说这个角色（是不是主管）该不该有这个权限点 */
function grantedByRegistry(
  item: PermissionDef<PermissionKey>,
  roleKey: StaffRoleKey,
  isLead: boolean,
): boolean {
  if (roleKey === "super_admin") return true;
  const { grant } = item;
  switch (grant.kind) {
    case "roles": {
      const found = grant.roles.find((entry) => entry.role === roleKey);
      return found !== undefined && (!found.leadOnly || isLead);
    }
    case "module_viewers": {
      const moduleKey = item.key.split(".")[0] as AdminModuleKey;
      return staffRoleDefault(roleKey)?.moduleLevels[moduleKey] !== "n";
    }
    case "all_staff":
      return true;
    default:
      return false;
  }
}

describe("模块等级：8 角色 × 13 模块 × 两种需求", () => {
  it("数得出 208 格，逐格与等级矩阵相同", () => {
    let cells = 0;
    for (const roleKey of ROLE_KEYS) {
      const levels = staffRoleDefault(roleKey)?.moduleLevels;
      for (const isLead of [false, true]) {
        const ctx = contextOf(roleKey, { isLead });
        for (const moduleKey of ADMIN_MODULE_KEYS) {
          for (const need of NEEDS) {
            const level = levels?.[moduleKey];
            const expected = need === "view" ? level !== "n" : level === "e" || level === "o";
            const decision = decideAccess(ctx, {
              module: { module: moduleKey, need },
              permission: null,
            });
            expect(decision.allowed, `${roleKey} ${moduleKey} ${need}`).toBe(expected);
            if (!decision.allowed) expect(decision.reason).toBe("module_level");
            if (!isLead) cells += 1;
          }
        }
      }
    }
    expect(cells).toBe(ROLE_KEYS.length * ADMIN_MODULE_KEYS.length * NEEDS.length);
    expect(cells).toBe(208);
  });

  // 照 PRD 第 3.3 节的矩阵抄的几格：[角色, 模块, 能看, 能改]
  it.each<[StaffRoleKey, AdminModuleKey, boolean, boolean]>([
    ["super_admin", "system", true, true],
    ["super_admin", "report", true, false],
    ["cs", "merchant", true, true],
    ["cs", "finance", false, false],
    ["cs", "system", false, false],
    ["delivery_manager", "order", true, false],
    ["delivery_manager", "delivery", true, true],
    ["editor", "delivery", true, true],
    ["editor", "publish", false, false],
    ["editor", "billing", false, false],
    ["publisher", "publish", true, true],
    ["publisher", "delivery", true, false],
    ["content_ops", "drama", true, true],
    ["content_ops", "finance", false, false],
    ["channel_ops", "channel", true, true],
    ["channel_ops", "delivery", false, false],
    ["finance", "finance", true, true],
    ["finance", "order", true, true],
    ["finance", "delivery", false, false],
  ])("%s 对 %s：看 %s，改 %s", (roleKey, moduleKey, view, edit) => {
    const ctx = contextOf(roleKey);
    const allowed = (need: ModuleNeed): boolean =>
      decideAccess(ctx, { module: { module: moduleKey, need }, permission: null }).allowed;
    expect([allowed("view"), allowed("edit")]).toEqual([view, edit]);
  });

  it("等级与需求：n 都不过；v 只过查看；o、e 都过", () => {
    expect(NEEDS.map((need) => satisfiesLevel("n", need))).toEqual([false, false]);
    expect(NEEDS.map((need) => satisfiesLevel("v", need))).toEqual([true, false]);
    expect(NEEDS.map((need) => satisfiesLevel("o", need))).toEqual([true, true]);
    expect(NEEDS.map((need) => satisfiesLevel("e", need))).toEqual([true, true]);
  });
});

describe("权限点：每个 V1.0 权限点 × 8 角色 × 主管与否", () => {
  it("逐格与注册表的默认授予相同", () => {
    expect(V1.length).toBeGreaterThan(0);
    expect(V1.map((item) => item.key)).toEqual([...V1_PERMISSION_KEYS]);
    for (const roleKey of ROLE_KEYS) {
      for (const isLead of [false, true]) {
        const ctx = contextOf(roleKey, { isLead });
        for (const item of V1) {
          const where = `${roleKey}${isLead ? "（主管）" : ""} ${item.key}`;
          const expected = grantedByRegistry(item, roleKey, isLead);
          expect(hasPermission(ctx, item.key), where).toBe(expected);
          const decision = decideAccess(ctx, { module: null, permission: item.key });
          expect(decision.allowed, where).toBe(expected);
          if (!decision.allowed) expect(decision.reason).toBe("permission");
        }
      }
    }
  });

  // 照 D4 第 7.1 节的表抄的几格：[权限点, 角色, 非主管, 主管]
  it.each<[PermissionKey, StaffRoleKey, boolean, boolean]>([
    ["merchant.manager.assign", "delivery_manager", false, true],
    ["merchant.manager.assign", "cs", false, false],
    ["merchant.profile.proxy_edit", "cs", true, true],
    ["merchant.user.disable", "cs", false, true],
    ["delivery.ticket.assign_publisher", "publisher", false, true],
    ["delivery.ticket.assign_publisher", "delivery_manager", true, true],
    ["delivery.sample.upload", "editor", true, true],
    ["finance.refund.approve", "finance", true, true],
    ["finance.refund.approve", "cs", false, false],
    ["order.refund.request", "cs", true, true],
    ["order.refund.request", "finance", false, false],
    ["drama.shelf", "content_ops", true, true],
    ["sys.role.edit", "finance", false, false],
    ["sys.role.edit", "super_admin", true, true],
    ["finance.export", "finance", true, true],
    ["finance.export", "cs", false, false],
    ["self.mfa.reset", "editor", true, true],
  ])("%s 对 %s：非主管 %s，主管 %s", (key, roleKey, plain, lead) => {
    expect([
      hasPermission(contextOf(roleKey), key),
      hasPermission(contextOf(roleKey, { isLead: true }), key),
    ]).toEqual([plain, lead]);
  });

  it("V1.1 的权限点谁都不持有，超级管理员也不持有；库里把它打开也不算", () => {
    const later = PERMISSIONS.filter((item) => item.since !== "v1.0");
    expect(later.length).toBeGreaterThan(0);
    for (const roleKey of ROLE_KEYS) {
      const raw = {
        moduleLevels: {},
        actions: Object.fromEntries(later.map((item) => [item.key, { on: true }])),
        dataScope: "all",
      };
      const ctx = contextOf(roleKey, { isLead: true, raw });
      for (const item of later) expect(hasPermission(ctx, item.key), item.key).toBe(false);
    }
  });
});

describe("两项一起判，与抛出的错误", () => {
  const manager = contextOf("delivery_manager");

  it("交付经理对订单只有查看，照样能发起补偿延长：权限点独立于编辑等级", () => {
    const requirement = {
      module: { module: "order", need: "view" },
      permission: "billing.extension.request",
    } as const;
    expect(decideAccess(manager, requirement)).toEqual({ allowed: true });
    expect(errorOf(() => assertAccess(manager, requirement))).toBeNull();
  });

  it("先看模块等级，再看权限点；不过即 PERMISSION_DENIED", () => {
    expect(
      decideAccess(manager, {
        module: { module: "finance", need: "view" },
        permission: "finance.refund.approve",
      }),
    ).toEqual({ allowed: false, reason: "module_level" });
    expect(
      decideAccess(manager, {
        module: { module: "order", need: "view" },
        permission: "finance.refund.approve",
      }),
    ).toEqual({ allowed: false, reason: "permission" });
    expect(
      errorOf(() => assertAccess(manager, { module: null, permission: "finance.refund.approve" })),
    ).toBe("PERMISSION_DENIED");
  });

  it("没有要求、或权限写 assert-in-handler 的路由：这一步不拦，由处理器再判", () => {
    const editor = contextOf("editor");
    expect(decideAccess(editor, { module: null, permission: null }).allowed).toBe(true);
    expect(decideAccess(editor, { module: null, permission: "assert-in-handler" }).allowed).toBe(
      true,
    );
    const now = new Date("2026-01-05T04:00:00.000Z");
    expect(errorOf(() => assertPermission(editor, "delivery.sample.upload", now))).toBeNull();
    expect(errorOf(() => assertPermission(editor, "delivery.sample.qc", now))).toBe(
      "PERMISSION_DENIED",
    );
  });

  it("权限点键、模块键写错编译不过；绕过类型硬传进来也是不过，不会放行", () => {
    // @ts-expect-error 注册表里没有这个键（少了一个 s）
    expect(hasPermission(manager, "merchant.manager.asign")).toBe(false);
    const admin = contextOf("super_admin");
    // @ts-expect-error 同上：超级管理员也不持有登记之外的键
    expect(decideAccess(admin, { module: null, permission: "sys.everything" }).allowed).toBe(false);
    expect(
      // @ts-expect-error 模块键写错（多了一个 s）
      decideAccess(admin, { module: { module: "orders", need: "view" }, permission: null }),
    ).toEqual({ allowed: false, reason: "module_level" });
  });
});

describe("authorize：权限过了再查再验证", () => {
  const loginAt = new Date("2026-01-05T04:00:00.000Z");
  const within = new Date(loginAt.getTime() + STEP_UP_TTL_MS);
  const beyond = new Date(loginAt.getTime() + STEP_UP_TTL_MS + 1);
  const finance = contextOf("finance", { stepUpAt: loginAt });
  const approve = {
    module: { module: "finance", need: "view" },
    permission: "finance.refund.approve",
  } as const;

  it("标了再验证的权限点：10 分钟内放行，超出即 STEP_UP_REQUIRED；声明了跳过的不查", () => {
    expect(STEP_UP_PERMISSION_KEYS).toContain("finance.refund.approve");
    expect(errorOf(() => authorize(finance, approve, within))).toBeNull();
    expect(errorOf(() => authorize(finance, approve, beyond))).toBe("STEP_UP_REQUIRED");
    expect(errorOf(() => authorize(finance, approve, beyond, { skipStepUp: true }))).toBeNull();
    expect(errorOf(() => assertPermission(finance, "finance.refund.approve", beyond))).toBe(
      "STEP_UP_REQUIRED",
    );
  });

  it("没有权限时先报 PERMISSION_DENIED，不提示去再验证；跳过再验证不等于跳过权限", () => {
    const cs = contextOf("cs", { stepUpAt: loginAt });
    expect(errorOf(() => authorize(cs, approve, beyond))).toBe("PERMISSION_DENIED");
    expect(errorOf(() => authorize(cs, approve, beyond, { skipStepUp: true }))).toBe(
      "PERMISSION_DENIED",
    );
  });

  it("没标再验证的权限点、不设权限点的路由，过期也不拦", () => {
    const plain = { module: { module: "finance", need: "edit" }, permission: null } as const;
    expect(errorOf(() => authorize(finance, plain, beyond))).toBeNull();
    expect(
      errorOf(() =>
        authorize(finance, { module: null, permission: "finance.invoice.issue" }, beyond),
      ),
    ).toBeNull();
  });
});
