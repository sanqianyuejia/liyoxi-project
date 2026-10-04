// 下载页页面清单的用例：拿 routemap.json 的 screens 对账。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PORTAL_PAGES } from "./pages";

const routemap = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../docs/api/working/routemap.json", import.meta.url)),
    "utf8",
  ),
) as { screens: string[] }[];
const portalScreens = [
  ...new Set(
    routemap
      .flatMap((entry) => entry.screens)
      .filter((screen) => screen.startsWith("无画板：下载页·")),
  ),
].map((screen) => screen.slice("无画板：".length));

describe("下载页页面清单", () => {
  it("与 routemap 的 screens 一一对应", () => {
    expect(PORTAL_PAGES.map((page) => page.screen).sort()).toEqual(portalScreens.sort());
  });

  it("5 页加落地页、验真页都标 M6；V1.1 的电脑端上传只登记", () => {
    const v10 = PORTAL_PAGES.filter((page) => page.milestone === "M6");
    expect(v10.map((page) => page.title)).toEqual([
      "扫码登录页",
      "可下载清单",
      "成片下载",
      "样片与广告只读预览",
      "会话失效说明页",
      "扫一扫落地页",
      "授权书验真页",
    ]);
    for (const page of v10) expect(page.workPackage, page.key).toBe("G6-B");
    expect(
      PORTAL_PAGES.filter((page) => page.milestone === "V1.1").map((page) => page.title),
    ).toEqual(["电脑端上传"]);
  });

  it("键与地址不重复；本包合并时没有一页标为已实现", () => {
    expect(new Set(PORTAL_PAGES.map((page) => page.key)).size).toBe(PORTAL_PAGES.length);
    const paths = PORTAL_PAGES.map((page) => page.path).filter((path) => path !== null);
    expect(new Set(paths).size).toBe(paths.length);
    expect(PORTAL_PAGES.filter((page) => page.implemented)).toEqual([]);
  });
});
