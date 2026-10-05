import { View } from "@tarojs/components";
import { useState } from "react";

import { InfoTag } from "@/components/InfoTag";
import { OptionCard } from "@/components/OptionCard";

import { Demo } from "../demo";

import "./form.scss";

export default function OptionCardPreview() {
  const [plan, setPlan] = useState("standard");
  return (
    <>
      <Demo title="单选卡：未选、选中（主色描边加浅橙底）">
        <OptionCard
          title="标准版"
          description="每月 2,000 积分，可订购 4 部短剧"
          extra="¥3,000 / 月"
          selected={plan === "standard"}
          onClick={() => setPlan("standard")}
        />
        <OptionCard
          title="旗舰版"
          description="每月 5,000 积分，含广告视频 2 条"
          extra="¥6,800 / 月"
          selected={plan === "pro"}
          onClick={() => setPlan("pro")}
        />
      </Demo>
      <Demo title="不可选；卡片里再放内容">
        <OptionCard title="体验版" description="已体验过，不能再次开通" disabled />
        <OptionCard title="对公转账" description="到账后 1 个工作日内确认" selected>
          <View>
            <InfoTag>需上传转账凭证</InfoTag>
          </View>
        </OptionCard>
      </Demo>
      <Demo title="两列排">
        <View className="lyx-form-demo__grid">
          <OptionCard title="整部订购" description="80 集" selected />
          <OptionCard title="分批订购" description="每批 20 集" />
        </View>
      </Demo>
    </>
  );
}
