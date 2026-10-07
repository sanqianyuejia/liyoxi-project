import { describe, expect, it } from "vitest";
import {
  actorKey,
  approxSummary,
  auditQuery,
  auditSearch,
  canSeeAccess,
  changeFilter,
  cursorScope,
  datePreset,
  safeLink,
} from "./model";
import type { AccessSnapshot } from "../../../lib/permissions";
const id = "01900000-0000-7000-8000-000000000001";
const access: AccessSnapshot = {
  staff: { id, name: "虚构员工", roleKey: "super_admin", roleName: "超管" },
  isLead: false,
  moduleLevels: { system: "v" },
  actions: [],
  dataScope: "all",
  releases: {},
};
describe("日志URL只消费真实契约", () => {
  it("保留多条件和CSV，丢弃UI id与未知参数后发起查询", () => {
    const search = auditSearch({
      stream: "access",
      category: "pii_reveal,file_access",
      actorType: "staff",
      actorId: id,
      targetType: "staff",
      targetId: id,
      entityId: id,
      storeId: id,
      q: "RZ2026100800001",
      createdFrom: "2026-10-07",
      createdTo: "2026-10-08",
      limit: "100",
      cursor: "opaque_123",
      id,
      sort: "unsupported",
      unknown: "x",
    });
    expect(auditQuery(search)).toEqual({
      stream: "access",
      category: "pii_reveal,file_access",
      actorType: "staff",
      actorId: id,
      targetType: "staff",
      targetId: id,
      entityId: id,
      storeId: id,
      q: "RZ2026100800001",
      createdFrom: "2026-10-07",
      createdTo: "2026-10-08",
      limit: 100,
      cursor: "opaque_123",
    });
    expect(search.id).toBe(id);
    expect(search.sort).toBeUndefined();
  });
  it("非法互斥目标和反向日期规范化，其他合法条件保留", () => {
    expect(
      auditQuery(
        auditSearch({
          targetId: id,
          targetKey: "key",
          createdFrom: "2026-10-08",
          createdTo: "2026-10-07",
          q: "日志",
          limit: 13,
        }),
      ),
    ).toEqual({ stream: "ops", limit: 13, q: "日志" });
    expect(
      auditQuery(
        auditSearch({
          createdFrom: "2026-02-30",
          actorId: "bad",
          limit: 101,
          stream: "activity",
          cursor: "x".repeat(257),
          id: "bad",
        }),
      ),
    ).toEqual({ stream: "ops", limit: 20 });
  });
  it("筛选/切流/容量改变移除旧游标和详情，单侧日期合法", () => {
    const next = changeFilter(
      auditSearch({ cursor: "first", id, q: "旧", createdTo: "2026-10-08" }),
      { stream: "access", q: undefined },
    );
    expect(next).toEqual({ stream: "access", limit: "20", createdTo: "2026-10-08" });
  });
  it("筛选范围隔离前驱，详情选择与游标变化保留同一范围", () => {
    const first = auditSearch({ q: "日志", category: "param", limit: 10 });
    expect(cursorScope({ ...first, id, cursor: "second" })).toBe(cursorScope(first));
    for (const patch of [
      { q: "另一个" },
      { stream: "access" },
      { category: "staff_authz" },
      { limit: "20" },
    ])
      expect(cursorScope(auditSearch({ ...first, ...patch }))).not.toBe(cursorScope(first));
  });
  it("北京时间跨日跨年，7天/30天均包含当天", () => {
    expect(datePreset(7, new Date("2026-12-31T16:00:00Z"))).toEqual({
      createdFrom: "2026-12-26",
      createdTo: "2027-01-01",
    });
    expect(datePreset(30, new Date("2026-10-07T16:00:00Z"))).toEqual({
      createdFrom: "2026-09-09",
      createdTo: "2026-10-08",
    });
    expect(datePreset("all")).toEqual({ createdFrom: undefined, createdTo: undefined });
  });
  it("近似总数不生成页数，容量10000明示封顶", () => {
    expect(approxSummary(43)).toBe("共 43 条（近似）");
    expect(approxSummary(10000)).toContain("最多显示 10,000 条");
    expect(approxSummary(43)).not.toContain("页");
  });
  it("访问流仅超管；换人/降权后不复用旧详情身份", () => {
    expect(canSeeAccess(access)).toBe(true);
    expect(canSeeAccess({ ...access, staff: { ...access.staff, roleKey: "finance" } })).toBe(false);
    expect(canSeeAccess(null)).toBe(false);
    expect(actorKey({ ...access, staff: { ...access.staff, id: "other" } })).not.toBe(
      actorKey(access),
    );
    expect(actorKey({ ...access, moduleLevels: { system: "n" } })).not.toBe(actorKey(access));
    expect(actorKey({ ...access, dataScope: "own" })).not.toBe(actorKey(access));
  });
  it("只信已实现有权限的具名关联页，拒绝自由URL/未来页/不合法参数", () => {
    expect(
      safeLink({ route: "system.staff", params: { staffId: id }, label: "员工账号" }, access),
    ).toEqual({ href: "/sys/staff", label: "员工账号" });
    for (const route of [
      "https://example.invalid",
      "javascript:alert(1)",
      "system.roles",
      "merchant.detail",
      "unknown",
    ])
      expect(safeLink({ route, params: { staffId: id }, label: "关联" }, access)).toBeNull();
    expect(
      safeLink({ route: "system.staff", params: { staffId: "../x" }, label: "关联" }, access),
    ).toBeNull();
    expect(
      safeLink(
        { route: "system.staff", params: { staffId: id }, label: "关联" },
        { ...access, moduleLevels: { system: "n" } },
      ),
    ).toBeNull();
  });
});
