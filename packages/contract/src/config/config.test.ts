// 开关登记与参数键清单的自测（任务书 W0-09a 第 7 节第 7、8 条）：与 14 分组 第 2.7、2.3 节的两张表对账。
// W0-09b 补登了 07 第 7 节“待回写清单”里的 2 个开关键、7 个参数键：它们不在 14 分组的两张表里，按 07 的那张表对账。
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { importsReachableFrom } from "../__fixtures__/import-scan.js";
import {
  BILLING_PARAM_KEY,
  FEATURE_FLAG_EXPOSED_TO,
  FEATURE_FLAG_VALUE_TYPE,
} from "../enums/index.js";
import { matchesFormat } from "../registry/index.js";

import { FLAGS, FLAG_KEY_FORMAT, flagByKey, type ClientFlagKey, type FlagKey } from "./flags.js";
import {
  PARAM_KEYS,
  PARAM_KEYS_BY_GROUP,
  PARAM_KEY_FORMAT,
  isParamKey,
  type ParamKey,
} from "./params.js";

const configDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(configDir, "../..");
const repoRoot = resolve(packageDir, "../..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

/** 文档里从某一行起的第一张表：去掉表头与分隔行，拆成单元格 */
function tableAfter(text: string, marker: string): string[][] {
  const lines = text.split("\n");
  const from = lines.findIndex((line) => line.includes(marker));
  if (from < 0) throw new Error(`文档里找不到“${marker}”`);
  const start = lines.findIndex((line, index) => index > from && line.startsWith("|"));
  const rows: string[][] = [];
  for (let index = start; index < lines.length && lines[index]!.startsWith("|"); index += 1) {
    rows.push(
      lines[index]!.trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );
  }
  return rows.slice(2);
}
const quoted = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);

const configDoc = read("docs/data-model/14-config-data.md");

/** 07 第 7 节“待回写清单”里某一类的行：登记项一栏反引号里的键，连同“默认值或说明”一栏 */
const pendingRows = (category: string) =>
  tableAfter(read("docs/07-api-contract.md"), "## 7. 待回写清单")
    .filter((cells) => cells[0] === category)
    .flatMap((cells) => quoted(cells[1]!).map((key) => ({ key, note: cells[2]! })));

