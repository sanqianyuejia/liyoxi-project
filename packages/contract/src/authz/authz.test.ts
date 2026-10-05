// 权限点、能力点、模块键登记的自测（任务书 W0-09b 第 7 节第 2、3、10 条里不看文档的那一半）。
// 与登记文档的对账在 scripts/api-registries-check.ts（pnpm api-registries:check），它的用例在 src/api-registries.test.ts。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { importsReachableFrom } from "../__fixtures__/import-scan.js";
import { MERCHANT_ROLE, STAFF_ROLE_KEY } from "../enums/index.js";

import {
  ADMIN_MODULES,
  ADMIN_MODULE_KEYS,
  CAPABILITIES,
  CAPABILITY_KEYS,
  CAPABILITY_KEY_PATTERN,
  MODULE_LEVELS,
  OWN_TASK_MODULES,
  PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  PERMISSION_KEY_PATTERN,
  PERMISSION_SECTIONS,
  PERMISSION_SINCE,
  STEP_UP_PERMISSION_KEYS,
  UNASSIGNED_POOLS,
  VIEWER_ROLES,
  capabilityByKey,
  isAdminModuleKey,
  isCapabilityKey,
  isPermissionKey,
  permissionByKey,
  type AdminModuleKey,
  type CapabilityKey,
  type PermissionKey,
} from "./index.js";

const authzDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(authzDir, "../..");
const sectionFiles = readdirSync(join(authzDir, "permissions"))
  .filter((name) => name.endsWith(".ts") && name !== "index.ts")
  .map((name) => name.slice(0, -3))
  .sort();
const repeated = (values: readonly string[]) => [
  ...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
];

describe("后台模块键", () => {
  it("13 个模块，键不重复；模块等级四档；“本人任务”只在交付与发布", () => {
    expect(ADMIN_MODULE_KEYS).toHaveLength(13);
    expect(repeated(ADMIN_MODULE_KEYS)).toEqual([]);
    expect(ADMIN_MODULES.every((item) => /^[a-z]+$/.test(item.key))).toBe(true);
    expect(repeated(ADMIN_MODULES.map((item) => item.name))).toEqual([]);
    expect(MODULE_LEVELS).toEqual(["n", "v", "o", "e"]);
    expect(OWN_TASK_MODULES).toEqual(["delivery", "publish"]);
    expect(isAdminModuleKey("finance")).toBe(true);
    expect(isAdminModuleKey("export")).toBe(false);
    const key: AdminModuleKey = "workbench";
    // @ts-expect-error 不是模块键
    const wrong: AdminModuleKey = "exports";
    expect([key, wrong]).toHaveLength(2);
  });
});

describe("权限点：一个小节一个文件，汇总自动收集", () => {
  it("目录里的文件与入口收的一一对应，顺序同登记文档的小节", () => {
    const sections = PERMISSION_SECTIONS.map((item) => item.key);
    expect(PERMISSION_GROUPS.map((group) => group.section)).toEqual(sections);
    expect(sections.map((key) => key.replace("_", "-")).sort()).toEqual(sectionFiles);
    for (const group of PERMISSION_GROUPS) {
      expect(group.permissions.length, group.section).toBeGreaterThan(0);
      expect(group.permissions.every((item) => item.section === group.section)).toBe(true);
    }
    expect(PERMISSIONS).toHaveLength(
      PERMISSION_GROUPS.reduce((sum, group) => sum + group.permissions.length, 0),
    );
  });

  it("前 11 个小节就是 11 个模块（工作台与渠道管理没有自己的权限点小节）", () => {
    const moduleSections = PERMISSION_SECTIONS.map((item) => item.key).filter(isAdminModuleKey);
    expect(moduleSections).toHaveLength(11);
    expect(ADMIN_MODULE_KEYS.filter((key) => !(moduleSections as string[]).includes(key))).toEqual([
      "workbench",
      "channel",
    ]);
  });

  it("键不重复，写法是小写点分；名称不为空", () => {
    expect(repeated(PERMISSION_KEYS)).toEqual([]);
    expect(PERMISSION_KEYS.filter((key) => !PERMISSION_KEY_PATTERN.test(key))).toEqual([]);
    expect(PERMISSIONS.filter((item) => item.name.trim() === "")).toEqual([]);
    expect(PERMISSION_KEY_PATTERN.test("Sys.role.edit")).toBe(false);
    expect(PERMISSION_KEY_PATTERN.test("sys")).toBe(false);
  });

  it("默认授予里的角色都是库里的角色键，不含超级管理员；同一个键里角色不重复", () => {
    const roleKeys: readonly string[] = STAFF_ROLE_KEY.values;
    for (const item of PERMISSIONS) {
      if (item.grant.kind !== "roles") continue;
      const granted = item.grant.roles.map((grant) => grant.role);
      expect(granted.length, item.key).toBeGreaterThan(0);
      expect(repeated(granted), item.key).toEqual([]);
      for (const role of granted) {
        expect(roleKeys, item.key).toContain(role);
        expect(role, item.key).not.toBe("super_admin");
      }
    }
  });

  it("V1.1 的键都在“V1.1 的键”一节，再验证还没定；V1.0 的键再验证是确定的", () => {
    expect(PERMISSION_SINCE).toEqual(["v1.0", "v1.1"]);
    for (const item of PERMISSIONS) {
      expect(item.since === "v1.1", item.key).toBe(item.section === "v1_1");
      expect(item.stepUp === null, item.key).toBe(item.since === "v1.1");
      if (item.grant.kind === "undecided") expect(item.since, item.key).toBe("v1.1");
    }
  });

  it("待分配池只取登记的五个；标了再验证的键另有一张清单", () => {
    const pools = PERMISSIONS.flatMap((item) => (item.pool === null ? [] : [item.pool]));
    expect([...new Set(pools)].sort()).toEqual([...UNASSIGNED_POOLS].sort());
    expect(STEP_UP_PERMISSION_KEYS).toContain("finance.refund.execute");
    expect(STEP_UP_PERMISSION_KEYS).not.toContain("finance.invoice.issue");
    expect(STEP_UP_PERMISSION_KEYS).toHaveLength(
      PERMISSIONS.filter((item) => item.stepUp === true).length,
    );
  });

  it("按键查找；键是字面量类型，写错即编译不过", () => {
    expect(permissionByKey("merchant.manager.assign")).toMatchObject({
      section: "merchant",
      grant: { kind: "roles", roles: [{ role: "delivery_manager", leadOnly: true }] },
      stepUp: false,
      pool: "store_manager",
      since: "v1.0",
    });
    expect(permissionByKey("sys.role.edit")?.grant).toEqual({ kind: "super_admin_only" });
    expect(permissionByKey("order.export")?.grant).toEqual({ kind: "module_viewers" });
    expect(permissionByKey("self.mfa.reset")?.grant).toEqual({ kind: "all_staff" });
    expect(isPermissionKey("sys.role.edit")).toBe(true);
    expect(isPermissionKey("assert-in-handler")).toBe(false);
    const key: PermissionKey = "finance.refund.approve";
    // @ts-expect-error 没登记的权限点
    const wrong: PermissionKey = "finance.refund.aprove";
    expect([key, wrong]).toHaveLength(2);
  });
});

