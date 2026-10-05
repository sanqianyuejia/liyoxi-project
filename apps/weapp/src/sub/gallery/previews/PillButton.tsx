import { PillButton } from "@/components/PillButton";

import { Demo } from "../demo";

export default function PillButtonPreview() {
  return (
    <>
      <Demo title="缺省：高 32，13px" row>
        <PillButton>复制</PillButton>
        <PillButton>切换门店</PillButton>
        <PillButton>查看详情</PillButton>
      </Demo>
      <Demo title="带图标" row>
        <PillButton icon="copy">复制链接</PillButton>
        <PillButton icon="download">保存到相册</PillButton>
      </Demo>
      <Demo title="禁用" row>
        <PillButton disabled>已复制</PillButton>
        <PillButton icon="download" disabled>
          保存到相册
        </PillButton>
      </Demo>
    </>
  );
}