describe("开关登记（14 分组 第 2.7 节）", () => {
  const seeded = tableAfter(configDoc, "**播种的键与 V1.0 默认值**").flatMap((cells) =>
    quoted(cells[0]!).map((key) => ({ key, type: cells[1]!, fallback: cells[2]! })),
  );

  /** 07 第 7 节待回写的开关 */
  const pending = pendingRows("开关");

  it("键不重复，写法合 ck_feature_flag_key；个数 = 播种表的加 07 第 7 节待回写的", () => {
    const keys = FLAGS.map((item) => item.key);
    expect(keys).toHaveLength(seeded.length + pending.length);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((key) => !matchesFormat(FLAG_KEY_FORMAT, key))).toEqual([]);
    expect(matchesFormat(FLAG_KEY_FORMAT, `a.${"b".repeat(47)}`)).toBe(false);
  });

  it("键的集合 = 播种表的 14 个加 07 第 7 节待回写的 2 个", () => {
    expect(seeded).toHaveLength(14);
    expect(pending.map((row) => row.key)).toEqual([
      "ops.maintenance_notice",
      "admin.wecom_web_login.enabled",
    ]);
    expect(FLAGS.map((item) => item.key).sort()).toEqual(
      [...seeded, ...pending].map((row) => row.key).sort(),
    );
  });

  it("07 第 7 节待回写的开关：值类型、下发范围、默认值照那张表", () => {
    for (const row of pending) {
      const registered = flagByKey(row.key)!;
      // 说明一栏：“json，`exposed_to = client`，默认 null（…）”“bool，默认关，`exposed_to = client`（…）”
      expect(row.note.startsWith(registered.valueType), row.key).toBe(true);
      expect(quoted(row.note), row.key).toContain(`exposed_to = ${registered.exposedTo}`);
      const fallback = /默认 ?(null|关|开)/.exec(row.note)?.[1];
      expect(fallback, row.key).toBeDefined();
      expect(registered.defaultValue, row.key).toBe(fallback === "null" ? null : fallback === "开");
    }
  });

  it("值类型与 V1.0 默认值与播种表相同", () => {
    for (const row of seeded) {
      const registered = flagByKey(row.key)!;
      // 类型一栏：“bool”或“json（字符串）”
      expect(row.type.startsWith(registered.valueType), row.key).toBe(true);
      // 默认一栏：“关”“开”（可能加粗、带括注），或反引号里的 JSON 字面量
      const literal = quoted(row.fallback)[0];
      const expected =
        literal !== undefined
          ? (JSON.parse(literal) as unknown)
          : row.fallback.replaceAll("*", "").startsWith("开");
      if (literal === undefined) expect(row.fallback.replaceAll("*", "")).toMatch(/^[开关]/);
      expect(registered.defaultValue, row.key).toEqual(expected);
    }
    expect(flagByKey("weapp.video.trailer.enabled")?.defaultValue).toBe(false);
    expect(flagByKey("client.min_version")).toMatchObject({
      valueType: "json",
      defaultValue: "0.0.0",
    });
  });

  it("值类型、下发范围取自库的枚举；默认值的形态合 ck_feature_flag_default_value", () => {
    for (const item of FLAGS) {
      expect(FEATURE_FLAG_VALUE_TYPE.values, item.key).toContain(item.valueType);
      expect(FEATURE_FLAG_EXPOSED_TO.values, item.key).toContain(item.exposedTo);
      if (item.valueType === "bool") expect(typeof item.defaultValue, item.key).toBe("boolean");
      if (item.valueType === "enum") expect(typeof item.defaultValue, item.key).toBe("string");
      expect(item.description, item.key).not.toBe("");
    }
  });

  it("下发范围：D7 第 3.2 节列为前端要消费的记 client，其余记 server（任务书 第 11 节第 4 项）", () => {
    const d7 = read("docs/appendix/design/d7-platform.md");
    const consumed = tableAfter(d7, "键名以下表为准").flatMap((cells) => quoted(cells[0]!));
    // 表里写了通配的 release.*：四个 release.* 都算
    expect(consumed).toContain("release.*");
    const client = FLAGS.filter((item) => item.exposedTo === "client").map((item) => item.key);
    for (const key of consumed.filter((name) => name !== "release.*")) {
      expect(client, key).toContain(key);
    }
    expect(FLAGS.filter((item) => item.exposedTo === "server").map((item) => item.key)).toEqual([
      "notify.sms.enabled",
    ]);
    expect(client.filter((key) => key.startsWith("release."))).toHaveLength(4);
  });

  it("键是字面量类型；下发给前端的键另有一个类型", () => {
    const any: FlagKey = "notify.sms.enabled";
    const toClient: ClientFlagKey = "client.min_version";
    // @ts-expect-error 只在服务端用的键不在下发的键里
    const serverOnly: ClientFlagKey = "notify.sms.enabled";
    expect([any, toClient, serverOnly]).toHaveLength(3);
  });
});

