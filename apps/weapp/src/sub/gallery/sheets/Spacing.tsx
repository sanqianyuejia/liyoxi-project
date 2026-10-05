import { View } from "@tarojs/components";

import { Demo } from "../demo";

import "./sheets.scss";

// 间距、圆角与描边（规范 第 3 节）。尺寸都写在 sheets.scss 里取样式变量，这里只排版与标字。

const SPACES = ["2", "4", "6", "8", "10", "12", "14", "16", "20", "24"] as const;

const RADII: readonly { name: string; label: string }[] = [
  { name: "tag", label: "4 标签" },
  { name: "thumb", label: "6 缩略图" },
  { name: "cover", label: "8 封面" },
  { name: "input", label: "10 输入框" },
  { name: "tile", label: "12 单选卡" },
  { name: "card", label: "14 卡片" },
  { name: "card-lg", label: "16 大卡" },
  { name: "pill", label: "胶囊" },
];

export default function SpacingSheet() {
  return (
    <>
      <Demo title="间距阶梯：只取这十个值（px）">
        {SPACES.map((space) => (
          <View key={space} className="lyx-sheet-space">
            <View className="lyx-sheet-space__label">{space}</View>
            <View className={`lyx-sheet-space__bar lyx-sheet-space__bar--${space}`} />
          </View>
        ))}
      </Demo>
      <Demo title="圆角：商家端的各档" row>
        {RADII.map((radius) => (
          <View key={radius.name} className="lyx-sheet-radius">
            <View className={`lyx-sheet-radius__box lyx-sheet-radius__box--${radius.name}`} />
            <View className="lyx-sheet-radius__label">{radius.label}</View>
          </View>
        ))}
      </Demo>
      <Demo title="描边：默认 1px 实线；2px 用于页签下划线；虚线只用于上传与添加占位" row>
        <View className="lyx-sheet-border lyx-sheet-border--default">1px</View>
        <View className="lyx-sheet-border lyx-sheet-border--strong">2px</View>
        <View className="lyx-sheet-border lyx-sheet-border--dashed">虚线</View>
      </Demo>
      <Demo title="卡片不用阴影、不带描边，靠白底与页面底色区分" bare>
        <View className="lyx-sheet-card">卡片内边距 16；卡片之间 12；页面左右边距 16</View>
        <View className="lyx-sheet-card">表单字段之间 16；标签与控件之间 6</View>
      </Demo>
    </>
  );
}
