import { Note } from "@/components/Note";

import { Demo } from "../demo";

export default function NotePreview() {
  return (
    <>
      <Demo title="中性款（缺省）：浅底、次级正文色" bare>
        <Note>平台整理好后会通知您，一般需要 1 个工作日。</Note>
      </Demo>
      <Demo title="四种色调：圆角 10，13px，行高 1.5；无图标、无关闭" bare>
        <Note tone="warning">样片已交付，请在 10 月 12 日 24:00 前确认。</Note>
        <Note tone="info">第 2 版制作中，完成后会通知您。</Note>
        <Note tone="success">资质已通过审核，可以订购短剧了。</Note>
        <Note tone="danger">证照模糊，无法识别。请重新拍摄后上传。</Note>
      </Demo>
      <Demo title="多行" bare>
        <Note tone="warning">
          请至少保留一家门店；如不再合作，请移除成员。移除后该成员不能再查看本店的订单与素材。
        </Note>
      </Demo>
    </>
  );
}
