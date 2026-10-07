import { describe, expect, it } from "vitest";
import { StaffWecomSchema } from "./auth.schemas.js";
import { StaffDetailSchema } from "./staff.js";

const base = {
  status: "bound",
  userid: "test-wecom-204",
  boundAt: "2026-10-07T00:00:00.000Z",
  qrFileId: "019a0000-0000-7000-8000-000000000204",
};
const qr = { url: "https://example.invalid/fake-204.png", expiresAt: "2026-10-07T00:30:00.000Z" };

describe("StaffWecom二维码与既有员工详情结构一致", () => {
  it("合法带期限URL对象与旧DTO都接受且输出一致", () => {
    const value = { ...base, qrUrl: qr };
    expect(StaffDetailSchema.shape.wecom.parse(value)).toEqual(value);
    expect(StaffWecomSchema.parse(value)).toEqual(value);
  });
  it("当前无二维码运行结果仍接受null", () => {
    const value = { ...base, qrFileId: null, qrUrl: null };
    expect(StaffWecomSchema.parse(value)).toEqual(StaffDetailSchema.shape.wecom.parse(value));
  });
  it.each([
    qr.url,
    { url: qr.url },
    { ...qr, url: "invalid-url" },
    { ...qr, expiresAt: "invalid-instant" },
  ])("非法二维码形状%s拒绝", (qrUrl) => {
    const value = { ...base, qrUrl };
    expect(StaffDetailSchema.shape.wecom.safeParse(value).success).toBe(false);
    expect(StaffWecomSchema.safeParse(value).success).toBe(false);
  });
});
