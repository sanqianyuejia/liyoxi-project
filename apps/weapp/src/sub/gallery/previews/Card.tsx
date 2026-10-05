import { View } from "@tarojs/components";

import { Card } from "@/components/Card";
import { DescList } from "@/components/DescList";
import { StatusTag } from "@/components/StatusTag";
import { TextButton } from "@/components/TextButton";

import { Demo } from "../demo";

export default function CardPreview() {
  return (
    <>
      <Demo title="标准卡片：圆角 14，内边距 16，内部间距 12" bare>
        <Card title="门店信息" extra={<TextButton arrow>编辑</TextButton>}>
          <DescList
            items={[
              { label: "门店", value: "云间火锅（春熙路店）" },
              { label: "行业", value: "餐饮 / 火锅" },
            ]}
          />
        </Card>
        <Card title="上线概览" extra="近 30 天">
          <View className="lyx-demo__note">标题右侧也可以放 12px 的说明。</View>
        </Card>
      </Demo>
      <Demo title="列表项卡：内边距 14 16；整张可点" bare>
        <Card
          variant="item"
          title="《巷口那家店》"
          extra={
            <StatusTag tone="info" plain>
              制作中
            </StatusTag>
          }
          onClick={() => undefined}
        >
          <View className="lyx-demo__note">都市温情 · 整部 80 集</View>
        </Card>
      </Demo>
      <Demo title="深色卡：圆角 16，眉标字间距 2px" bare>
        <Card variant="dark" eyebrow="当前套餐" title="标准版" extra="可使用至 2027-12-31">
          <View>2,160 积分</View>
        </Card>
      </Demo>
      <Demo title="卡内浅底块：圆角 10">
        <Card variant="subtle" title="交付说明">
          <View className="lyx-demo__note">样片确认后 3 个工作日内交付成片。</View>
        </Card>
      </Demo>
    </>
  );
}
