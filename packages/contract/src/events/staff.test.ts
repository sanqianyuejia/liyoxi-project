import { describe, expect, it } from "vitest";

import { EVENT_PAYLOAD_SCHEMAS } from "./index.js";

describe("staff 的事件载荷（W1-01a）", () => {
  it("staff.created：员工、角色键加三个迁移键；新建没有上一个状态，不收多余的键", () => {
    const schema = EVENT_PAYLOAD_SCHEMAS["staff.created"];
    const good = {
      v: 1,
      staffId: "0199b2f0-0000-7000-8000-000000000001",
      roleKey: "super_admin",
      fromState: null,
      toState: "active",
      transition: "staff.bootstrap",
    };
    expect(schema.parse(good)).toEqual(good);
    const bad = [
      { ...good, v: 2 },
      { ...good, staffId: "not-a-uuid" },
      { ...good, roleKey: "root" },
      { ...good, fromState: "pending" },
      { ...good, toState: "locked" },
      { ...good, phone: "13800000000" },
    ];
    for (const payload of bad) expect(schema.safeParse(payload).success).toBe(false);
  });
});
