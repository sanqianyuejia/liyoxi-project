import { List, ListRow } from "@/components/List";
import { StatusTag } from "@/components/StatusTag";

import { Demo } from "../demo";

const noop = () => undefined;

export default function ListPreview() {
  return (
    <>
      <Demo title="菜单行：最小高 52，行首图标 22，右值 13px，右箭头 16" bare>
        <List>
          <ListRow icon="clipboard-list" title="我的订单" onClick={noop} />
          <ListRow icon="points" title="积分" value="2,160 积分" onClick={noop} />
          <ListRow icon="bell" title="消息" badge={3} onClick={noop} />
          <ListRow icon="headset" title="联系客服" onClick={noop} />
        </List>
      </Demo>
      <Demo title="双行行：最小高 64，标题 15px / 600，副文 12px" bare>
        <List>
          <ListRow
            title="云间火锅（春熙路店）"
            description="成都 · 餐饮 / 火锅"
            value={<StatusTag tone="success">已认证</StatusTag>}
            onClick={noop}
          />
          <ListRow title="王**" description="店员 · 138****5678" value="已加入" />
        </List>
      </Demo>
      <Demo title="不可点（无箭头）与禁用" bare>
        <List>
          <ListRow icon="smartphone" title="登录手机号" value="138****5678" />
          <ListRow icon="tv" title="电脑端上传" value="即将开放" disabled onClick={noop} />
        </List>
      </Demo>
    </>
  );
}
