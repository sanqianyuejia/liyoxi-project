import { useState } from "react";

import { TextArea } from "@/components/TextArea";

import { Demo } from "../demo";

export default function TextAreaPreview() {
  const [value, setValue] = useState("价格再放大一些，门头的招牌拍清楚。");
  return (
    <>
      <Demo title="缺省：14px，行高 1.5，右下角计数">
        <TextArea placeholder="如：价格再放大一些" maxLength={200} />
        <TextArea value={value} maxLength={200} onChange={setValue} />
      </Demo>
      <Demo title="不设上限时不显示计数">
        <TextArea placeholder="请填写修改意见" />
      </Demo>
      <Demo title="出错与禁用">
        <TextArea placeholder="请填写修改意见" maxLength={200} error />
        <TextArea defaultValue="第 2 版制作中，暂不能修改。" disabled />
      </Demo>
    </>
  );
}
