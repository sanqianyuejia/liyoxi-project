// Ant Design 主题：全局取 W0-26 的生成物（规范 第 5.4 节的全局主题表），这里只加组件级覆盖
//（规范 第 5.4 节“组件级的要点”）。取值全部来自设计变量，不写色值。
// 主题管不到的地方（二级菜单的高度与缩进、关闭按钮、页签计数徽标等）在 global.css 里用样式覆盖。
import { antdTheme } from "@liyoxi/shared/design/antd-theme";
import { adminTokens, sharedTokens } from "@liyoxi/shared/design/tokens";
import type { ConfigProviderProps, ThemeConfig } from "antd";

const px = (value: string): number => Number.parseFloat(value);

const color = { ...sharedTokens.color, ...adminTokens.color };
const size = adminTokens.size;
const fontSize = adminTokens["font-size"];
const radius = adminTokens.radius;
const shadow = adminTokens.shadow;

/** 全局字号 14，表格、输入框、下拉、描述列表、面包屑下调到 13（规范 第 5.4 节） */
const BODY = px(fontSize.body);

/** 开关轨道高 20、滑块 16（规范 第 5.3 节；样式变量里只有轨道宽，高与滑块写在它的说明里）：轨道内边距 2，滑块 = 20 − 2 × 2 */
const SWITCH_HEIGHT = 20;
const SWITCH_PADDING = px(sharedTokens.space[2]);

