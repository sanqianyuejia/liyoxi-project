// 验收第 1、2 条的性质部分（甲类；任务书 W1-01a 第 7 节；D4 第 11.1 节“权限求值”“数据范围”）：
//   打开权限点、调高模块等级、标成主管，都不会把允许变成拒绝；主管 ⊇ 非主管；超级管理员持有 V1.0 的全部权限点；
//   任意写坏的角色 JSON 规整后不抛错、形状完好，注册表外的键不产生授权；own ⊆ group ⊆ all，非主管没有待分配池。
// 轮次与种子的约定同 kernel：PR 上固定种子、每个性质 200 轮；要加大或复现用环境变量，例：
//   LYX_FC_RUNS=5000 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/authz/authz.property.test.ts
// 失败时把反例固化成文末的固定用例再修。
import {
  ADMIN_MODULE_KEYS,
  MODULE_LEVELS,
  OWN_TASK_MODULES,
  PERMISSION_KEYS,
  UNASSIGNED_POOLS,
  defaultRoleActions,
  isAdminModuleKey,
  isPermissionKey,
  permissionByKey,
} from "@liyoxi/contract/authz";
import type {
  AdminModuleKey,
  ModuleLevel,
  PermissionKey,
  RoleActionSwitch,
  RoleDataScope,
  StaffRoleKey,
} from "@liyoxi/contract/authz";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { contextOf, ROLE_KEYS, seededRole } from "./__fixtures__/contexts.js";
import { scopeCovers, scopeOf } from "./data-scope.js";
import type { DataScope } from "./data-scope.js";
import { decideAccess } from "./decide.js";
import type { ModuleNeed } from "./decide.js";
import { effectivePermissions, normalizeRoleConfig, V1_PERMISSION_KEYS } from "./role-config.js";
import type { RawRoleConfig } from "./role-config.js";

const runs = {
  numRuns: Number(process.env.LYX_FC_RUNS ?? 200),
  seed: Number(process.env.LYX_FC_SEED ?? 20261006),
};
// 纯计算，平时不到 1 秒；机器很忙时留足
const slow = { timeout: 60_000 };

const NEEDS: readonly ModuleNeed[] = ["view", "edit"];
const SCOPES: readonly RoleDataScope[] = ["own", "group", "all"];
const LEVEL_RANK: Record<ModuleLevel, number> = { n: 0, v: 1, o: 2, e: 3 };
const levelsFor = (key: AdminModuleKey): ModuleLevel[] =>
  MODULE_LEVELS.filter(
    (level) => level !== "o" || (OWN_TASK_MODULES as readonly string[]).includes(key),
  );

const roleArb = fc.constantFrom<StaffRoleKey>(...ROLE_KEYS);
const moduleArb = fc.constantFrom<AdminModuleKey>(...ADMIN_MODULE_KEYS);
const switchArb = fc.record({ on: fc.boolean(), leadOnly: fc.boolean() });

/** 合规的一行：模块等级可以缺键，权限点只给这个角色适用的键、也可以缺 */
const validRawArb = (roleKey: StaffRoleKey): fc.Arbitrary<RawRoleConfig> =>
  fc.record({
    moduleLevels: fc.record(
      Object.fromEntries(ADMIN_MODULE_KEYS.map((key) => [key, fc.constantFrom(...levelsFor(key))])),
      { requiredKeys: [] },
    ),
    actions: fc.record(
      Object.fromEntries(Object.keys(defaultRoleActions(roleKey)).map((key) => [key, switchArb])),
      { requiredKeys: [] },
    ),
    dataScope: fc.constantFrom(...SCOPES),
  });

/** 只会放宽的改动：调高一个模块的等级、打开一个权限点、去掉一个“仅主管” */
type Widening =
  | { kind: "level"; module: AdminModuleKey; pick: number }
  | { kind: "switch_on"; pick: number }
  | { kind: "drop_lead_only"; pick: number };
