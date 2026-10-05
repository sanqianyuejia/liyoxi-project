import { View } from "@tarojs/components";

import { Card } from "@/components/Card";
import { Section } from "@/components/Section";
import { TextButton } from "@/components/TextButton";

import { Demo } from "../demo";

export default function SectionPreview() {
  return (
    <>
      <Demo title="卡片外的分组标题：17px / 600" bare>
        <Section title="为您推荐">
          <Card>
            <View className="lyx-demo__note">分组里的内容间距 12。</View>
          </Card>
          <Card>
            <View className="lyx-demo__note">第二张卡片。</View>
          </Card>
        </Section>
      </Demo>
      <Demo title="标题右侧：文字链或说明" bare>
        <Section title="待办提醒" extra={<TextButton arrow>查看全部</TextButton>}>
          <Card>
            <View className="lyx-demo__note">右侧是文字链。</View>
          </Card>
        </Section>
        <Section title="处理记录" extra="共 3 条">
          <Card>
            <View className="lyx-demo__note">右侧是 12px 的说明。</View>
          </Card>
        </Section>
      </Demo>
    </>
  );
}
