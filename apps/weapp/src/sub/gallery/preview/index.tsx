import { View } from "@tarojs/components";
import Taro, { useLoad, useRouter } from "@tarojs/taro";

import { GALLERY_ITEMS } from "@/gallery";

import { PREVIEWS } from "../previews";

import "../demo.scss";

// 组件陈列的预览页（开发用）：?name=<组件名> 指定看哪个组件。截图命令给每个组件各截一张
export default function Page() {
  const name = useRouter().params.name ?? "";
  const item = GALLERY_ITEMS.find((entry) => entry.name === name);
  useLoad(() => {
    if (item) void Taro.setNavigationBarTitle({ title: `${item.title} ${item.name}` });
  });
  if (!item) {
    return (
      <View className="lyx-gallery">
        <View className="lyx-demo__note">没有这个组件的预览：{name || "（没有给 name）"}</View>
      </View>
    );
  }
  const Preview = PREVIEWS[item.name];
  return (
    <View className="lyx-gallery">
      <Preview />
    </View>
  );
}
