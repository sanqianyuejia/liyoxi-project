import { Card } from "@/components/Card";
import { Empty } from "@/components/Empty";

import { Demo } from "../demo";

export default function EmptyPreview() {
  return (
    <>
      <Demo title="只有标题：上下留白 72、左右 24，不放插图" bare>
        <Empty title="暂无相关订单" />
      </Demo>
      <Demo title="带说明与动作（中档的次按钮，主色）" bare>
        <Empty
          title="选剧单是空的"
          description="去短剧商城挑几部适合门店的短剧"
          actionText="去选剧"
          onAction={() => undefined}
        />
      </Demo>
      <Demo title="筛选无结果；放在卡片里" bare>
        <Card>
          <Empty title="没有符合条件的短剧" description="换一个题材或关键词试试" />
        </Card>
      </Demo>
    </>
  );
}
