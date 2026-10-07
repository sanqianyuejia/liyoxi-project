import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { AuditDetail } from "./api";
import { AuditDetailPanel } from "./detail";
import { displayFields, safeText, authLabel, accessFieldLabel } from "./display";
const detail: AuditDetail = {
  auditLogId: "01900000-0000-7000-8000-000000000001",
  logNo: "RZ2026100800001",
  createdAt: "2026-10-07T16:00:00Z",
  stream: "access",
  category: "pii_reveal",
  action: "pii.phone.reveal",
  summary: "查看phone字段",
  actor: { actorType: "system", actorId: null, name: "系统", role: "自动任务", client: null },
  target: null,
  entityId: null,
  storeId: null,
  reason: null,
  before: {
    phone: "13900008881",
    nested: { secretMarker: "NEVER_RENDER_NESTED" },
    password: "NEVER_RENDER_PASSWORD",
  },
  after: { phone: "139****8882" },
  meta: {
    purpose: "verify_identity",
    note: "联系13900009991",
    value: "NEVER_RENDER_VALUE",
    unknown: "NEVER_RENDER_UNKNOWN",
  },
  authMethod: "system",
  ipMask: null,
  requestId: null,
  jobName: "lyxtest.audit",
  onBehalfOfEntityId: null,
  link: { route: "system.roles", params: { roleKey: "finance" }, label: "角色权限" },
};
it("脱敏详情的HTML、属性、隐藏节点都不含被裁剪原文", () => {
  const html = renderToStaticMarkup(<AuditDetailPanel detail={detail} access={null} />);
  for (const secret of [
    "NEVER_RENDER_NESTED",
    "NEVER_RENDER_PASSWORD",
    "NEVER_RENDER_VALUE",
    "NEVER_RENDER_UNKNOWN",
    "13900008881",
    "13900009991",
  ])
    expect(html).not.toContain(secret);
  expect(html).toContain("139****8881");
  expect(html).toContain("139****8882");
  expect(html).toContain("核验身份");
  expect(html).toContain("访问字段");
  expect(html).toContain("手机号");
  expect(html).toContain("操作人类型");
  expect(html).toContain("系统任务");
  expect(html).toContain("暂不可跳转");
  expect(html).not.toContain("href=");
  expect(html).toContain("访问留痕不包含被查看的值");
});
it("未知复杂结构和值保守裁剪，已脱敏串不重新显露", () => {
  expect(
    displayFields({
      phoneMask: "139****8881",
      mystery: ["SECRET"],
      token: "SECRET",
      value: "SECRET",
    }),
  ).toEqual([
    { key: "phoneMask", label: "手机号（已脱敏）", value: "139****8881" },
    { key: "mystery", label: "其他字段", value: "复杂内容已裁剪" },
  ]);
  expect(safeText("联系13900008881/1234567890123456")).toBe("联系139****8881/****3456");
  expect(authLabel("password+totp")).toBe("账号密码 ＋ 动态口令");
  expect(authLabel("password+recovery")).toBe("账号密码 ＋ 恢复码");
});

it("访问字段按真实审计动作编码显示，未知/自由动作不成为字段或URL", () => {
  expect(accessFieldLabel("pii.contact_phone.reveal")).toBe("联系电话");
  expect(accessFieldLabel("pii.legal_rep_name.reveal")).toBe("法定代表人");
  expect(accessFieldLabel("pii.unknown.reveal")).toBe("其他字段");
  expect(accessFieldLabel("https://example.invalid")).toBeUndefined();
});

it("已脱敏具名值中的其他号码仍脱敏；备注中的证照/座机/信用代码不带原文", () => {
  const rendered = renderToStaticMarkup(
    <AuditDetailPanel
      detail={{
        ...detail,
        after: { phoneMask: "139****8881 13900009991" },
        meta: { note: "座机028-88883321；证照JY25101040000111；信用代码91510104MA6B3G2X2R" },
      }}
      access={null}
    />,
  );
  for (const value of ["13900009991", "028-88883321", "JY25101040000111", "91510104MA6B3G2X2R"])
    expect(rendered.includes(value)).toBe(false);
  expect(rendered).toContain("139****9991");
  expect(rendered).toContain("028-****3321");
  expect(rendered).toContain("91510104MA6B****2R");
});

it("合法JSON中的原型属性名不会越过字段白名单或使详情崩溃", () => {
  const keys = Object.getOwnPropertyNames(Object.prototype);
  const meta = Object.fromEntries(keys.map((key) => [key, "INHERITED_META_PRIVATE"]));
  expect(displayFields(meta)).toEqual(
    keys.map((key) => ({ key, label: "其他字段", value: "已裁剪" })),
  );
  const html = renderToStaticMarkup(
    <AuditDetailPanel detail={{ ...detail, meta, before: meta, after: meta }} access={null} />,
  );
  expect(html).not.toContain("INHERITED_META_PRIVATE");
  expect(html).toContain("已裁剪");
});

it("用途与访问字段映射只接受自有键，原型属性使用未知文案", () => {
  for (const purpose of ["__proto__", "constructor", "toString"]) {
    expect(displayFields({ purpose })).toEqual([
      { key: "purpose", label: "访问用途", value: "其他" },
    ]);
    expect(() =>
      renderToStaticMarkup(
        <AuditDetailPanel detail={{ ...detail, meta: { purpose } }} access={null} />,
      ),
    ).not.toThrow();
  }
  expect(accessFieldLabel("pii.constructor.reveal")).toBe("其他字段");
  expect(displayFields({ purpose: "finance_ops", status: "active" })).toEqual([
    { key: "purpose", label: "访问用途", value: "财务处理" },
    { key: "status", label: "状态", value: "active" },
  ]);
});