export const adminTheme: ThemeConfig = {
  token: { ...antdTheme.token },
  components: {
    Layout: {
      siderBg: color["sidebar-bg"],
      headerBg: color["bg-card"],
      headerHeight: px(adminTokens.layout["header-height"]),
      headerPadding: `0 ${sharedTokens.space[24]}`,
      bodyBg: color["bg-page"],
    },
    Menu: {
      darkItemBg: color["sidebar-bg"],
      darkSubMenuItemBg: color["sidebar-bg"],
      darkPopupBg: color["sidebar-bg"],
      darkItemColor: color["sidebar-text"],
      darkItemHoverColor: color["text-inverse"],
      darkItemSelectedBg: color["sidebar-active-bg"],
      darkItemSelectedColor: color["text-inverse"],
      darkGroupTitleColor: color["sidebar-text-muted"],
      itemHeight: px(size["menu-item"]),
      itemBorderRadius: px(radius.control),
      subMenuItemBorderRadius: px(radius.control),
      itemMarginInline: 0,
      itemMarginBlock: px(sharedTokens.space[2]),
      itemPaddingInline: px(sharedTokens.space[12]),
      iconSize: 18,
      iconMarginInlineEnd: px(sharedTokens.space[10]),
    },
    Table: {
      headerBg: color["bg-subtle"],
      headerColor: color["text-secondary"],
      headerSplitColor: "transparent",
      headerBorderRadius: 0,
      borderColor: color.divider,
      rowHoverBg: color["bg-subtle"],
      rowSelectedBg: color["primary-bg-subtle"],
      rowSelectedHoverBg: color["primary-bg-subtle"],
      cellFontSize: BODY,
      // 列间距 12：每格左右各 6；首末列到卡片边 16 在 global.css 里补
      cellPaddingInline: px(sharedTokens.space[6]),
      cellPaddingBlock: px(sharedTokens.space[12]),
    },
    Button: {
      fontWeight: 400,
      primaryShadow: "none",
      defaultShadow: "none",
      dangerShadow: "none",
      defaultBorderColor: color["border-strong"],
      defaultHoverBorderColor: color.primary,
      defaultHoverColor: color["text-primary"],
      contentFontSizeLG: px(fontSize.base),
      contentFontSizeSM: BODY,
      paddingInline: px(sharedTokens.space[16]),
      paddingInlineLG: px(sharedTokens.space[20]),
      paddingInlineSM: px(sharedTokens.space[12]),
      borderColorDisabled: color["fill-disabled"],
      // 三档高度的圆角：36 与 40 都是 8（大号不跟全局的 12），行内 32 是 6（规范 第 5.2、5.3 节）
      borderRadiusLG: px(radius.control),
      // 悬停：主按钮底加深（规范 第 12 节）；antd 缺省由主色算出一个更浅的颜色
      colorPrimaryHover: color["primary-text"],
      // 文字按钮（“重置筛选”一类）悬停、按下不变浅，下划线在 global.css 里加
      colorLinkHover: color["primary-text"],
      colorLinkActive: color["primary-text"],
    },
    Modal: {
      titleFontSize: px(fontSize["title-lg"]),
      borderRadiusLG: px(radius.modal),
      boxShadow: shadow.modal,
      // 内边距 24、内部间距 16、关闭按钮 32 × 32 灰底：这几样没有公开的主题变量，在 global.css 里覆盖
    },
    Drawer: {
      fontSizeLG: px(fontSize["title-lg"]),
      // 宽 480 在下面的 adminComponentConfig 里给。阴影（antd 的抽屉不认 boxShadow，按方向各有一个不公开的变量）、
      // 头部内边距 24、关闭按钮 32 × 32 在 global.css 里覆盖
    },
    Tabs: {
      inkBarColor: color.primary,
      itemColor: color["text-secondary"],
      itemSelectedColor: color["text-primary"],
      itemHoverColor: color["text-primary"],
      itemActiveColor: color["text-primary"],
      titleFontSize: px(fontSize.base),
      horizontalItemGutter: px(sharedTokens.space[4]),
      horizontalItemPadding: `0 ${sharedTokens.space[10]}`,
      horizontalMargin: "0",
    },
    Input: {
      inputFontSize: BODY,
      paddingInline: px(sharedTokens.space[10]),
      hoverBorderColor: color.primary,
      activeBorderColor: color.primary,
      activeShadow: shadow["focus-ring-input"],
    },
    InputNumber: {
      inputFontSize: BODY,
      paddingInline: px(sharedTokens.space[10]),
      hoverBorderColor: color.primary,
      activeBorderColor: color.primary,
      activeShadow: shadow["focus-ring-input"],
    },
    // 日期与日期范围选择器套输入框的规格（规范 第 12 节“日期筛选”：套用主题）
    DatePicker: {
      inputFontSize: BODY,
      paddingInline: px(sharedTokens.space[10]),
      hoverBorderColor: color.primary,
      activeBorderColor: color.primary,
      activeShadow: shadow["focus-ring-input"],
    },
    Select: {
      fontSize: BODY,
      optionFontSize: BODY,
      hoverBorderColor: color.primary,
      activeBorderColor: color.primary,
      activeOutlineColor: color["primary-bg"],
      optionSelectedBg: color["primary-bg-subtle"],
    },
    Form: {
      labelFontSize: BODY,
      itemMarginBottom: px(sharedTokens.space[14]),
      verticalLabelPadding: `0 0 ${sharedTokens.space[6]}`,
    },
    Segmented: {
      trackBg: color["fill-neutral"],
      trackPadding: 3,
      itemSelectedBg: color["bg-card"],
      itemSelectedColor: color["text-primary"],
      itemColor: color["text-secondary"],
      // 项 13px（规范 第 5.2 节“分段控件”）；选中项字重 600 在 global.css 里给
      fontSize: BODY,
    },
    Checkbox: {
      controlInteractiveSize: px(size.checkbox),
      borderRadiusSM: px(sharedTokens.radius.sm),
    },
    // 开关 36 × 20，滑块 16 带 shadow-knob；开是成功绿，关是 fill-disabled（规范 第 5.3 节“开关”）
    Switch: {
      colorPrimary: color["switch-on"],
      colorPrimaryHover: color["switch-on"],
      colorTextQuaternary: color["fill-disabled"],
      colorTextTertiary: color["fill-disabled"],
      trackMinWidth: px(size["switch-width"]),
      trackHeight: SWITCH_HEIGHT,
      trackPadding: SWITCH_PADDING,
      handleSize: SWITCH_HEIGHT - SWITCH_PADDING * 2,
      handleShadow: shadow.knob,
    },
    Alert: {
      defaultPadding: `${sharedTokens.space[10]} ${sharedTokens.space[12]}`,
      // 圆角 8 在 global.css 里给，不在这里设：antd 6.6 的提示条用自己的圆角变量 --ant-alert-border-radius，
      // 组件级把它（或 borderRadiusLG）设成 8、与全局的 borderRadius 同值时，这个变量不输出，圆角落成 0（实测）
      colorSuccessBorder: color["success-bg"],
      colorInfoBorder: color["info-bg"],
      colorWarningBorder: color["warning-bg"],
      colorErrorBorder: color["danger-bg"],
      fontSize: BODY,
    },
    Card: {
      borderRadiusLG: px(radius.card),
      colorBorderSecondary: color["border-light"],
      boxShadowTertiary: "none",
      // 内容卡内边距 16、卡片标题 15px（规范 第 3 节、第 2.3 节）
      bodyPadding: px(sharedTokens.space[16]),
      headerPadding: px(sharedTokens.space[16]),
      headerFontSize: px(fontSize["title-md"]),
    },
    Breadcrumb: {
      fontSize: BODY,
      itemColor: color["text-secondary"],
      linkColor: color["text-secondary"],
      linkHoverColor: color["text-primary"],
      lastItemColor: color["text-primary"],
      separatorColor: color["text-secondary"],
    },
    Descriptions: {
      fontSize: BODY,
      labelColor: color["text-secondary"],
    },
    Pagination: {
      itemSize: px(size["control-sm"]),
      itemActiveBg: color["bg-inverse"],
      itemActiveColor: color["text-inverse"],
      itemActiveColorHover: color["text-inverse"],
      borderRadius: px(radius["icon-button"]),
      fontSize: BODY,
    },
    Notification: {
      colorBgElevated: color["bg-inverse"],
      colorText: color["text-inverse"],
      colorTextHeading: color["text-inverse"],
      colorIcon: color["text-inverse"],
      colorIconHover: color["text-inverse"],
      colorSuccess: color["toast-icon"],
      borderRadiusLG: px(radius.inner),
      fontSizeLG: BODY,
      fontSize: BODY,
      width: px(size["toast-max-width"]),
    },
    Tag: {
      borderRadiusSM: px(sharedTokens.radius.pill),
    },
  },
};

