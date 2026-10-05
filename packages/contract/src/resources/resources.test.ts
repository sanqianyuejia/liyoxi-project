// 资源登记的自测（任务书 W0-09b 第 7 节第 4 条里不看文档的那一半；约定 C10、C11）。
// 与 resources.json 的对账在 scripts/api-registries-check.ts（pnpm api-registries:check）。
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ROUTE_GROUPS } from "../routes/meta.js";

import {
  RESOURCES,
  RESOURCE_ALIASES,
  RESOURCE_GROUPS,
  resourceByName,
  resourceByTable,
  type ResourceName,
} from "./index.js";

/** 不是登记文件的：声明形态、汇总、入口 */
const NOT_GROUP_FILES = new Set(["define.ts", "groups.ts", "index.ts"]);
const groupFiles = readdirSync(dirname(fileURLToPath(import.meta.url)))
  .filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !NOT_GROUP_FILES.has(name),
  )
  .map((name) => name.slice(0, -3));
const repeated = (values: readonly string[]) => [
  ...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
];
const present = <T>(value: T | null): value is T => value !== null;

describe("一个模块一个文件，汇总自动收集", () => {
  it("目录里的文件与入口收的一一对应：模块按名字排序，没有表的 views 排最后", () => {
    const modules = RESOURCE_GROUPS.map((group) => group.module ?? "views");
    expect([...modules].sort()).toEqual([...groupFiles].sort());
    expect(modules.at(-1)).toBe("views");
    expect(modules.slice(0, -1)).toEqual([...modules.slice(0, -1)].sort());
    expect(RESOURCES).toHaveLength(
      RESOURCE_GROUPS.reduce((sum, group) => sum + group.resources.length, 0),
    );
  });

  it("有表的在模块文件里，没有表的都在 views 里", () => {
    for (const item of RESOURCES)
      expect(item.table === null, item.resource).toBe(item.module === null);
  });
});

describe("登记的规矩（约定 C10、C11）", () => {
  it("一张表只对应一个资源名；资源名不重复，没有表的也不与表资源重名", () => {
    expect(repeated(RESOURCES.map((item) => item.table).filter(present))).toEqual([]);
    expect(repeated(RESOURCES.map((item) => item.resource))).toEqual([]);
  });

  it("路径参数名全仓唯一，驼峰", () => {
    const params = RESOURCES.map((item) => item.param).filter(present);
    expect(repeated(params)).toEqual([]);
    expect(params.filter((param) => !/^[a-z][A-Za-z0-9]*$/.test(param))).toEqual([]);
  });

  it("表名是小写蛇形；有表的资源名是短横线小写", () => {
    const tables = RESOURCES.map((item) => item.table).filter(present);
    expect(tables.filter((table) => !/^[a-z][a-z0-9_]*$/.test(table))).toEqual([]);
    const named = RESOURCES.filter((item) => item.table !== null).map((item) => item.resource);
    expect(named.filter((name) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))).toEqual([]);
  });

  it("端只取四组之内；探活的登记项不属于任何一组", () => {
    for (const item of RESOURCES) {
      expect(repeated(item.surfaces), item.resource).toEqual([]);
      for (const surface of item.surfaces) expect(ROUTE_GROUPS, item.resource).toContain(surface);
    }
    const noSurface = RESOURCES.filter((item) => item.surfaces.length === 0);
    expect(noSurface).toHaveLength(1);
    expect(noSurface[0]!.resource).toContain("healthz");
  });

  it("别名是完整路径，以它所在的那一组开头，这一组在该资源的端里；别名不重复", () => {
    expect(repeated(RESOURCE_ALIASES)).toEqual([]);
    for (const item of RESOURCES) {
      for (const alias of item.aliases) {
        const group = /^\/(m|admin|portal)\/[a-z0-9-]+/.exec(alias)?.[1];
        expect(group, `${item.resource} 的别名 ${alias}`).toBeDefined();
        expect(item.surfaces as readonly string[], alias).toContain(group);
      }
    }
  });
});

describe("查找", () => {
  it("按表、按资源名", () => {
    expect(resourceByTable("merchant_user")).toMatchObject({
      resource: "merchant-users",
      param: "merchantUserId",
      aliases: ["/m/me"],
      module: "identity",
    });
    expect(resourceByName("home")).toMatchObject({ table: null, module: null });
    expect(resourceByTable("no_such_table")).toBeUndefined();
    const name: ResourceName = "payment-orders";
    // @ts-expect-error 没登记的资源名
    const wrong: ResourceName = "payment-order";
    expect([name, wrong]).toHaveLength(2);
  });
});
