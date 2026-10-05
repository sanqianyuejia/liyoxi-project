// 角色配置的规整：缺键取代码默认值、写坏的值当作缺、注册表外与不适用的键丢弃（03 分组 第 4 节；a01 第 3.35 节）。
import { ADMIN_MODULE_KEYS, defaultRoleActions, staffRoleDefault } from "@liyoxi/contract/authz";
import { describe, expect, it } from "vitest";

import { contextOf, ROLE_KEYS, seededRole } from "./__fixtures__/contexts.js";
import { buildStaffContext } from "./context.js";
import {
  effectivePermissions,
  isStaffRoleKey,
  normalizeRoleConfig,
  V1_PERMISSION_KEYS,
} from "./role-config.js";

describe("normalizeRoleConfig", () => {
  it("种子播出来的行原样通过：等级、开关、数据范围与代码默认配置相同，没有问题清单", () => {
    for (const roleKey of ROLE_KEYS) {
      const config = normalizeRoleConfig(roleKey, seededRole(roleKey));
      const base = staffRoleDefault(roleKey);
      expect(config.moduleLevels, roleKey).toEqual(base?.moduleLevels);
      expect(config.actions, roleKey).toEqual(defaultRoleActions(roleKey));
      expect(config.dataScope, roleKey).toBe(base?.dataScope);
      expect(config.issues, roleKey).toEqual([]);
    }
  });

  it("三列全空：全部取代码默认值（权限点登记后来多出来的键，库里的旧行就是这样读的）", () => {
    for (const roleKey of ROLE_KEYS) {
      const config = normalizeRoleConfig(roleKey, {
        moduleLevels: {},
        actions: {},
        dataScope: staffRoleDefault(roleKey)?.dataScope,
      });
      expect(config.moduleLevels).toEqual(staffRoleDefault(roleKey)?.moduleLevels);
      expect(config.actions).toEqual(defaultRoleActions(roleKey));
      expect(config.issues).toEqual([]);
    }
  });

  it("后台改过的值照用：关掉的权限点不再持有，去掉“仅主管”后非主管也持有", () => {
    const raw = seededRole("delivery_manager");
    raw.moduleLevels = { ...(raw.moduleLevels as object), order: "e", report: "n" };
    raw.actions = {
      ...(raw.actions as object),
      "delivery.plan.edit": { on: false, leadOnly: false },
      "merchant.manager.assign": { on: true, leadOnly: false },
      // leadOnly 不写即不限主管
      "merchant.manager.transfer": { on: true },
    };
    raw.dataScope = "group";
    const config = normalizeRoleConfig("delivery_manager", raw);
    expect(config.issues).toEqual([]);
    expect(config.moduleLevels.order).toBe("e");
    expect(config.moduleLevels.report).toBe("n");
    expect(config.dataScope).toBe("group");
    const held = effectivePermissions(config, false);
    expect(held.has("delivery.plan.edit")).toBe(false);
    expect(held.has("merchant.manager.assign")).toBe(true);
    expect(held.has("merchant.manager.transfer")).toBe(true);
    expect(held.has("delivery.plan.push")).toBe(true);
  });

  it("注册表外的键、对这个角色不适用的键丢弃并记下；不产生授权", () => {
    const raw = seededRole("cs");
    raw.moduleLevels = { ...(raw.moduleLevels as object), warehouse: "e" };
    raw.actions = {
      ...(raw.actions as object),
      "sys.everything": { on: true },
      // 在注册表里，但只限超级管理员
      "sys.role.edit": { on: true, leadOnly: false },
      // 在注册表里，但没给客服登记默认值
      "finance.refund.approve": { on: true, leadOnly: false },
    };
    const config = normalizeRoleConfig("cs", raw);
    expect(Object.keys(config.moduleLevels)).toEqual([...ADMIN_MODULE_KEYS]);
    expect(Object.keys(config.actions).sort()).toEqual(
      Object.keys(defaultRoleActions("cs")).sort(),
    );
    expect(config.issues).toEqual([
      { field: "moduleLevels", key: "warehouse", problem: "unknown_key" },
      { field: "actions", key: "sys.everything", problem: "unknown_key" },
      { field: "actions", key: "sys.role.edit", problem: "not_applicable" },
      { field: "actions", key: "finance.refund.approve", problem: "not_applicable" },
    ]);
    const held = effectivePermissions(config, true);
    expect(held.has("sys.role.edit")).toBe(false);
    expect(held.has("finance.refund.approve")).toBe(false);
  });

  it("写坏的值当作缺：取代码默认值并记下；“本人任务”写在交付、发布之外也算写坏", () => {
    const config = normalizeRoleConfig("editor", {
      moduleLevels: { delivery: "x", drama: "o", publish: "o", merchant: 3 },
      actions: {
        "delivery.sample.upload": { on: "yes" },
        "delivery.ad.upload": true,
        "delivery.download": { on: false, leadOnly: "no" },
      },
      dataScope: "everything",
    });
    const base = staffRoleDefault("editor");
    expect(config.moduleLevels).toEqual({ ...base?.moduleLevels, publish: "o" });
    expect(config.actions).toEqual(defaultRoleActions("editor"));
    expect(config.dataScope).toBe("own");
    expect(config.issues.map((item) => `${item.field}:${item.key}:${item.problem}`)).toEqual([
      "moduleLevels:drama:invalid_value",
      "moduleLevels:merchant:invalid_value",
      "moduleLevels:delivery:invalid_value",
      "actions:delivery.sample.upload:invalid_value",
      "actions:delivery.ad.upload:invalid_value",
      "actions:delivery.download:invalid_value",
      "dataScope:null:invalid_value",
    ]);
  });

  it.each([null, undefined, "{}", 7, [], [["delivery", "e"]]])(
    "整列不是对象（%j）：全取默认值，不抛错",
    (bad) => {
      const config = normalizeRoleConfig("publisher", {
        moduleLevels: bad,
        actions: bad,
        dataScope: bad,
      });
      expect(config.moduleLevels).toEqual(staffRoleDefault("publisher")?.moduleLevels);
      expect(config.actions).toEqual(defaultRoleActions("publisher"));
      expect(config.dataScope).toBe("own");
      expect(config.issues).toHaveLength(3);
    },
  );

  it("结果是冻结的；键认不出的角色直接抛错（库里有 CHECK，到不了这里）", () => {
    const config = normalizeRoleConfig("finance", seededRole("finance"));
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.moduleLevels)).toBe(true);
    expect(Object.isFrozen(config.actions)).toBe(true);
    expect(isStaffRoleKey("finance")).toBe(true);
    expect(isStaffRoleKey("root")).toBe(false);
    expect(isStaffRoleKey(null)).toBe(false);
    expect(() => normalizeRoleConfig("root" as never, seededRole("finance"))).toThrow(TypeError);
  });
});