const wideningArb: fc.Arbitrary<Widening> = fc.oneof(
  fc.record({ kind: fc.constant("level" as const), module: moduleArb, pick: fc.nat() }),
  fc.record({ kind: fc.constant("switch_on" as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant("drop_lead_only" as const), pick: fc.nat() }),
);

/** 在规整后的配置上做放宽，得到新的一行（写成库里的样子） */
function widen(roleKey: StaffRoleKey, raw: RawRoleConfig, changes: Widening[]): RawRoleConfig {
  const config = normalizeRoleConfig(roleKey, raw);
  const levels: Record<string, ModuleLevel> = { ...config.moduleLevels };
  const actions: Record<string, RoleActionSwitch> = { ...config.actions } as Record<
    string,
    RoleActionSwitch
  >;
  const keys = Object.keys(actions);
  for (const change of changes) {
    if (change.kind === "level") {
      const current = levels[change.module] as ModuleLevel;
      const higher = levelsFor(change.module).filter(
        (level) => LEVEL_RANK[level] > LEVEL_RANK[current],
      );
      if (higher.length > 0) {
        levels[change.module] = higher[change.pick % higher.length] as ModuleLevel;
      }
    } else if (keys.length > 0) {
      const key = keys[change.pick % keys.length] as string;
      const before = actions[key] as RoleActionSwitch;
      actions[key] =
        change.kind === "switch_on"
          ? { on: true, leadOnly: before.leadOnly }
          : { on: before.on, leadOnly: false };
    }
  }
  return { moduleLevels: levels, actions, dataScope: config.dataScope };
}

const allCells = (
  roleKey: StaffRoleKey,
  raw: RawRoleConfig,
  isLead: boolean,
): Map<string, boolean> => {
  const ctx = contextOf(roleKey, { isLead, raw });
  const cells = new Map<string, boolean>();
  for (const moduleKey of ADMIN_MODULE_KEYS) {
    for (const need of NEEDS) {
      const requirement = { module: { module: moduleKey, need }, permission: null };
      cells.set(`${moduleKey}:${need}`, decideAccess(ctx, requirement).allowed);
    }
  }
  for (const key of PERMISSION_KEYS) {
    cells.set(key, decideAccess(ctx, { module: null, permission: key }).allowed);
  }
  return cells;
};

function expectNothingLost(before: Map<string, boolean>, after: Map<string, boolean>): void {
  const lost = [...before].filter(([cell, allowed]) => allowed && after.get(cell) !== true);
  expect(lost.map(([cell]) => cell)).toEqual([]);
}

describe("权限求值：性质", () => {
  it("打开权限点、去掉“仅主管”、调高模块等级，不会把允许变成拒绝", slow, () => {
    fc.assert(
      fc.property(
        roleArb.chain((roleKey) => fc.tuple(fc.constant(roleKey), validRawArb(roleKey))),
        fc.array(wideningArb, { minLength: 1, maxLength: 6 }),
        fc.boolean(),
        ([roleKey, raw], changes, isLead) => {
          const before = allCells(roleKey, raw, isLead);
          const after = allCells(roleKey, widen(roleKey, raw, changes), isLead);
          expectNothingLost(before, after);
        },
      ),
      runs,
    );
  });

  it("主管 ⊇ 非主管：同一行配置下，标成主管不丢任何一格", slow, () => {
    fc.assert(
      fc.property(
        roleArb.chain((roleKey) => fc.tuple(fc.constant(roleKey), validRawArb(roleKey))),
        ([roleKey, raw]) => {
          expectNothingLost(allCells(roleKey, raw, false), allCells(roleKey, raw, true));
        },
      ),
      runs,
    );
  });

  it("超级管理员持有 V1.0 的全部权限点：库里的 actions 写成什么、是不是主管都一样", slow, () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.boolean(), (actions, isLead) => {
        const raw = { ...seededRole("super_admin"), actions };
        const ctx = contextOf("super_admin", { isLead, raw });
        const missing = V1_PERMISSION_KEYS.filter(
          (key) => !decideAccess(ctx, { module: null, permission: key }).allowed,
        );
        expect(missing).toEqual([]);
        expect(ctx.permissions.size).toBe(V1_PERMISSION_KEYS.length);
        expect(ctx.scope.kind).toBe("all");
      }),
      runs,
    );
  });
});

/** 写坏的列：键里混着登记的与乱写的，值里混着合规的与任意 JSON；整列也可能不是对象 */
const junkColumnArb = (knownKeys: readonly string[], goodValue: fc.Arbitrary<unknown>) =>
  fc.oneof(
    {
      weight: 4,
      arbitrary: fc.dictionary(
        fc.oneof(fc.constantFrom(...knownKeys), fc.string()),
        fc.oneof(goodValue, fc.jsonValue()),
        { maxKeys: 12 },
      ),
    },
    { weight: 1, arbitrary: fc.jsonValue() },
  );
const junkRawArb: fc.Arbitrary<RawRoleConfig> = fc.record({
  moduleLevels: junkColumnArb(ADMIN_MODULE_KEYS, fc.constantFrom(...MODULE_LEVELS)),
  actions: junkColumnArb(PERMISSION_KEYS, switchArb),
  dataScope: fc.oneof(fc.constantFrom(...SCOPES), fc.jsonValue()),
});

/** 去掉登记之外的键（整列不是对象的原样留着） */
function withoutUnknownKeys(raw: RawRoleConfig): RawRoleConfig {
  const strip = (column: unknown, known: (key: string) => boolean): unknown =>
    typeof column === "object" && column !== null && !Array.isArray(column)
      ? Object.fromEntries(Object.entries(column).filter(([key]) => known(key)))
      : column;
  return {
    moduleLevels: strip(raw.moduleLevels, isAdminModuleKey),
    actions: strip(raw.actions, isPermissionKey),
    dataScope: raw.dataScope,
  };
}

