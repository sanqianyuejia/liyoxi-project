import { InfoTag } from "@/components/InfoTag";
import { StatusTag } from "@/components/StatusTag";

import { Demo } from "../demo";

export default function InfoTagPreview() {
  return (
    <>
      <Demo title="属性：行业、城市、规格" row>
        <InfoTag>餐饮 / 火锅</InfoTag>
        <InfoTag>成都</InfoTag>
        <InfoTag>整部 80 集</InfoTag>
      </Demo>
      <Demo title="与状态标签并排：形状相同，字重与字色不同" row>
        <InfoTag>都市温情</InfoTag>
        <StatusTag tone="neutral">已结束</StatusTag>
        <StatusTag tone="success">已认证</StatusTag>
      </Demo>
    </>
  );
}
