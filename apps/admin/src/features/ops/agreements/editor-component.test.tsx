import type * as ReactModule from "react";
import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAppServices } from "../../../app/services";
import { createAgreementApi, type AgreementApi, type Version } from "./api";
import { createAgreementWorkspace } from "./model";

// Reuse the existing page-test hook boundary: callbacks below are the real editor,
// request-body builder and draft session, with one persistent component instance.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  refCursor: 0,
  refs: [] as { current: unknown }[],
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactModule>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots))
      hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.slots[index],
      (next: unknown) => {
        hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next;
      },
    ];
  },
  useRef(initial: unknown) {
    return (hooks.refs[hooks.refCursor++] ??= { current: initial });
  },
  useEffect() {},
  useCallback(callback: unknown) {
    return callback;
  },
}));
vi.mock("antd", () => ({
  Alert: "Alert",
  Button: "Button",
  Checkbox: "Checkbox",
  DatePicker: "DatePicker",
  Input: Object.assign(() => null, { TextArea: "TextArea" }),
  Modal: "Modal",
  Space: "Space",
}));
vi.mock("../../../components/FormField", () => ({ FormField: "FormField" }));
vi.mock("../../../components/UploadField", () => ({ UploadField: "UploadField" }));
vi.mock("../../../components/ConfirmAction", () => ({ ConfirmAction: "ConfirmAction" }));
import { AgreementEditor } from "./editor";

const versionId = "01910000-0000-7000-8000-000000000001";
const sourceFileId = "01910000-0000-7000-8000-000000000002";
const pdfFileId = "01910000-0000-7000-8000-000000000003";
const saved: Version = {
  agreementVersionId: versionId,
  agreementKey: "privacy",
  major: 1,
  minor: 1,
  versionLabel: "v1.1",
  status: "draft",
  displayStatus: "draft",
  effectiveAt: "2026-10-15T01:00:00.000Z",
  summary: "虚构调整",
  isReconsentRequired: false,
  isLegalApproved: false,
  sourceFile: null,
  pdfFile: null,
  hasContentHtml: true,
  contentSha256: null,
  siteNoticeId: null,
  shortNoticeReason: null,
  expectedConsents: null,
  activatedAt: null,
  createdBy: {
    staffId: versionId,
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
function nodes(value: unknown): ReactModule.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(value)) return [];
  const children = value.props.children;
  return [
    value,
    ...nodes(
      typeof children === "function"
        ? children({ id: "test-field", "aria-invalid": false })
        : children,
    ),
    ...nodes(value.props.footer),
  ];
}
beforeEach(() => {
  hooks.cursor = 0;
  hooks.slots = [];
  hooks.refCursor = 0;
  hooks.refs = [];
});
describe("W216 同一新建弹窗的保存生命周期", () => {
  it("首次create保存后清空四字段发真实PATCH null；失败重试保原id/lock/同key", async () => {
    const services = createAppServices();
    const mutation = (version: Version) => ({
      version,
      contentHtml: "<p>虚构正文</p>",
      conversion: { state: "converted" as const, warnings: [] },
    });
    const create = vi.fn<AgreementApi["create"]>(async () => mutation(saved));
    const update = vi
      .fn<AgreementApi["update"]>()
      .mockRejectedValueOnce(new Error("保存暂不可用"))
      .mockResolvedValue(mutation({ ...saved, lockVersion: 5 }));
    const api: AgreementApi = { ...createAgreementApi(services), create, update };
    const workspace = createAgreementWorkspace(api);
    const onSaved = vi.fn();
    function render() {
      hooks.cursor = hooks.refCursor = 0;
      return nodes(
        AgreementEditor({
          services,
          api,
          workspace,
          agreementKey: "privacy",
          canBumpMajor: false,
          canShortNotice: false,
          onClose: vi.fn(),
          onSaved,
        }),
      );
    }
    function control(type: string, text?: string) {
      const found = render().find(
        (node) => node.type === type && (text === undefined || node.props.children === text),
      );
      if (!found) throw new Error(`Missing editor control: ${type}/${text ?? ""}`);
      return found.props;
    }
    async function click(text: string) {
      const { onClick } = control("Button", text);
      if (typeof onClick !== "function") throw new Error("Missing real click callback");
      onClick();
      await vi.waitFor(() => expect(control("Button", "保存草稿").disabled).toBe(false));
    }
    const date = control("DatePicker");
    if (typeof date.onChange !== "function") throw new Error("Missing date callback");
    date.onChange(null, "2026-10-15");
    const summary = control("TextArea");
    if (typeof summary.onChange !== "function") throw new Error("Missing summary callback");
    summary.onChange({ target: { value: "虚构调整" } });
    for (const [text, id] of [
      ["上传或替换 Word", sourceFileId],
      ["上传或替换 PDF", pdfFileId],
    ]) {
      const field = render().find(
        (node) => node.type === "UploadField" && node.props.text === text,
      );
      if (!field || typeof field.props.onChange !== "function")
        throw new Error("Missing completed-upload callback");
      field.props.onChange(id);
    }
    await click("保存草稿");
    expect(create).toHaveBeenCalledExactlyOnceWith(
      "privacy",
      {
        bumpMajor: false,
        isLegalApproved: false,
        isReconsentRequired: false,
        effectiveAt: saved.effectiveAt,
        summary: saved.summary,
        sourceFileId,
        pdfFileId,
      },
      expect.any(String),
    );
    await click("清除生效日期");
    summary.onChange({ target: { value: "" } });
    await click("清除 Word 引用");
    await click("清除 PDF 引用");
    await click("保存草稿");
    expect(update.mock.calls[0]?.slice(0, 2)).toEqual([
      versionId,
      {
        lockVersion: 4,
        effectiveAt: null,
        summary: null,
        sourceFileId: null,
        pdfFileId: null,
        isLegalApproved: false,
        isReconsentRequired: false,
      },
    ]);
    await click("保存草稿");
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]).toEqual(update.mock.calls[0]);
    expect(onSaved).toHaveBeenCalledTimes(2);
    workspace.close();
  });
});
