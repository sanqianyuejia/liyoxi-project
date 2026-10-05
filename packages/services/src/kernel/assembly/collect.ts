// 收集（W0-07b）：从一组模块入口里取各模块的登记。
//
// 组合根把每个模块的 index.ts 整体引入（import * as），交到这里：入口里有 registration 的就收，没有的略过。
// 模块加 register.ts 时只在自己的 index.ts 加一行再导出，不用改任何共用的清单。
// 不在运行时扫目录、不动态 import：打包以后目录不在了。
import { REGISTRATION_KINDS } from "./types.js";
import type { ModuleRegistration } from "./types.js";

/** 模块入口给出登记用的导出名 */
export const REGISTRATION_EXPORT = "registration";

/** 收集时发现入口给出的 registration 不对：不是 defineRegistration 的结果，或模块名与目录名不同 */
export class RegistrationShapeError extends Error {
  constructor(directory: string, reason: string) {
    super(`模块 ${directory} 的入口给出的 ${REGISTRATION_EXPORT} 不对：${reason}`);
    this.name = "RegistrationShapeError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 是不是 defineRegistration 给出的形状：模块名是字符串，六类与 ports 都是数组 */
export function isModuleRegistration(value: unknown): value is ModuleRegistration {
  if (!isRecord(value) || typeof value["module"] !== "string") return false;
  return [...REGISTRATION_KINDS, "ports"].every((key) => Array.isArray(value[key]));
}

/**
 * 从模块入口里收登记。entries 的键是模块目录名，值是该模块 index.ts 的全部导出。
 * 返回按模块名排序的登记；入口没有 registration 的模块不在其中。
 */
export function collectRegistrations(
  entries: Readonly<Record<string, object>>,
): ModuleRegistration[] {
  const collected: ModuleRegistration[] = [];
  for (const directory of Object.keys(entries).sort()) {
    const entry: Readonly<Record<string, unknown>> = { ...entries[directory] };
    if (!(REGISTRATION_EXPORT in entry)) continue;
    const registration = entry[REGISTRATION_EXPORT];
    if (!isModuleRegistration(registration)) {
      throw new RegistrationShapeError(directory, "要用 defineRegistration 造");
    }
    if (registration.module !== directory) {
      throw new RegistrationShapeError(
        directory,
        `模块名写的是 ${registration.module}，要与目录名相同`,
      );
    }
    collected.push(registration);
  }
  return collected;
}

/** 磁盘上的一个模块目录 */
export interface ModuleDirectory {
  readonly name: string;
  /** 目录里有没有 register.ts */
  readonly hasRegisterFile: boolean;
}

/**
 * 组合根的入口清单与磁盘上的模块目录对一遍，返回对不上的地方；空数组即一致。
 * 组合根的自测用它：模块建了 register.ts 却忘了在入口再导出，登记就收不到，这里把它查出来。
 */
export function auditModuleEntries(
  entries: Readonly<Record<string, object>>,
  directories: readonly ModuleDirectory[],
): string[] {
  const problems: string[] = [];
  const onDisk = new Set(directories.map((directory) => directory.name));
  for (const name of Object.keys(entries).sort()) {
    if (!onDisk.has(name)) problems.push(`组合根清单里的 ${name} 没有对应的模块目录`);
  }
  for (const directory of [...directories].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const entry = entries[directory.name];
    if (entry === undefined) {
      problems.push(`模块目录 ${directory.name} 不在组合根的清单里`);
      continue;
    }
    const exported = REGISTRATION_EXPORT in entry;
    if (directory.hasRegisterFile && !exported) {
      problems.push(
        `模块 ${directory.name} 有 register.ts，入口 index.ts 却没有给出 ${REGISTRATION_EXPORT}：登记收不到`,
      );
    }
    if (!directory.hasRegisterFile && exported) {
      problems.push(
        `模块 ${directory.name} 的入口给出了 ${REGISTRATION_EXPORT}，目录里却没有 register.ts：登记要写在 register.ts 里`,
      );
    }
  }
  return problems;
}
