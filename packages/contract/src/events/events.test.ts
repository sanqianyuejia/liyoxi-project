import { describe, expect, it } from "vitest";

import { EVENTS } from "../registry/index.js";
import { EVENT_PAYLOAD_SCHEMAS, eventPayloadSchema } from "./index.js";

describe("事件载荷 schema（W0-15）", () => {
  it("交了 schema 的都是事件目录里状态为“发出”的事件", () => {
    for (const name of Object.keys(EVENT_PAYLOAD_SCHEMAS)) {
      expect(EVENTS.find((item) => item.name === name)?.status, name).toBe("v1");
    }
  });

  it("每份 schema 都要数字的 v：缺 v、v 不是数字都不过", () => {
    for (const [name, schema] of Object.entries(EVENT_PAYLOAD_SCHEMAS)) {
      expect(schema.safeParse({}).success, name).toBe(false);
      expect(schema.safeParse({ v: "1" }).success, name).toBe(false);
    }
  });

  it("按事件名取：有的给 schema，没交的、原型上的名字给 undefined", () => {
    expect(eventPayloadSchema("calendar.imported")).toBe(
      EVENT_PAYLOAD_SCHEMAS["calendar.imported"],
    );
    expect(eventPayloadSchema("order.submitted")).toBeUndefined();
    expect(eventPayloadSchema("toString")).toBeUndefined();
  });

  it("calendar.imported：照 01 分组 第 4 节的结构；日期升序不重复，不收多余的键", () => {
    const schema = EVENT_PAYLOAD_SCHEMAS["calendar.imported"];
    const good = {
      v: 1,
      calendarVersion: 3,
      year: 2027,
      changedDays: ["2027-01-01", "2027-02-10"],
    };
    expect(schema.parse(good)).toEqual(good);
    const bad = [
      { ...good, v: 2 },
      { ...good, calendarVersion: 0 },
      { ...good, changedDays: [] },
      { ...good, changedDays: ["2027-02-10", "2027-01-01"] },
      { ...good, changedDays: ["2027-01-01", "2027-01-01"] },
      { ...good, changedDays: ["2027-1-1"] },
      { ...good, note: "自由文本" },
    ];
    for (const payload of bad) expect(schema.safeParse(payload).success).toBe(false);
  });
});
