import { Skeleton } from "@/components/Skeleton";

import { Demo } from "../demo";

export default function SkeletonPreview() {
  return (
    <>
      <Demo title="首次加载：色块占住卡片里的标题与文字位置，不转圈" bare>
        <Skeleton />
      </Demo>
      <Demo title="带封面缩略图的列表卡片" bare>
        <Skeleton cards={2} rows={3} media />
      </Demo>
      <Demo title="一张卡片、一行文字" bare>
        <Skeleton cards={1} rows={1} />
      </Demo>
    </>
  );
}
