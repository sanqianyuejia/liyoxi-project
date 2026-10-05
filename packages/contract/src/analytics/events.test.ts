// 埋点事件登记的自测（任务书 W0-09b 第 7 节第 7、10 条里不看文档的那一半）。
// 与 D6、m08、14 分组的对账在 scripts/api-registries-check.ts（pnpm api-registries:check）。
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import { importsReachableFrom } from "../__fixtures__/import-scan.js";
import { ANALYTICS_EVENT_SOURCE } from "../enums/index.js";
import { matchesFormat } from "../registry/index.js";

import {
  ANALYTICS_CODE_PATTERN,
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_EVENT_NAME_FORMAT,
  CLIENT_EVENT_NAMES,
  NETWORK_TYPES,
  isAnalyticsEventName,
  isClientEventName,
  type AnalyticsEventName,
  type ClientEventName,
  type ClientEventProps,
} from "./events.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("埋点事件", () => {
  it("事件名不重复，写法合 ck_analytics_event_name；来源取库里的三个取值", () => {
    expect(new Set(ANALYTICS_EVENT_NAMES).size).toBe(ANALYTICS_EVENT_NAMES.length);
    expect(
      ANALYTICS_EVENT_NAMES.filter((name) => !matchesFormat(ANALYTICS_EVENT_NAME_FORMAT, name)),
    ).toEqual([]);
    expect(matchesFormat(ANALYTICS_EVENT_NAME_FORMAT, "a")).toBe(false);
    expect(matchesFormat(ANALYTICS_EVENT_NAME_FORMAT, "App_launch")).toBe(false);
    expect([...new Set(ANALYTICS_EVENTS.map((item) => item.source))].sort()).toEqual(
      [...ANALYTICS_EVENT_SOURCE.values].sort(),
    );
  });

  it("扩展事件都是端上报的，排在 PRD 的事件之后", () => {
    const extensions = ANALYTICS_EVENTS.filter((item) => item.extension);
    expect(extensions.length).toBeGreaterThan(0);
    expect(extensions.every((item) => item.source === "client")).toBe(true);
    const firstExtension = ANALYTICS_EVENTS.findIndex((item) => item.extension);
    expect(ANALYTICS_EVENTS.slice(firstExtension).every((item) => item.extension)).toBe(true);
  });

  it("端上事件 = 来源是 client 的事件；服务端的事件端上不许报", () => {
    expect(CLIENT_EVENT_NAMES).toEqual(
      ANALYTICS_EVENTS.filter((item) => item.source === "client").map((item) => item.name),
    );
    expect(isClientEventName("mall_view")).toBe(true);
    expect(isClientEventName("order_submit")).toBe(false);
    expect(isAnalyticsEventName("order_submit")).toBe(true);
    expect(isAnalyticsEventName("no_such_event")).toBe(false);
  });

  it("端上事件各有属性类型，一个不多、一个不少；事件名与属性写错即编译不过", () => {
    expectTypeOf<keyof ClientEventProps>().toEqualTypeOf<ClientEventName>();
    const track = <N extends ClientEventName>(name: N, props: ClientEventProps[N]) => ({
      name,
      props,
    });
    expect(track("trailer_play", { dramaId: "x", playMs: 1200, finished: false }).name).toBe(
      "trailer_play",
    );
    // @ts-expect-error 服务端派生的事件端上不能报
    track("order_submit", {});
    // @ts-expect-error 属性名写错
    track("store_switch", { from: "home" });
    // @ts-expect-error 少了必填属性
    track("app_launch", {});
    const name: AnalyticsEventName = "points_expire";
    expect(name).toBe("points_expire");
  });

  it("属性里的短编码与网络类型", () => {
    expect(ANALYTICS_CODE_PATTERN.test("mall_home")).toBe(true);
    expect(ANALYTICS_CODE_PATTERN.test("13800138000138000")).toBe(false);
    expect(ANALYTICS_CODE_PATTERN.test("含中文")).toBe(false);
    expect(NETWORK_TYPES).toContain("wifi");
    expect(new Set(NETWORK_TYPES).size).toBe(NETWORK_TYPES.length);
  });
});

describe("纯常量子路径 ./analytics/events 不带 Zod", () => {
  it("入口可达的文件不引任何包", () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      exports: Record<string, { types: string; default?: string }>;
    };
    const target = "./src/analytics/events.ts";
    expect(manifest.exports["./analytics/events"]).toEqual({ types: target, default: target });
    const scan = importsReachableFrom(join(packageDir, target));
    expect(scan.files.map((file) => file.slice(packageDir.length + 1))).toContain(
      "src/analytics/events.ts",
    );
    expect(scan.packages).toEqual([]);
    expect(scan.unresolved).toEqual([]);
  });
});
