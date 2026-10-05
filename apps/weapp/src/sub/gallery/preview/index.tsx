import { View } from "@tarojs/components";
import Taro, { useLoad, useRouter } from "@tarojs/taro";

import { GALLERY_GROUP_SPEC, GALLERY_ITEMS, GALLERY_SHEETS } from "@/gallery";

import { PREVIEWS } from "../previews";
import { SHEETS } from "../sheets";

import "../demo.scss";

// 组件陈列的预览页（开发与看样用）：?name=<组件名> 看一个组件，?sheet=<样张名> 看一张基础样张。
// 页面顶上标着这一组对规范的哪一节、要对哪些要点。截图命令给每个组件、每张样张各截一张
export default function Page() {
  const { name = "", sheet = "" } = useRouter().params;
  const item = GALLERY_ITEMS.find((entry) => entry.name === name);
  const sheetItem = GALLERY_SHEETS.find((entry) => entry.name === sheet);
  const current = item ?? sheetItem;
  useLoad(() => {
    if (item) void Taro.setNavigationBarTitle({ title: `${item.title} ${item.name}` });
    else if (sheetItem) void Taro.setNavigationBarTitle({ title: sheetItem.title });
  });
  if (!current) {
    return (
      <View className="lyx-gallery">
        <View className="lyx-demo__note">
          没有这个预览：{name || sheet || "（没有给 name 或 sheet）"}
        </View>
      </View>
    );
  }
  const Preview = item ? PREVIEWS[item.name] : sheetItem ? SHEETS[sheetItem.name] : null;
  const { spec, points } = GALLERY_GROUP_SPEC[current.group];
  return (
    <View className="lyx-gallery">
      <View className="lyx-gallery-spec">
        <View className="lyx-gallery-spec__title">
          {current.title} · 规范 {spec}
        </View>
        <View className="lyx-gallery-spec__points">{points}</View>
      </View>
      {Preview ? <Preview /> : null}
    </View>
  );
}
