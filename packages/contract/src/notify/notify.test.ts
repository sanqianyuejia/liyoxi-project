// 通知场景与订阅点位登记的自测（任务书 W0-09b 第 7 节第 5、6、10 条里不看文档的那一半）。
// 与 a09、frag、13 分组、m08、D6 的对账在 scripts/api-registries-check.ts（pnpm api-registries:check）。
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { importsReachableFrom } from "../__fixtures__/import-scan.js";
import { NOTIFY_SCENE_AUDIENCE } from "../enums/index.js";
import { matchesFormat } from "../registry/index.js";

import {
  NOTIFY_SCENES,
  NOTIFY_SCENE_KEYS,
  NOTIFY_SCENE_KEY_FORMAT,
  NOTIFY_SCENE_KEY_MAX_LENGTH,
  NOTIFY_SCENE_NAME_MAX_LENGTH,
  SUBSCRIBE_POINTS,
  SUBSCRIBE_POINT_KEYS,
  SUBSCRIBE_POINT_KEY_PATTERN,
  isNotifySceneKey,
  isSubscribePoint,
  notifySceneByKey,
  type MerchantSceneKey,
  type NotifySceneKey,
  type StaffSceneKey,
  type SubscribePoint,
} from "./index.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repeated = (values: readonly string[]) => [
  ...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
];

describe("通知场景", () => {
  it("键不重复，写法合 ck_notify_scene_scene_key，长度不超过库的上限", () => {
    expect(repeated(NOTIFY_SCENE_KEYS)).toEqual([]);
    expect(NOTIFY_SCENE_KEYS.filter((key) => !matchesFormat(NOTIFY_SCENE_KEY_FORMAT, key))).toEqual(
      [],
    );
    expect(NOTIFY_SCENE_KEYS.filter((key) => key.length > NOTIFY_SCENE_KEY_MAX_LENGTH)).toEqual([]);
    expect(matchesFormat(NOTIFY_SCENE_KEY_FORMAT, "x.pay_success")).toBe(false);
    expect(matchesFormat(NOTIFY_SCENE_KEY_FORMAT, "m.PaySuccess")).toBe(false);
  });

  it("受众由前缀得出，取值是库里的两个；显示名不为空、不重复、不超过 32 个字", () => {
    for (const item of NOTIFY_SCENES) {
      expect(NOTIFY_SCENE_AUDIENCE.values, item.key).toContain(item.audience);
      expect(item.audience, item.key).toBe(item.key.startsWith("m.") ? "merchant" : "staff");
      expect(item.name.trim(), item.key).toBe(item.name);
      expect(item.name.length, item.key).toBeGreaterThan(0);
      expect(item.name.length, item.key).toBeLessThanOrEqual(NOTIFY_SCENE_NAME_MAX_LENGTH);
    }
    for (const audience of NOTIFY_SCENE_AUDIENCE.values) {
      const names = NOTIFY_SCENES.filter((item) => item.audience === audience).map(
        (item) => item.name,
      );
      expect(names.length, audience).toBeGreaterThan(0);
      expect(repeated(names), audience).toEqual([]);
    }
  });

  it("按键查找；键是字面量类型，商家与员工各有一个类型", () => {
    expect(notifySceneByKey("m.plan_expiring")).toEqual({
      key: "m.plan_expiring",
      audience: "merchant",
      name: "套餐到期提醒",
    });
    expect(isNotifySceneKey("s.system_alert")).toBe(true);
    expect(isNotifySceneKey("s.no_such_scene")).toBe(false);
    const any: NotifySceneKey = "m.pay_success";
    const merchant: MerchantSceneKey = "m.refund_result";
    const staff: StaffSceneKey = "s.approval_pending";
    // @ts-expect-error 员工场景不是商家场景
    const wrong: MerchantSceneKey = "s.approval_pending";
    expect([any, merchant, staff, wrong]).toHaveLength(4);
  });
});

describe("订阅点位", () => {
  it("键不重复，小写蛇形；都写了挂在哪个按钮上", () => {
    expect(repeated(SUBSCRIBE_POINT_KEYS)).toEqual([]);
    expect(SUBSCRIBE_POINT_KEYS.filter((key) => !SUBSCRIBE_POINT_KEY_PATTERN.test(key))).toEqual(
      [],
    );
    expect(SUBSCRIBE_POINTS.filter((item) => item.label.trim() === "")).toEqual([]);
  });

  it("键是字面量类型，写错即编译不过", () => {
    expect(isSubscribePoint("pay_success")).toBe(true);
    expect(isSubscribePoint("pay_sucess")).toBe(false);
    const point: SubscribePoint = "order_submit";
    // @ts-expect-error 没登记的点位
    const wrong: SubscribePoint = "order_submitted";
    expect([point, wrong]).toHaveLength(2);
  });
});

describe("纯常量子路径 ./notify 不带 Zod", () => {
  it("入口可达的文件不引任何包", () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      exports: Record<string, { types: string; default?: string }>;
    };
    const target = "./src/notify/index.ts";
    expect(manifest.exports["./notify"]).toEqual({ types: target, default: target });
    const scan = importsReachableFrom(join(packageDir, target));
    const files = scan.files.map((file) => file.slice(packageDir.length + 1));
    expect(files).toContain("src/notify/scenes.ts");
    expect(files).toContain("src/notify/subscribe-points.ts");
    expect(scan.packages).toEqual([]);
    expect(scan.unresolved).toEqual([]);
  });
});
