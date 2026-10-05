import { sharedTokens } from "@liyoxi/shared/design/tokens";
import { View } from "@tarojs/components";

import { Cover } from "@/components/Cover";

import { Demo } from "../demo";

import sample from "../assets/sample-cover.png";

import "./Cover.scss";

// 占位底色本该是每部剧自己的主色（接口给）；这里借几个样式变量的值当示例数据
const color = sharedTokens.color;

export default function CoverPreview() {
  return (
    <>
      <Demo title="宫格封面（两列）：占位样式，带角标与左下角文字">
        <View className="lyx-cover-demo__grid">
          <Cover
            title="巷口那家店"
            color={color.primary}
            badge="新剧"
            badgeTone="info"
            caption="80 集"
          />
          <Cover
            title="山那边的信"
            color={color.info}
            badge="推荐"
            badgeTone="warning"
            caption="60 集"
          />
        </View>
      </Demo>
      <Demo title="有封面图：铺满裁切，不显示细框与剧名；文字下垫暗色渐变">
        <View className="lyx-cover-demo__grid">
          <Cover title="巷口那家店" src={sample} badge="新剧" badgeTone="info" caption="80 集" />
          <Cover
            title="加载失败回落占位"
            src="/no-such-image.png"
            color={color.success}
            caption="40 集"
          />
        </View>
      </Demo>
      <Demo title="失效态：去色，不透明度 0.45；没给底色时的兜底" row>
        <View className="lyx-cover-demo__scroll">
          <Cover variant="scroll" title="旧时光" color={color.primary} invalid />
        </View>
        <View className="lyx-cover-demo__scroll">
          <Cover variant="scroll" title="无名之辈" />
        </View>
      </Demo>
      <Demo title="缩略图：60 × 80 与 42 × 56" row>
        <Cover variant="thumb" title="巷口那家店" color={color.primary} />
        <Cover variant="thumb" title="巷口那家店" src={sample} />
        <Cover variant="thumb-sm" title="山那边的信" color={color.info} />
        <Cover variant="thumb-sm" title="旧时光" color={color.success} />
        <Cover variant="thumb-sm" title="巷口那家店" src={sample} invalid />
      </Demo>
    </>
  );
}
