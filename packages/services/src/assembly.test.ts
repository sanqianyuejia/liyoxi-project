import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assembleServices,
  MODULE_ENTRIES,
  moduleRegistrations,
  UNCOLLECTED_MODULES,
} from "./assembly.js";
import { APP_ENVS, ASSEMBLY_ENTRIES, auditModuleEntries } from "./kernel/index.js";

// 任务书 第 7 节验收 5：组合根的清单 = 模块目录；有 register.ts 的模块入口必须给出 registration；
// 真实模块的装配在两个入口、四个环境下都不报错。不连库。

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** 模块的名单以分层登记为准（infra/ci/layers.json；它与目录一一对应由 pnpm depcheck 核对） */
const layers = JSON.parse(readFileSync(here("../../../infra/ci/layers.json"), "utf8")) as {
  modules: Record<string, string>;
  nonModuleDirs: string[];
};

const allDirectories = readdirSync(here("./"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !layers.nonModuleDirs.includes(entry.name))
  .map((entry) => ({
    name: entry.name,
    hasRegisterFile: existsSync(here(`./${entry.name}/register.ts`)),
  }));
/** 参加收集的模块目录 */
const directories = allDirectories.filter(
  (directory) => !UNCOLLECTED_MODULES.includes(directory.name),
);

describe("组合根：清单与模块目录", () => {
  it("清单的模块加上不参加收集的，就是分层登记里的全部模块", () => {
    expect([...Object.keys(MODULE_ENTRIES), ...UNCOLLECTED_MODULES].sort()).toEqual(
      Object.keys(layers.modules).sort(),
    );
  });

  it("不参加收集的模块目录里没有 register.ts", () => {
    expect(
      allDirectories
        .filter((directory) => UNCOLLECTED_MODULES.includes(directory.name))
        .filter((directory) => directory.hasRegisterFile),
    ).toEqual([]);
  });

  it("目录里有 register.ts 的模块，入口都给出了 registration；反过来也一样", () => {
    expect(auditModuleEntries(MODULE_ENTRIES, directories)).toEqual([]);
  });

  it("收到的登记恰是有 register.ts 的那些模块", () => {
    expect(moduleRegistrations().map((item) => item.module)).toEqual(
      directories
        .filter((directory) => directory.hasRegisterFile)
        .map((directory) => directory.name)
        .sort(),
    );
  });
});

describe("组合根：真实模块的装配", () => {
  it.each(ASSEMBLY_ENTRIES)("%s 入口在四个环境下都装得起来，拿到的模块相同", (entry) => {
    const expected = moduleRegistrations().map((item) => item.module);
    for (const appEnv of APP_ENVS) {
      const assembly = assembleServices({ entry, appEnv });
      expect(assembly.entry).toBe(entry);
      expect(assembly.appEnv).toBe(appEnv);
      expect(assembly.modules).toEqual(expected);
    }
  });
});
