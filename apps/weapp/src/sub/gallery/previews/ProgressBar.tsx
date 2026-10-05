import { View } from "@tarojs/components";

import { ProgressBar } from "@/components/ProgressBar";

import { Demo } from "../demo";

export default function ProgressBarPreview() {
  return (
    <>
      <Demo title="高 4，轨道灰、填充主色">
        <ProgressBar percent={0} />
        <ProgressBar percent={32} />
        <ProgressBar percent={76} />
      </Demo>
      <Demo title="到 100% 时填充改为成功绿">
        <ProgressBar percent={100} />
      </Demo>
      <Demo title="配文字">
        <View className="lyx-demo__note">已发布 12 / 80 集</View>
        <ProgressBar percent={15} />
      </Demo>
    </>
  );
}
