import { merchantTokens, sharedTokens } from "@liyoxi/shared/design/tokens";
import { View } from "@tarojs/components";

import { Demo } from "../demo";

import "./sheets.scss";

// 色板（规范 第 1 节）。色块的颜色由类名取样式变量（sheets.scss），旁边的色值是从设计变量的数据里读出来的字，
// 页面里不写色值。变量名与 design/tokens.json 的键相同。

/** 规范 第 1.1–1.5 节的分组：每组列哪些变量。没列进来的变量归到最后一组，不会漏 */
const GROUPS: readonly { title: string; names: readonly string[] }[] = [
  {
    title: "1.1 品牌色：primary 只作填充与图标色，橙色文字用 primary-text",
    names: ["primary", "primary-text", "primary-bg", "primary-bg-subtle"],
  },
  {
    title: "1.2 文字色：text-disabled 只用于禁用、未开放的内容",
    names: ["text-primary", "text-regular", "text-secondary", "text-disabled", "text-inverse"],
  },
  {
    title: "1.3 底色与描边：控件边界靠底色差识别，描边都很浅",
    names: [
      "bg-page",
      "bg-card",
      "bg-subtle",
      "bg-inverse",
      "fill-neutral",
      "fill-disabled",
      "border",
      "border-light",
      "divider",
      "border-strong",
      "mask",
    ],
  },
  {
    title: "1.4 状态色：文字色与浅底成对；待处理与品牌色同值",
    names: [
      "success",
      "success-bg",
      "info",
      "info-bg",
      "warning",
      "warning-bg",
      "danger",
      "danger-bg",
      "neutral",
      "neutral-bg",
      "danger-border",
    ],
  },
  {
    title: "1.5 商家端专有",
    names: [
      "fill-track",
      "accent-on-dark",
      "switch-on",
      "badge-bg",
      "text-on-dark-secondary",
      "fill-on-dark",
    ],
  },
];

/** 商家端用得到的全部颜色变量：共用的加商家端专有的，同名时取商家端的 */
export const MERCHANT_COLORS: Readonly<Record<string, string>> = {
  ...sharedTokens.color,
  ...merchantTokens.color,
};

export function colorGroups(): { title: string; names: string[] }[] {
  const listed = new Set(GROUPS.flatMap((group) => group.names));
  const rest = Object.keys(MERCHANT_COLORS).filter((name) => !listed.has(name));
  const groups = GROUPS.map((group) => ({
    title: group.title,
    names: group.names.filter((name) => name in MERCHANT_COLORS),
  }));
  return rest.length > 0 ? [...groups, { title: "其余变量", names: rest }] : groups;
}

export default function ColorsSheet() {
  return (
    <>
      {colorGroups().map((group) => (
        <Demo key={group.title} title={group.title}>
          {group.names.map((name) => (
            <View key={name} className="lyx-sheet-swatch">
              <View className={`lyx-sheet-swatch__chip lyx-sheet-swatch__chip--${name}`} />
              <View className="lyx-sheet-swatch__name">{name}</View>
              <View className="lyx-sheet-swatch__value">{MERCHANT_COLORS[name]}</View>
            </View>
          ))}
        </Demo>
      ))}
    </>
  );
}
