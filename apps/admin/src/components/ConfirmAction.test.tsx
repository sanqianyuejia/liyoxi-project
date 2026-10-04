// 二次确认的用例（任务书 第 7 节第 8 条）：敏感确认要再输入关键值，并把操作人看到的值交给提交函数；勾选前确认按钮禁用。
// 弹层本体挂在页面之外，服务端渲染不出来：这里渲染弹层里的面板并断言提交逻辑，点击流程由冒烟覆盖。
import { ConfigProvider } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  confirmReady,
  ConfirmPanel,
  submitConfirm,
  type ConfirmInput,
  type ConfirmResult,
  type ConfirmSpec,
  type ConfirmSubmit,
} from "./ConfirmAction";

const plain: ConfirmSpec = {
  title: "确认到账",
  echo: [
    { label: "付款单", value: "FK2026093000002" },
    { label: "到账金额", value: "¥3,000.00", emphasis: true },
  ],
  checkLabel: "我已核对到账金额与付款方",
  seenValue: "300000",
};

const sensitive: ConfirmSpec = {
  ...plain,
  title: "执行退款",
  sensitive: { label: "请输入退款金额", expected: "3000.00", placeholder: "与上面的金额一致" },
  seenValue: "300000",
  confirmText: "确认退款",
  danger: true,
};

function render(spec: ConfirmSpec, input: ConfirmInput, submitting = false): string {
  return renderToStaticMarkup(
    // 与应用外层同样的设置：两个字的按钮不自动加空格（src/app/App.tsx）
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <ConfirmPanel
        spec={spec}
        input={input}
        onInputChange={() => {}}
        submitting={submitting}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    </ConfigProvider>,
  );
}

/** 取出确认按钮那一个 <button …> 标签 */
function confirmButton(html: string, text: string): string {
  const tag = html.split("<button").find((part) => part.includes(`<span>${text}</span>`));
  if (!tag) throw new Error(`没找到“${text}”按钮`);
  return tag.slice(0, tag.indexOf(">"));
}

describe("勾选前确认按钮禁用", () => {
  it("普通确认：没勾选禁用，勾选后可点", () => {
    expect(confirmReady(plain, { checked: false, typed: "" })).toBe(false);
    expect(confirmReady(plain, { checked: true, typed: "" })).toBe(true);
    expect(confirmButton(render(plain, { checked: false, typed: "" }), "确认")).toContain(
      "disabled",
    );
    expect(confirmButton(render(plain, { checked: true, typed: "" }), "确认")).not.toContain(
      "disabled",
    );
  });

  it("回显关键信息，关键金额单独强调；勾选后那一行变成已勾选的样子", () => {
    const html = render(plain, { checked: true, typed: "" });
    expect(html).toContain("FK2026093000002");
    expect(html).toMatch(/class="lyx-confirm__key-value">¥3,000\.00</);
    expect(html).toContain('data-checked="true"');
    expect(render(plain, { checked: false, typed: "" })).toContain('data-checked="false"');
  });
});

describe("敏感确认要再输入关键值", () => {
  it("只勾选不够；输入的值与关键值一致才可点（首尾空白不计）", () => {
    expect(confirmReady(sensitive, { checked: true, typed: "" })).toBe(false);
    expect(confirmReady(sensitive, { checked: true, typed: "3000" })).toBe(false);
    expect(confirmReady(sensitive, { checked: false, typed: "3000.00" })).toBe(false);
    expect(confirmReady(sensitive, { checked: true, typed: " 3000.00 " })).toBe(true);
    expect(
      confirmButton(render(sensitive, { checked: true, typed: "3000" }), "确认退款"),
    ).toContain("disabled");
    expect(
      confirmButton(render(sensitive, { checked: true, typed: "3000.00" }), "确认退款"),
    ).not.toContain("disabled");
  });

  it("面板里有输入框与它的标签；危险操作的确认按钮是危险实心", () => {
    const html = render(sensitive, { checked: false, typed: "" });
    expect(html).toContain("请输入退款金额");
    expect(html).toContain('placeholder="与上面的金额一致"');
    expect(confirmButton(html, "确认退款")).toContain("ant-btn-dangerous");
  });
});

describe("把操作人看到的值交给提交函数", () => {
  const done: ConfirmResult = { outcome: "done" };

  it("准备好了：提交函数拿到操作人看到的关键值与幂等键", async () => {
    const onConfirm = vi.fn((_submit: ConfirmSubmit) => Promise.resolve(done));
    const result = await submitConfirm(
      sensitive,
      { checked: true, typed: "3000.00" },
      "refund-execute:k1",
      onConfirm,
    );
    expect(result).toEqual(done);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      seenValue: "300000",
      idempotencyKey: "refund-execute:k1",
    });
  });

  it("没准备好：不调提交函数", async () => {
    const onConfirm = vi.fn((_submit: ConfirmSubmit) => Promise.resolve(done));
    expect(await submitConfirm(sensitive, { checked: true, typed: "1" }, "k", onConfirm)).toEqual({
      outcome: "not-ready",
    });
    expect(await submitConfirm(plain, { checked: false, typed: "" }, "k", onConfirm)).toEqual({
      outcome: "not-ready",
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("没给关键值的普通确认交 null；服务端说回显不一致时原样返回 mismatch；提交函数抛错按失败算", async () => {
    const seen: ConfirmSubmit[] = [];
    const result = await submitConfirm(
      { sensitive: undefined },
      { checked: true, typed: "" },
      "k2",
      (submit) => {
        seen.push(submit);
        return Promise.resolve({ outcome: "mismatch" });
      },
    );
    expect(seen).toEqual([{ seenValue: null, idempotencyKey: "k2" }]);
    expect(result).toEqual({ outcome: "mismatch" });
    const failed = await submitConfirm(plain, { checked: true, typed: "" }, "k3", () =>
      Promise.reject(new Error("断网")),
    );
    expect(failed).toEqual({ outcome: "failed", message: "没有提交成功，请重试" });
  });

  it("提交中：确认按钮转圈、取消按钮禁用", () => {
    const html = render(plain, { checked: true, typed: "" }, true);
    expect(confirmButton(html, "确认")).toContain("ant-btn-loading");
    expect(confirmButton(html, "取消")).toContain("disabled");
  });
});
