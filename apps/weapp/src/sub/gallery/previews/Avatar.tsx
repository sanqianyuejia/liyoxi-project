import { Avatar } from "@/components/Avatar";
import { List, ListRow } from "@/components/List";

import { Demo } from "../demo";

export default function AvatarPreview() {
  return (
    <>
      <Demo title="门店：圆角方形 56、44、40" row>
        <Avatar text="云间火锅" size={56} />
        <Avatar text="云间火锅" size={44} />
        <Avatar text="云间火锅" size={40} />
      </Demo>
      <Demo title="主色底、白字" row>
        <Avatar text="巷口那家店" size={56} tone="solid" />
        <Avatar text="巷口那家店" size={44} tone="solid" />
      </Demo>
      <Demo title="人物：圆形 40、36、32" row>
        <Avatar text="王**" shape="round" size={40} />
        <Avatar text="李**" shape="round" size={36} />
        <Avatar text="客服" shape="round" size={32} tone="solid" />
      </Demo>
      <Demo title="在双行行里" bare>
        <List>
          <ListRow
            media={<Avatar text="云间火锅" size={40} />}
            title="云间火锅（春熙路店）"
            description="成都 · 餐饮 / 火锅"
            onClick={() => undefined}
          />
          <ListRow
            media={<Avatar text="王**" shape="round" size={40} />}
            title="王**"
            description="店员 · 138****5678"
          />
        </List>
      </Demo>
    </>
  );
}
