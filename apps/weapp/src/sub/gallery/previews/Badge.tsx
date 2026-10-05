import { View } from "@tarojs/components";

import { Badge } from "@/components/Badge";
import { List, ListRow } from "@/components/List";

import { Demo } from "../demo";

export default function BadgePreview() {
  return (
    <>
      <Demo title="数字角标：高 18；超过 99 写成 99+；0 不显示" row>
        <Badge count={1} />
        <Badge count={12} />
        <Badge count={99} />
        <Badge count={120} />
        <Badge count={0} />
      </Demo>
      <Demo title="小号：高 16（筛选条内）" row>
        <Badge count={3} size="sm" />
        <Badge count={28} size="sm" />
      </Demo>
      <Demo title="未读红点：10 × 10，白色外环" row>
        <Badge dot />
        <View className="lyx-demo__note">消息、待办</View>
      </Demo>
      <Demo title="在列表行里" bare>
        <List>
          <ListRow icon="bell" title="消息" badge={5} onClick={() => undefined} />
          <ListRow icon="clipboard-list" title="我的订单" onClick={() => undefined} />
        </List>
      </Demo>
    </>
  );
}
