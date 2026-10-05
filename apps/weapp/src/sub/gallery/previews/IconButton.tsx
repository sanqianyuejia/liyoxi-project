import { IconButton } from "@/components/IconButton";

import { Demo } from "../demo";

export default function IconButtonPreview() {
  return (
    <>
      <Demo title="点击区 44 × 44；图标 24 与 22" row>
        <IconButton icon="chevron-left" label="返回" size={24} />
        <IconButton icon="close" label="关闭" />
        <IconButton icon="search" label="搜索" />
        <IconButton icon="share" label="分享" />
      </Demo>
      <Demo title="弱化（弹层关闭）与禁用" row>
        <IconButton icon="close" label="关闭" tone="muted" />
        <IconButton icon="trash" label="删除" disabled />
      </Demo>
    </>
  );
}