describe("角色配置的规整：性质", () => {
  it("任意写坏的 JSON 规整后不抛错、形状完好；注册表外的键不产生授权", slow, () => {
    fc.assert(
      fc.property(roleArb, junkRawArb, fc.boolean(), (roleKey, raw, isLead) => {
        const config = normalizeRoleConfig(roleKey, raw);
        expect(Object.keys(config.moduleLevels)).toEqual([...ADMIN_MODULE_KEYS]);
        for (const key of ADMIN_MODULE_KEYS) {
          expect(levelsFor(key), key).toContain(config.moduleLevels[key]);
        }
        const applicable = Object.keys(defaultRoleActions(roleKey)).sort();
        expect(Object.keys(config.actions).sort()).toEqual(applicable);
        for (const value of Object.values(config.actions)) {
          expect([typeof value?.on, typeof value?.leadOnly]).toEqual(["boolean", "boolean"]);
        }
        expect(SCOPES).toContain(config.dataScope);

        // 持有的键都在 V1.0 的登记里；不是超级管理员时，还都得是这个角色适用的键或全员标记
        const held = [...effectivePermissions(config, isLead)];
        expect(held.filter((key) => !V1_PERMISSION_KEYS.includes(key))).toEqual([]);
        if (roleKey !== "super_admin") {
          const outside = held.filter(
            (key) => !applicable.includes(key) && permissionByKey(key)?.grant.kind !== "all_staff",
          );
          expect(outside).toEqual([]);
        }

        // 把登记之外的键删掉再规整，结果一模一样：那些键没起任何作用
        const clean = normalizeRoleConfig(roleKey, withoutUnknownKeys(raw));
        expect(config.moduleLevels).toEqual(clean.moduleLevels);
        expect(config.actions).toEqual(clean.actions);
        expect(config.dataScope).toBe(clean.dataScope);
        expect(clean.issues.filter((item) => item.problem === "unknown_key")).toEqual([]);
      }),
      runs,
    );
  });
});

const idArb = fc.uuid({ version: 7 });
const permissionSetArb = fc
  .subarray([...V1_PERMISSION_KEYS])
  .map((keys) => new Set<PermissionKey>(keys));

/** 一个范围盖住哪些（负责人, 池）组合：负责人取给定的几个 id 与“为空” */
function covered(scope: DataScope, owners: readonly string[]): Set<string> {
  const cells = new Set<string>();
  for (const owner of owners) if (scopeCovers(scope, owner)) cells.add(owner);
  for (const pool of UNASSIGNED_POOLS) if (scopeCovers(scope, null, pool)) cells.add(`空:${pool}`);
  return cells;
}
const subsetOf = (inner: Set<string>, outer: Set<string>): boolean =>
  [...inner].every((cell) => outer.has(cell));

describe("数据范围：性质", () => {
  it("own ⊆ group ⊆ all；本人总在范围内；非主管没有待分配池；主管 ⊇ 同组非主管", slow, () => {
    fc.assert(
      fc.property(
        idArb,
        fc.array(idArb, { maxLength: 6 }),
        fc.array(idArb, { maxLength: 4 }),
        permissionSetArb,
        fc.boolean(),
        (self, group, strangers, permissions, isLead) => {
          const owners = [self, ...group, ...strangers];
          const staff = { id: self, isLead };
          const [own, grp, all] = SCOPES.map((dataScope) =>
            covered(scopeOf(staff, { dataScope }, group, permissions), owners),
          ) as [Set<string>, Set<string>, Set<string>];
          expect(subsetOf(own, grp)).toBe(true);
          expect(subsetOf(grp, all)).toBe(true);
          expect(own.has(self)).toBe(true);
          expect(all.size).toBe(new Set(owners).size + UNASSIGNED_POOLS.length);

          for (const dataScope of SCOPES) {
            const plain = scopeOf({ id: self, isLead: false }, { dataScope }, group, permissions);
            const lead = scopeOf({ id: self, isLead: true }, { dataScope }, group, permissions);
            expect(subsetOf(covered(plain, owners), covered(lead, owners))).toBe(true);
            if (plain.kind === "staff") {
              expect(plain.unassigned.size).toBe(0);
              expect(new Set(plain.staffIds).size).toBe(plain.staffIds.length);
              // 陌生人负责的资源，“本人”“本组”都看不到
              const leaked = strangers.filter(
                (id) => !group.includes(id) && id !== self && scopeCovers(plain, id),
              );
              expect(leaked).toEqual([]);
            }
            if (lead.kind === "staff") {
              const expected = new Set(
                [...permissions].flatMap((key) => permissionByKey(key)?.pool ?? []),
              );
              expect([...lead.unassigned].sort()).toEqual([...expected].sort());
            }
          }
        },
      ),
      runs,
    );
  });
});
