import { View } from "@tarojs/components";

import { Card } from "@/components/Card";
import { PageBody } from "@/components/PageBody";
import { Tabs } from "@/components/Tabs";

import { Demo } from "../demo";

import "./PageBody.scss";

export default function PageBodyPreview() {
  return (
    <>
      <Demo title="内容区：左右 16，顶 4、底 20，卡片间距 12" bare>
        <View className="lyx-page-body-demo">
          <PageBody>
            <Card title="第一张卡片" />
            <Card title="第二张卡片" />
          </PageBody>
        </View>
      </Demo>
      <Demo title="上面有副栏时顶边距为 0" bare>
        <View className="lyx-page-body-demo">
          <Tabs
            items={[
              { key: "a", label: "全部" },
              { key: "b", label: "制作中" },
            ]}
            value="a"
          />
          <PageBody flush>
            <View className="lyx-page-body-demo__gap" />
            <Card title="第一张卡片" />
          </PageBody>
        </View>
      </Demo>
    </>
  );
}
