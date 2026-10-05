// 主题与组件级配置里“规范写了数值、antd 的缺省不是这个数”的几样（规范 第 5.3、5.4、8 节）。
// 只断言交给 antd 的配置；落到页面上的样子由冒烟与看样核对。取值与设计变量比，不写色值。
import { adminTokens, sharedTokens } from "@liyoxi/shared/design/tokens";
import type { DrawerProps } from "antd";
import { describe, expect, it } from "vitest";

import { adminComponentConfig, adminTheme } from "./antd";

const components = adminTheme.components ?? {};

describe("组件级配置（ConfigProvider）", () => {
  it("弹窗两个方向居中", () => {
    expect(adminComponentConfig.modal).toEqual({ centered: true });
  });

  it("表单不显示必填星号；提交时有错滚到第一个出错的字段，落在视口中间（标签与错误提示一起看得见）", () => {
    expect(adminComponentConfig.form).toEqual({
      requiredMark: false,
      scrollToFirstError: { block: "center" },
    });
  });

  it("两个字的按钮不自动加空格", () => {
    expect(adminComponentConfig.button).toEqual({ autoInsertSpace: false });
  });

  it("抽屉的关闭按钮在标题右侧（照原型）", () => {
    expect(adminComponentConfig.drawer.closable).toEqual({ placement: "end" });
  });

  it("左右方向的抽屉缺省宽 480；页面自己给了 size 的、上下方向的不动", () => {
    const widthOf = (props: DrawerProps): unknown =>
      adminComponentConfig.drawer.styles({ props }).wrapper?.width;
    expect(adminTokens.size.drawer).toBe("480px");
    expect(widthOf({})).toBe("480px");
    expect(widthOf({ placement: "right" })).toBe("480px");
    expect(widthOf({ placement: "left" })).toBe("480px");
    expect(widthOf({ size: 640 })).toBeUndefined();
    expect(widthOf({ size: "large" })).toBeUndefined();
    expect(widthOf({ placement: "top" })).toBeUndefined();
    expect(widthOf({ placement: "bottom" })).toBeUndefined();
  });
});

describe("主题里的控件规格", () => {
  it("开关 36 × 20，滑块 16 带 shadow-knob；开是成功绿，关是 fill-disabled", () => {
    expect(components.Switch).toMatchObject({
      trackMinWidth: 36,
      trackHeight: 20,
      trackPadding: 2,
      handleSize: 16,
      handleShadow: adminTokens.shadow.knob,
      colorPrimary: adminTokens.color["switch-on"],
      colorTextQuaternary: sharedTokens.color["fill-disabled"],
      colorTextTertiary: sharedTokens.color["fill-disabled"],
    });
  });

  it("分段控件的项 13px，轨道内边距 3", () => {
    expect(components.Segmented).toMatchObject({ fontSize: 13, trackPadding: 3 });
  });

  it("日期选择器套输入框的规格：13px、左右内边距 10、聚焦描边主色加浅色光晕", () => {
    const input = components.Input ?? {};
    expect(components.DatePicker).toMatchObject({
      inputFontSize: 13,
      paddingInline: 10,
      hoverBorderColor: sharedTokens.color.primary,
      activeBorderColor: sharedTokens.color.primary,
      activeShadow: adminTokens.shadow["focus-ring-input"],
    });
    // 与输入框是同一组取值
    expect(components.DatePicker).toMatchObject({
      inputFontSize: input.inputFontSize,
      paddingInline: input.paddingInline,
      activeBorderColor: input.activeBorderColor,
      activeShadow: input.activeShadow,
    });
  });

  it("antd 的卡片：圆角 12、内边距 16、标题 15px", () => {
    expect(components.Card).toMatchObject({
      borderRadiusLG: 12,
      bodyPadding: 16,
      headerPadding: 16,
      headerFontSize: 15,
    });
  });

  it("三档按钮的圆角：大号也是 8（不跟全局的 12）；弹窗圆角 14", () => {
    expect(components.Button).toMatchObject({ borderRadiusLG: 8 });
    expect(components.Modal).toMatchObject({ borderRadiusLG: 14 });
  });
});

describe("第四轮复审之后补的", () => {
  it("下拉左右内边距 10：antd 按“paddingSM 减描边宽”算，paddingSM 给 10 + 1；与输入框的左右内边距同值", () => {
    const borderWidth = Number.parseFloat(sharedTokens["border-width"].default);
    expect(borderWidth).toBe(1);
    expect(components.Select).toMatchObject({ paddingSM: 11, fontSize: 13 });
    expect((components.Select?.paddingSM ?? 0) - borderWidth).toBe(components.Input?.paddingInline);
    expect(components.Input?.paddingInline).toBe(10);
  });

  it("antd 的 Tabs、Pagination、Breadcrumb 不设主题：用本目录自己的页签、分页与面包屑，不留半套的配置", () => {
    for (const name of ["Tabs", "Pagination", "Breadcrumb"]) {
      expect(Object.keys(components)).not.toContain(name);
    }
  });
});

describe("第五轮复审之后补的", () => {
  it("弹窗标题的行高取标题行高 1.3（规范 第 2.3 节）；antd 缺省按标题字号算出 1.5", () => {
    expect(adminTokens["line-height"]).toEqual({ body: 1.6, title: 1.3 });
    expect(components.Modal).toMatchObject({
      titleFontSize: 18,
      titleLineHeight: adminTokens["line-height"].title,
    });
  });

  it("不改 antd 全局主题的行高：控件的上下内边距按它算，改了各控件的高会差出零点几个像素；段落的 1.6 在 global.css 里给", () => {
    expect(Object.keys(adminTheme.token ?? {})).not.toContain("lineHeight");
    for (const name of ["Input", "InputNumber", "Select", "DatePicker", "Button", "Table"]) {
      const overrides = (components as Record<string, object | undefined>)[name] ?? {};
      expect(Object.keys(overrides), name).not.toContain("lineHeight");
    }
  });
});
