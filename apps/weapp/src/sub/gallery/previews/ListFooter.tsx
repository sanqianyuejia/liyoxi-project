import { Card } from "@/components/Card";
import { ListFooter } from "@/components/ListFooter";

import { Demo } from "../demo";

export default function ListFooterPreview() {
  return (
    <>
      <Demo title="正在加载下一页" bare>
        <Card variant="item" title="《巷口那家店》" />
        <ListFooter status="loading" />
      </Demo>
      <Demo title="没有更多了" bare>
        <Card variant="item" title="《山那边的信》" />
        <ListFooter status="done" />
      </Demo>
    </>
  );
}