describe("能力点", () => {
  it("键不重复，写法是小写点分或“组.*”；老板都能", () => {
    expect(repeated(CAPABILITY_KEYS)).toEqual([]);
    expect(CAPABILITY_KEYS.filter((key) => !CAPABILITY_KEY_PATTERN.test(key))).toEqual([]);
    expect(CAPABILITIES.filter((item) => item.name.trim() === "")).toEqual([]);
    expect(CAPABILITIES.filter((item) => !item.owner.allowed)).toEqual([]);
  });

  it("四个“组.*”是单个组键，不是通配符（裁决 A128）", () => {
    expect(CAPABILITY_KEYS.filter((key) => key.endsWith(".*")).sort()).toEqual([
      "cart.*",
      "invoice.*",
      "me.*",
      "ticket.*",
    ]);
    expect(isCapabilityKey("cart.*")).toBe(true);
    // 组键不展开：组下面的名字不是能力点
    expect(isCapabilityKey("cart.add")).toBe(false);
  });

  it("不能的不带限定；按键查找", () => {
    for (const item of CAPABILITIES) {
      for (const access of [item.owner, item.clerk, item.archivedOwner]) {
        if (!access.allowed) expect(access.limit, item.key).toBeNull();
      }
    }
    expect(capabilityByKey("asset.upload")).toMatchObject({
      clerk: { allowed: true, limit: null },
      archivedOwner: { allowed: false },
    });
    expect(capabilityByKey("plan.purchase")).toMatchObject({
      clerk: { allowed: false },
      archivedOwner: { allowed: true, limit: "主体级" },
    });
    const key: CapabilityKey = "delivery.download";
    // @ts-expect-error 没登记的能力点
    const wrong: CapabilityKey = "delivery.downlaod";
    expect([key, wrong]).toHaveLength(2);
  });

  it("判别字段 viewerRole：商家的两个角色加游客（裁决 A122）", () => {
    expect(VIEWER_ROLES).toEqual([...MERCHANT_ROLE.values, "guest"]);
  });
});

describe("纯常量子路径 ./authz 不带 Zod", () => {
  it("入口可达的文件不引任何包", () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      exports: Record<string, { types: string; default?: string }>;
    };
    const target = "./src/authz/index.ts";
    expect(manifest.exports["./authz"]).toEqual({ types: target, default: target });
    const scan = importsReachableFrom(join(packageDir, target));
    const files = scan.files.map((file) => file.slice(packageDir.length + 1));
    expect(files).toContain("src/authz/capabilities.ts");
    expect(files).toContain("src/authz/permissions/system.ts");
    expect(scan.packages).toEqual([]);
    expect(scan.unresolved).toEqual([]);
  });
});
