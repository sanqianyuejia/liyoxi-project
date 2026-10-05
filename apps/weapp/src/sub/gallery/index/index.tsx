import { View } from "@tarojs/components";
import Taro from "@tarojs/taro";

import {
  GALLERY_GROUP_SPEC,
  GALLERY_GROUPS,
  GALLERY_ITEMS,
  GALLERY_PREVIEW_ROUTE,
  GALLERY_SHEETS,
} from "@/gallery";

import "../demo.scss";

// 组件陈列的目录页（开发与看样用）：照规范的章节先后分组，每组标着规范的节号与对照的要点；
// 先列基础样张，再列组件，点进去看预览。
export default function Page() {
  return (
    <View className="lyx-gallery">
      <View className="lyx-demo__note">
        对照设计规范（design/design-spec.md）看：每组标题后面是规范的节号，下面一行是这一组要对的要点。
      </View>
      {GALLERY_GROUPS.map((group) => {
        const entries = [
          ...GALLERY_SHEETS.filter((sheet) => sheet.group === group).map((sheet) => ({
            key: `sheet:${sheet.name}`,
            title: sheet.title,
            tail: "样张",
            query: `sheet=${sheet.name}`,
          })),
          ...GALLERY_ITEMS.filter((item) => item.group === group).map((item) => ({
            key: item.name,
            title: item.title,
            tail: item.name,
            query: `name=${item.name}`,
          })),
        ];
        if (entries.length === 0) return null;
        const { spec, points } = GALLERY_GROUP_SPEC[group];
        return (
          <View key={group}>
            <View className="lyx-gallery-index__group">
              <View className="lyx-gallery-index__group-name">{group}</View>
              <View className="lyx-gallery-index__group-spec">规范 {spec}</View>
            </View>
            <View className="lyx-gallery-index__points">{points}</View>
            <View className="lyx-gallery-index__list">
              {entries.map((entry) => (
                <View
                  key={entry.key}
                  className="lyx-gallery-index__row"
                  hoverClass="lyx-gallery-index__row--pressed"
                  onClick={() => {
                    void Taro.navigateTo({ url: `/${GALLERY_PREVIEW_ROUTE}?${entry.query}` });
                  }}
                >
                  <View>{entry.title}</View>
                  <View className="lyx-gallery-index__name">{entry.tail}</View>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
