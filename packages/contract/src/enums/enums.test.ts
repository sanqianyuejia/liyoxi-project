// 枚举登记的自测（任务书 W0-09a 第 7 节）。这里不连库：取值与库 CHECK 的对账是 pnpm enums:check。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { importsReachableFrom } from "../__fixtures__/import-scan.js";

import {
  ACTOR_TYPE,
  AUDIT_LOG_CLIENT,
  BILLING_PARAM_KEY,
  CLIENT,
  ENUMS,
  ENUMS_BY_MODULE,
  MERCHANT_ROLE,
  enumByColumn,
  type EnumDef,
} from "./index.js";
import { ActorTypeSchema, ClientSchema, MerchantRoleSchema, zodEnum } from "./zod.js";

const enumsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(enumsDir, "../../../..");
const readJson = (path: string) =>
  JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as unknown;

/** 不是枚举文件的：声明形态、入口、Zod 派生 */
const NOT_ENUM_FILES = new Set(["define.ts", "index.ts", "zod.ts"]);
const enumFiles = readdirSync(enumsDir)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !NOT_ENUM_FILES.has(name))
  .map((name) => name.slice(0, -3))
  .sort();

describe("一个模块一个文件，汇总自动收集", () => {
  it("目录里的枚举文件与入口收的一一对应", () => {
    expect(Object.keys(ENUMS_BY_MODULE).sort()).toEqual(enumFiles);
    for (const [module, defs] of Object.entries(ENUMS_BY_MODULE)) {
      expect(defs.length, module).toBeGreaterThan(0);
    }
  });

  it("文件名是 services 的模块名（infra/ci/layers.json），另有 shared", () => {
    const { modules } = readJson("infra/ci/layers.json") as { modules: Record<string, string> };
    const unknown = enumFiles.filter((name) => name !== "shared" && !(name in modules));
    expect(unknown).toEqual([]);
  });

  it("每个文件导出的常量名是枚举名的大写；导出的都是枚举", async () => {
    for (const file of enumFiles) {
      const exported = (await import(pathToFileURL(join(enumsDir, `${file}.ts`)).href)) as Record<
        string,
        EnumDef
      >;
      for (const [key, def] of Object.entries(exported)) {
        expect(def.name.toUpperCase(), `${file}.ts 的 ${key}`).toBe(key);
      }
      expect(Object.values(exported), file).toEqual(ENUMS_BY_MODULE[file]);
    }
  });
});