describe("超级管理员与上下文", () => {
  it("超级管理员持有 V1.0 的全部权限点，不看库里的 actions、不看主管标记", () => {
    for (const actions of [{}, { "sys.role.edit": { on: false, leadOnly: false } }, null]) {
      const config = normalizeRoleConfig("super_admin", { ...seededRole("super_admin"), actions });
      for (const isLead of [false, true]) {
        expect([...effectivePermissions(config, isLead)].sort()).toEqual(
          [...V1_PERMISSION_KEYS].sort(),
        );
      }
    }
  });

  it("上下文带上生效的数据范围；角色配置与员工的角色对不上即抛错", () => {
    expect(contextOf("delivery_manager").dataScope).toBe("own");
    expect(contextOf("delivery_manager", { isLead: true }).dataScope).toBe("group");
    expect(contextOf("cs").dataScope).toBe("all");
    const ctx = contextOf("editor", { isLead: true });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(ctx.staff.isLead).toBe(true);
    expect(() =>
      buildStaffContext({
        staff: { id: ctx.staff.id, roleKey: "editor", isLead: false, staffGroupId: null },
        role: normalizeRoleConfig("finance", seededRole("finance")),
        groupStaffIds: [],
        stepUpAt: null,
      }),
    ).toThrow(TypeError);
  });
});