/**
 * ConfigProvider 上主题之外的组件级配置：主题变量管不到、又要全局一致的几样。应用外层（app/App.tsx）整个展开用。
 *   form     不显示必填星号，选填项在标签后写“（选填）”（规范 第 5.3 节）；提交时有错，页面滚到第一个出错的字段（规范 第 8 节）
 *   button   两个字的按钮不自动加空格（原型是“驳回”不是“驳 回”）
 *   modal    弹窗两个方向都居中（规范 第 5.3 节“弹窗｜居中”）；antd 的缺省是离顶 100
 *   drawer   左右方向的抽屉缺省宽 480（规范 第 5.3 节“抽屉”）；antd 的缺省 378 写死在组件里，没有主题变量。
 *            页面自己给了 size 的不动
 */
export const adminComponentConfig = {
  form: { requiredMark: false, scrollToFirstError: true },
  button: { autoInsertSpace: false },
  modal: { centered: true },
  drawer: {
    styles: ({ props }) =>
      props.size === undefined && props.placement !== "top" && props.placement !== "bottom"
        ? { wrapper: { width: size.drawer } }
        : {},
  },
} satisfies Pick<ConfigProviderProps, "form" | "button" | "modal" | "drawer">;

/** 局部主题：核对清单里的复选框用绿色（规范 第 5.4 节） */
export const checkListTheme: ThemeConfig = {
  token: { colorPrimary: color.success, colorPrimaryHover: color.success },
};
