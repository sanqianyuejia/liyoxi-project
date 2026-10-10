import { describe, expect, it, vi } from "vitest";
import { AgreementFailure, type AgreementApi, type Version } from "./api";
import { createDraftSession, editorBody, initialFields } from "./editor";
import { effectiveInstant } from "./model";

const id = "01910000-0000-7000-8000-000000000001";
const version: Version = {
  agreementVersionId: id,
  agreementKey: "privacy",
  major: 1,
  minor: 1,
  versionLabel: "v1.1",
  status: "draft",
  displayStatus: "draft",
  effectiveAt: "2026-10-15T01:00:00.000Z",
  summary: "虚构隐私调整",
  isReconsentRequired: true,
  isLegalApproved: true,
  sourceFile: null,
  pdfFile: null,
  hasContentHtml: false,
  contentSha256: null,
  siteNoticeId: null,
  shortNoticeReason: null,
  expectedConsents: null,
  activatedAt: null,
  createdBy: {
    staffId: id,
    name: "虚构员工",
    staffNo: 1001,
    roleKey: "super_admin",
    isLead: false,
    status: "active",
  },
  publishedBy: null,
  lockVersion: 4,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  actions: ["edit", "schedule"],
};
const converted = (v: Version): Awaited<ReturnType<AgreementApi["update"]>> => ({
  version: v,
  contentHtml: "<p>虚构正文</p>",
  conversion: { state: "converted" as const, warnings: [] },
});
function ports() {
  return {
    create: vi.fn<AgreementApi["create"]>(async () => converted(version)),
    update: vi.fn<AgreementApi["update"]>(async () => converted({ ...version, lockVersion: 5 })),
    schedule: vi.fn<AgreementApi["schedule"]>(async () => ({
      version: { ...version, status: "pending" },
      siteNotice: null,
    })),
  } satisfies Pick<AgreementApi, "create" | "update" | "schedule">;
}
describe("W216 草稿提交", () => {
  it("法务确认默认off，服务器既有审核事实不会替用户勾选；BJT日期严格转换", () => {
    const fields = initialFields(version);
    expect(fields.isLegalApproved).toBe(false);
    expect(fields.date).toBe("2026-10-15");
    expect(fields.time).toBe("09:00");
    expect(effectiveInstant("2026-10-15", "00:00")).toBe("2026-10-14T16:00:00.000Z");
    expect(() => effectiveInstant("2026-02-30", "09:00")).toThrow();
    expect(() => effectiveInstant("2026-10-15", "25:00")).toThrow();
  });
  it("清空字段回传null，未上传完成的选择不产生文件id；新建不发送nullable字段", () => {
    const fields = {
      ...initialFields(),
      date: "",
      time: "",
      summary: "",
      sourceFileId: null,
      pdfFileId: null,
    };
    expect(editorBody(fields, false)).toEqual({
      isLegalApproved: false,
      isReconsentRequired: false,
      bumpMajor: false,
    });
    expect(editorBody(fields, true)).toEqual({
      effectiveAt: null,
      summary: null,
      sourceFileId: null,
      pdfFileId: null,
      isLegalApproved: false,
      isReconsentRequired: false,
    });
  });
  it("新建成功后安排失败保留真实id/lock，同意图重试不重复create或update", async () => {
    const api = ports(),
      session = createDraftSession(api, "privacy");
    const fields = initialFields();
    fields.summary = "虚构说明";
    api.schedule.mockRejectedValueOnce(new Error("上游暂不可用"));
    const body = editorBody(fields, false);
    await expect(session.schedule(body, "")).rejects.toThrow("上游暂不可用");
    await session.schedule(body, "");
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.update).not.toHaveBeenCalled();
    expect(api.schedule.mock.calls[0]?.slice(0, 2)).toEqual([id, { lockVersion: 4 }]);
    expect(api.schedule.mock.calls[0]?.[2]).toBe(api.schedule.mock.calls[1]?.[2]);
  });
  it("修改表单后使用返回lock与新key；失败重试仍同key，冲突不自动偷换锁", async () => {
    const api = ports(),
      session = createDraftSession(api, "privacy", version);
    const body = editorBody(initialFields(version), true);
    api.update.mockRejectedValueOnce(
      new AgreementFailure({
        symbol: "VERSION_CONFLICT",
        status: 409,
        message: "版本已更新",
        requestId: null,
        body: null,
        disposition: "invalidate",
      }),
    );
    await expect(session.save(body)).rejects.toThrow("版本已更新");
    await session.save(body);
    expect(api.update.mock.calls[0]?.[1].lockVersion).toBe(4);
    expect(api.update.mock.calls[1]?.[1].lockVersion).toBe(4);
    expect(api.update.mock.calls[0]?.[2]).toBe(api.update.mock.calls[1]?.[2]);
    await session.save({ ...body, summary: "新意图" });
    expect(api.update.mock.calls[2]?.[1].lockVersion).toBe(5);
    expect(api.update.mock.calls[2]?.[2]).not.toBe(api.update.mock.calls[1]?.[2]);
  });
  it("转换差异原样保留，安排严格使用服务器schedule动作；旧session关闭拒绝迟到写回", async () => {
    const api = ports(),
      session = createDraftSession(api, "privacy", { ...version, actions: ["edit"] });
    api.update.mockResolvedValueOnce({
      ...converted({ ...version, actions: ["edit"], lockVersion: 5 }),
      conversion: { state: "converted", warnings: [{ code: "text_mismatch", similarityBp: 5000 }] },
    });
    const result = await session.save(editorBody(initialFields(version), true));
    expect(result.conversion.warnings).toEqual([{ code: "text_mismatch", similarityBp: 5000 }]);
    await expect(session.schedule(editorBody(initialFields(version), true), "")).rejects.toThrow(
      "当前版本不可安排",
    );
    expect(api.schedule).not.toHaveBeenCalled();
    session.close();
    await expect(session.save(editorBody(initialFields(version), true))).rejects.toThrow(
      "编辑已结束",
    );
  });
});