describe("枚举的写法", () => {
  it("枚举名小写蛇形，全仓不重复", () => {
    const names = ENUMS.map((def) => def.name);
    expect(names.filter((name) => !/^[a-z][a-z0-9_]*$/.test(name))).toEqual([]);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  it("取值非空、不重复", () => {
    for (const def of ENUMS) {
      expect(def.values.length, def.name).toBeGreaterThan(0);
      expect(new Set(def.values).size, def.name).toBe(def.values.length);
      expect(
        def.values.filter((value) => value === ""),
        def.name,
      ).toEqual([]);
    }
  });

  it("绑定写成“表.列”；一列只绑一个枚举", () => {
    const columns = ENUMS.flatMap((def) => def.columns);
    expect(columns.filter((column) => !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(column))).toEqual(
      [],
    );
    expect(columns.filter((column, index) => columns.indexOf(column) !== index)).toEqual([]);
    for (const def of ENUMS) expect(def.columns.length, def.name).toBeGreaterThan(0);
  });

  it("按“表.列”能找到枚举", () => {
    expect(enumByColumn("outbox_event.actor_type")).toBe(ACTOR_TYPE);
    expect(enumByColumn("status_transition.client")).toBe(CLIENT);
    expect(enumByColumn("outbox_event.no_such_column")).toBeUndefined();
  });
});

describe("操作人枚举与共用枚举（06 第 3.3 节；catalogue.json 的 enums_shared）", () => {
  it("操作人三个枚举的取值", () => {
    expect(ACTOR_TYPE.values).toEqual(["merchant", "staff", "system", "partner"]);
    expect(CLIENT.values).toEqual(["weapp", "portal", "admin"]);
    expect(MERCHANT_ROLE.values).toEqual(["owner", "clerk"]);
    // 信封上的三列都绑在这三个枚举上（x01 第 2.3 节）
    expect(enumByColumn("outbox_event.actor_role")).toBe(MERCHANT_ROLE);
  });

  it("审计日志的客户端来源比 client 多一个 cli（06 第 3.3 节）", () => {
    expect(AUDIT_LOG_CLIENT.values).toEqual([...CLIENT.values, "cli"]);
    expect(enumByColumn("audit_log.client")).toBe(AUDIT_LOG_CLIENT);
  });

  it("计费规则参数的 12 个键按枚举登记（任务书 第 11 节第 5 项）", () => {
    expect(BILLING_PARAM_KEY.values).toHaveLength(12);
    expect(enumByColumn("billing_param.key")).toBe(BILLING_PARAM_KEY);
  });

  it("多态类型列不在这里：库里只校验写法，已知取值在 ./registry（任务书 第 11 节第 6 项）", () => {
    expect(enumByColumn("outbox_event.aggregate_type")).toBeUndefined();
    expect(enumByColumn("timer.subject_type")).toBeUndefined();
  });

  it("shared.ts 的前 15 个与底稿登记的共用枚举一致：名字、取值、顺序", () => {
    const { enums_shared: drafted } = readJson("docs/data-model/working/catalogue.json") as {
      enums_shared: { name: string; values: string[] }[];
    };
    expect(drafted).toHaveLength(15);
    const declared = ENUMS_BY_MODULE.shared!.slice(0, drafted.length);
    expect(declared.map((def) => ({ name: def.name, values: [...def.values] }))).toEqual(
      drafted.map(({ name, values }) => ({ name, values })),
    );
  });
});

describe("Zod 枚举由常量派生", () => {
  it("取值与常量是同一份", () => {
    expect(ActorTypeSchema.options).toEqual(ACTOR_TYPE.values);
    expect(ClientSchema.options).toEqual(CLIENT.values);
    expect(MerchantRoleSchema.options).toEqual(MERCHANT_ROLE.values);
  });

  it("认得声明过的取值，不认别的", () => {
    expect(ActorTypeSchema.parse("system")).toBe("system");
    expect(ActorTypeSchema.safeParse("portal").success).toBe(false);
    expect(ClientSchema.safeParse("cli").success).toBe(false);
    for (const def of ENUMS) {
      const schema = zodEnum(def);
      expect(schema.safeParse(def.values[0]).success, def.name).toBe(true);
      expect(schema.safeParse("lyx_no_such_value").success, def.name).toBe(false);
    }
  });
});

describe("纯常量子路径 ./enums 不带 Zod", () => {
  it("包清单把 ./enums 指到本目录的入口；入口可达的文件不引任何包", () => {
    const manifest = readJson("packages/contract/package.json") as {
      exports: Record<string, { types: string; default?: string }>;
    };
    expect(manifest.exports["./enums"]).toEqual({
      types: "./src/enums/index.ts",
      default: "./src/enums/index.ts",
    });
    const scan = importsReachableFrom(join(enumsDir, "index.ts"));
    // 入口、声明形态、各枚举文件都在里面；zod.ts 不在
    expect(scan.files.map((file) => file.slice(enumsDir.length + 1)).sort()).toEqual(
      ["define.ts", "index.ts", ...enumFiles.map((name) => `${name}.ts`)].sort(),
    );
    expect(scan.packages).toEqual([]);
    expect(scan.unresolved).toEqual([]);
  });

  it("zod.ts 才带 Zod：它经 src/zod.ts 走到 zod", () => {
    expect(importsReachableFrom(join(enumsDir, "zod.ts")).packages).toContain("zod");
  });
});