describe("参数键清单（14 分组 第 2.3 节“参数键的归属”）", () => {
  const rows = tableAfter(configDoc, "**参数键的归属**");
  const KEY = new RegExp(PARAM_KEY_FORMAT.pattern);
  /** 归属表“键”一栏里反引号写出、合键的写法的词 */
  const written = rows.flatMap((cells) =>
    quoted(cells[1]!)
      .filter((token) => KEY.test(token))
      .map((key) => ({ key, groups: quoted(cells[0]!) })),
  );
  /** 表里出现、但不是要登记的键：作废的旧名 */
  const NOT_KEYS = new Set(["sod.refund.distinct_executor"]);
  /** 表里写成“`notify.window.start` / `end`”的另一半 */
  const EXPANDED = new Set(["notify.window.end"]);
  /** 07 第 7 节待回写的参数：不在归属表里 */
  const pending = pendingRows("参数").map((row) => row.key);

  it("键不重复，写法合 ck_param_value_key", () => {
    const keys = PARAM_KEYS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((key) => !matchesFormat(PARAM_KEY_FORMAT, key))).toEqual([]);
    expect(matchesFormat(PARAM_KEY_FORMAT, `a.${"b".repeat(63)}`)).toBe(false);
    expect(isParamKey("sla.ticket.assign")).toBe(true);
    expect(isParamKey("sla.no_such_key")).toBe(false);
  });

  it("归属表里写出的键都已登记；登记的键都出自归属表", () => {
    const inDoc = written.map((item) => item.key).filter((key) => !NOT_KEYS.has(key));
    expect(inDoc.length).toBeGreaterThan(80);
    expect(inDoc.filter((key) => !isParamKey(key))).toEqual([]);
    const known = new Set([...inDoc, ...EXPANDED, ...pending]);
    expect(PARAM_KEYS.map((item) => item.key).filter((key) => !known.has(key))).toEqual([]);
    for (const key of [...NOT_KEYS]) expect(isParamKey(key), key).toBe(false);
  });

  it("07 第 7 节待回写的 7 个参数键都已登记，归属表里没有它们；分组照任务书 W0-09b 第 11 节第 12 项", () => {
    expect(pending).toHaveLength(7);
    expect(pending.filter((key) => !isParamKey(key))).toEqual([]);
    const inDoc = new Set(written.map((item) => item.key));
    expect(pending.filter((key) => inDoc.has(key))).toEqual([]);
    const groupOf = new Map(PARAM_KEYS.map((item) => [item.key as string, item.group as string]));
    expect(Object.fromEntries(pending.map((key) => [key, groupOf.get(key)]))).toEqual({
      "ocr.daily_limit_per_store": "profile",
      "upload.weapp_video_max_mb": "media",
      "download.weapp_save_mode": "media",
      "ad.duration_options": "ad",
      "ad.revision_screenshot_max": "ad",
      "catalog.search.industry_fallback": "content",
      "notify.test_recipients": "notify",
    });
  });

  it("带通配的键不猜：不登记它们名下的任何键", () => {
    const wildcards = rows
      .flatMap((cells) => quoted(cells[1]!))
      .filter((token) => token.endsWith(".*"))
      .map((token) => token.slice(0, -1));
    expect(wildcards.sort()).toEqual(["invoice.item_name.", "payment.description_template."]);
    for (const prefix of wildcards) {
      expect(PARAM_KEYS.filter((item) => item.key.startsWith(prefix))).toEqual([]);
    }
  });

  it("所属分组是归属表那一行第一栏里的名字", () => {
    const groupOf = new Map(PARAM_KEYS.map((item) => [item.key as string, item.group as string]));
    for (const { key, groups } of written) {
      if (NOT_KEYS.has(key)) continue;
      expect(groups, key).toContain(groupOf.get(key));
    }
    expect(Object.keys(PARAM_KEYS_BY_GROUP).filter((group) => !/^[a-z]+$/.test(group))).toEqual([]);
  });

  it("计费规则参数的 12 个键不在这张表里（它们在 billing_param）；x01 引用的三个键在", () => {
    const billing = new Set<string>(BILLING_PARAM_KEY.values);
    expect(PARAM_KEYS.filter((item) => billing.has(item.key))).toEqual([]);
    const referenced: ParamKey[] = [
      "order.start_delay_minutes",
      "order.rejected_stale_days",
      "ad.returned_stale_days",
    ];
    for (const key of referenced) expect(isParamKey(key), key).toBe(true);
  });
});

describe("纯常量子路径 ./config/flags、./config/params 不带 Zod（验收 8）", () => {
  const manifest = JSON.parse(read("packages/contract/package.json")) as {
    exports: Record<string, { types: string; default?: string }>;
  };

  it.each(["flags", "params"])("./config/%s：入口可达的文件不引任何包", (name) => {
    const target = `./src/config/${name}.ts`;
    expect(manifest.exports[`./config/${name}`]).toEqual({ types: target, default: target });
    const scan = importsReachableFrom(join(packageDir, target));
    expect(scan.files.map((file) => file.slice(packageDir.length + 1))).toContain(
      `src/config/${name}.ts`,
    );
    expect(scan.packages).toEqual([]);
    expect(scan.unresolved).toEqual([]);
  });
});
