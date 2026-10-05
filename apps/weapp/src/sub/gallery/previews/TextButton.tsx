import { Card } from "@/components/Card";
import { TextButton } from "@/components/TextButton";

import { Demo } from "../demo";

export default function TextButtonPreview() {
  return (
    <>
      <Demo title="主色与弱化" row>
        <TextButton>全部已读</TextButton>
        <TextButton tone="muted">撤回工单</TextButton>
      </Demo>
      <Demo title="带右箭头：卡片标题右侧的文字链" bare>
        <Card title="积分" extra={<TextButton arrow>积分明细</TextButton>} />
        <Card
          title="最近订单"
          extra={
            <TextButton tone="muted" arrow>
              查看全部
            </TextButton>
          }
        />
      </Demo>
      <Demo title="禁用" row>
        <TextButton disabled>全部已读</TextButton>
        <TextButton disabled arrow>
          积分明细
        </TextButton>
      </Demo>
    </>
  );
}
