import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { merchantTokens, sharedTokens } from "@liyoxi/shared/design/tokens";
import { describe, expect, it } from "vitest";

import {
  GALLERY_GROUP_SPEC,
  GALLERY_GROUPS,
  GALLERY_INDEX_ROUTE,
  GALLERY_ITEMS,
  GALLERY_PAGES,
  GALLERY_PREVIEW_ROUTE,
  GALLERY_ROOT,
  GALLERY_SHEETS,
  galleryEnabled,
} from "./gallery";
import { WEAPP_PAGES } from "./pages";

// 组件陈列的登记：每个组件都有预览（任务书 W0-27b 第 7 节第 1 项）。只读文件，不起小程序运行时。
// 组件的数量与名单不写在这里：目录里有什么就要求登记什么。

const src = path.dirname(fileURLToPath(import.meta.url));
const componentDirs = readdirSync(path.join(src, "components"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const names: string[] = GALLERY_ITEMS.map((item) => item.name);

describe("组件陈列的登记", () => {
  it("src/components 下每个目录都登记了，登记的也都有目录；名字不重复", () => {
    expect([...names].sort()).toEqual(componentDirs);
    expect(new Set(names).size).toBe(names.length);
  });

  it("每个组件有 index.tsx，有一页预览，并登记进预览的入口", () => {
    const entry = readFileSync(path.join(src, "sub/gallery/previews/index.ts"), "utf8");
    for (const name of names) {
      expect(existsSync(path.join(src, "components", name, "index.tsx")), name).toBe(true);
      expect(existsSync(path.join(src, "sub/gallery/previews", `${name}.tsx`)), name).toBe(true);
      expect(entry, name).toContain(`from "./${name}";`);
    }
  });

  it("分组都是目录页认识的分组；每个组件有中文名", () => {
    for (const item of GALLERY_ITEMS) {
      expect(GALLERY_GROUPS, item.name).toContain(item.group);
      expect(item.title.trim(), item.name).not.toBe("");
    }
  });

  it("陈列的两个页面在自己的分包下，不占业务页面的路由", () => {
    expect(GALLERY_INDEX_ROUTE).toBe(`${GALLERY_ROOT}/index/index`);
    expect(GALLERY_PREVIEW_ROUTE).toBe(`${GALLERY_ROOT}/preview/index`);
    for (const page of GALLERY_PAGES) {
      expect(existsSync(path.join(src, GALLERY_ROOT, `${page}.tsx`)), page).toBe(true);
      expect(existsSync(path.join(src, GALLERY_ROOT, `${page}.config.ts`)), page).toBe(true);
    }
    expect(WEAPP_PAGES.some((page) => page.route.startsWith(`${GALLERY_ROOT}/`))).toBe(false);
    expect(WEAPP_PAGES.map((page): string => page.pkg)).not.toContain(GALLERY_ROOT);
  });
});

// 看样（W0-29）：分组照规范的章节，每组标着规范的节号与要点；基础样张也都有预览。
// 组数、样张数与名单不写在这里：登记里有什么就要求什么。
describe("陈列照规范分组", () => {
  it("每组都写了规范的节号与要点，每组下面至少有一项", () => {
    const used = new Set<string>([...GALLERY_ITEMS, ...GALLERY_SHEETS].map((item) => item.group));
    for (const group of GALLERY_GROUPS) {
      const { spec, points } = GALLERY_GROUP_SPEC[group];
      expect(spec, group).toMatch(/^第 \d+(?:\.\d+)?(?:–\d+)? 节/);
      expect(points.trim().length, group).toBeGreaterThan(10);
      expect(used.has(group), `${group}：这一组下面没有组件也没有样张`).toBe(true);
    }
    expect(Object.keys(GALLERY_GROUP_SPEC).sort()).toEqual([...GALLERY_GROUPS].sort());
  });

  it("各组照规范的节号先后排", () => {
    const first = GALLERY_GROUPS.map((group) =>
      Number(/^第 (\d+(?:\.\d+)?)/.exec(GALLERY_GROUP_SPEC[group].spec)?.[1]),
    );
    expect(first).toEqual([...first].sort((a, b) => a - b));
  });

  it("每张基础样张有预览并登记进样张的入口；名字不与组件重名", () => {
    const entry = readFileSync(path.join(src, "sub/gallery/sheets/index.ts"), "utf8");
    const sheetNames: string[] = GALLERY_SHEETS.map((sheet) => sheet.name);
    expect(new Set(sheetNames).size).toBe(sheetNames.length);
    for (const sheet of GALLERY_SHEETS) {
      expect(GALLERY_GROUPS, sheet.name).toContain(sheet.group);
      expect(sheet.title.trim(), sheet.name).not.toBe("");
      expect(names, sheet.name).not.toContain(sheet.name);
      expect(entry, sheet.name).toMatch(new RegExp(`(?:^|\\s)"?${sheet.name}"?: [A-Z]\\w+,`, "m"));
    }
  });

  it("色板、字号两张样张：设计变量里商家端用得到的每一个，样式里都有对应的一行", () => {
    const scss = readFileSync(path.join(src, "sub/gallery/sheets/sheets.scss"), "utf8");
    const colors = Object.keys({ ...sharedTokens.color, ...merchantTokens.color });
    const sizes = Object.keys(merchantTokens["font-size"]);
    expect(colors.length).toBeGreaterThan(0);
    expect(sizes.length).toBeGreaterThan(0);
    for (const name of colors) expect(scss, name).toContain(`"${name}": $lyx-color-${name},`);
    for (const name of sizes) expect(scss, name).toContain(`"${name}": $lyx-font-size-${name},`);
  });
});

describe("陈列分包进不进构建", () => {
  it("生产的小程序包缺省不带；H5（截图）与开发构建带", () => {
    expect(galleryEnabled({ TARO_ENV: "weapp", NODE_ENV: "production" })).toBe(false);
    expect(galleryEnabled({ TARO_ENV: "h5", NODE_ENV: "production" })).toBe(true);
    expect(galleryEnabled({ TARO_ENV: "weapp", NODE_ENV: "development" })).toBe(true);
    expect(galleryEnabled({})).toBe(false);
  });

  it("WEAPP_GALLERY 明说了就听它的：1 带，0 不带", () => {
    expect(galleryEnabled({ TARO_ENV: "weapp", NODE_ENV: "production", WEAPP_GALLERY: "1" })).toBe(
      true,
    );
    expect(galleryEnabled({ TARO_ENV: "h5", WEAPP_GALLERY: "0" })).toBe(false);
    expect(galleryEnabled({ NODE_ENV: "development", WEAPP_GALLERY: "0" })).toBe(false);
  });
});
