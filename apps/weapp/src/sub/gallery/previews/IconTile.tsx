import { Card } from "@/components/Card";
import { IconTile } from "@/components/IconTile";
import { List, ListRow } from "@/components/List";

import { Demo } from "../demo";

export default function IconTilePreview() {
  return (
    <>
      <Demo title="四档：44、40、36、32（主色款）" row>
        <IconTile icon="drama" size={44} />
        <IconTile icon="megaphone" size={40} />
        <IconTile icon="image" size={36} />
        <IconTile icon="headset" size={32} />
      </Demo>
      <Demo title="中性款" row>
        <IconTile icon="file-text" size={44} tone="neutral" />
        <IconTile icon="folder" size={40} tone="neutral" />
        <IconTile icon="music" size={36} tone="neutral" />
        <IconTile icon="link" size={32} tone="neutral" />
      </Demo>
      <Demo title="在双行行里（入口卡行）" bare>
        <List>
          <ListRow
            media={<IconTile icon="store" />}
            title="完善门店档案"
            description="补充门店环境与主推服务"
            onClick={() => undefined}
          />
        </List>
        <Card variant="subtle">
          <ListRow
            media={<IconTile icon="file-text" tone="neutral" />}
            title="营业执照.pdf"
            description="1.2 MB"
          />
        </Card>
      </Demo>
    </>
  );
}
