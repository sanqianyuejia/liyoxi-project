import { View } from "@tarojs/components";

import { Button } from "@/components/Button";
import { FooterBar } from "@/components/FooterBar";

import { Demo } from "../demo";

import "./FooterBar.scss";

export default function FooterBarPreview() {
  return (
    <>
      <Demo title="一个按钮：白底，顶边 1px，内容高 64" bare>
        <FooterBar fixed={false}>
          <Button>提交审核</Button>
        </FooterBar>
      </Demo>
      <Demo title="两个按钮等分，间距 12" bare>
        <FooterBar fixed={false}>
          <Button variant="secondary">提出修改意见</Button>
          <Button>确认方案</Button>
        </FooterBar>
      </Demo>
      <Demo title="金额加一个按钮（自己排，不等分）" bare>
        <FooterBar fixed={false} equal={false}>
          <View className="lyx-footer-demo__total">
            <View className="lyx-footer-demo__label">合计</View>
            <View className="lyx-footer-demo__amount">180 积分</View>
          </View>
          <Button>确认订购</Button>
        </FooterBar>
      </Demo>
      <Demo title="说明">
        <View className="lyx-demo__note">
          这里为了能排在一页里，用的是不固定的写法。页面里缺省固定在底部，下内边距为 8px
          加底部安全区，并自带一块等高的空白垫在内容区底部；这一页最下面那条就是固定的。
        </View>
      </Demo>
      <FooterBar>
        <Button variant="secondary">取消</Button>
        <Button>保存</Button>
      </FooterBar>
    </>
  );
}
