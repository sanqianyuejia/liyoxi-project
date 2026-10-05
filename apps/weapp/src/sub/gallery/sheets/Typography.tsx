import { View } from "@tarojs/components";

import { Demo } from "../demo";

import "./sheets.scss";

// 字号与字重（规范 第 2.2、2.4 节）。每行左边是变量名与规格，右边是照这个规格写的一句样例。

const SIZES: readonly { name: string; spec: string; sample: string; mod?: string }[] = [
  { name: "title", spec: "17px / 600", sample: "页面标题、弹层标题", mod: "semibold" },
  { name: "heading", spec: "16px / 600", sample: "卡片标题", mod: "semibold" },
  { name: "body", spec: "15px / 400 或 600", sample: "按钮、输入框文字、列表主标题" },
  { name: "body-sm", spec: "14px / 400 或 600", sample: "表单标签、页签、次级正文" },
  { name: "caption", spec: "13px / 400", sample: "辅助说明、提示条、小按钮" },
  { name: "tag", spec: "12px / 600 或 400", sample: "标签、次要说明", mod: "semibold" },
  { name: "mini", spec: "11px / 600", sample: "数字角标、缩略图标注", mod: "semibold" },
  { name: "display", spec: "24px / 900，衬线", sample: "巷口那家店", mod: "display" },
  { name: "number-lg", spec: "28px / 700", sample: "12,860", mod: "bold" },
  { name: "number-md", spec: "22px / 700", sample: "¥3,000", mod: "bold" },
  { name: "number-sm", spec: "18px / 700", sample: "¥1,280.50", mod: "bold" },
];

export default function TypographySheet() {
  return (
    <>
      <Demo title="2.2 商家端字号：十一档">
        {SIZES.map((size) => (
          <View key={size.name} className="lyx-sheet-type">
            <View className="lyx-sheet-type__meta">
              <View className="lyx-sheet-type__name">{size.name}</View>
              <View className="lyx-sheet-type__spec">{size.spec}</View>
            </View>
            <View
              className={`lyx-sheet-type__sample lyx-sheet-type__sample--${size.name}${
                size.mod ? ` lyx-sheet-type__sample--${size.mod}` : ""
              }`}
            >
              {size.sample}
            </View>
          </View>
        ))}
      </Demo>
      <Demo title="2.4 字重：400 正文，600 标题与按钮，700 数字，900 只与衬线体搭配">
        <View className="lyx-sheet-type__sample lyx-sheet-type__sample--body">正文 400</View>
        <View className="lyx-sheet-type__sample lyx-sheet-type__sample--body lyx-sheet-type__sample--semibold">
          标题与按钮 600
        </View>
        <View className="lyx-sheet-type__sample lyx-sheet-type__sample--body lyx-sheet-type__sample--bold">
          数字强调 700：2,160 积分
        </View>
        <View className="lyx-sheet-type__sample lyx-sheet-type__sample--body lyx-sheet-type__sample--display">
          衬线 900：狸有戏
        </View>
      </Demo>
      <Demo title="2.2 多行文字行高 1.5">
        <View className="lyx-demo__note">
          平台整理好后会通知您。素材审核一般在 1
          个工作日内完成；审核没有通过时，会写明原因与下一步，您补充后可以重新提交。
        </View>
      </Demo>
    </>
  );
}
