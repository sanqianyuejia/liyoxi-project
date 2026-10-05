import { View } from "@tarojs/components";
import Taro from "@tarojs/taro";

import { GALLERY_GROUPS, GALLERY_ITEMS, GALLERY_PREVIEW_ROUTE } from "@/gallery";

import "../demo.scss";

// 组件陈列的目录页（开发用）：按规范 第 4.3 节的分组列出全部组件，点进去看预览
export default function Page() {
  return (
    <View className="lyx-gallery">
      {GALLERY_GROUPS.map((group) => {
        const items = GALLERY_ITEMS.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <View key={group}>
            <View className="lyx-gallery-index__group">{group}</View>
            <View className="lyx-gallery-index__list">
              {items.map((item) => (
                <View
                  key={item.name}
                  className="lyx-gallery-index__row"
                  hoverClass="lyx-gallery-index__row--pressed"
                  onClick={() => {
                    void Taro.navigateTo({ url: `/${GALLERY_PREVIEW_ROUTE}?name=${item.name}` });
                  }}
                >
                  <View>{item.title}</View>
                  <View className="lyx-gallery-index__name">{item.name}</View>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
