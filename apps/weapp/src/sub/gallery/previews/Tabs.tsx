import { useState } from "react";

import { Tabs } from "@/components/Tabs";

import { Demo } from "../demo";

const ORDER_TABS = [
  { key: "all", label: "全部" },
  { key: "producing", label: "制作中" },
  { key: "to_launch", label: "待上线", badge: 2 },
  { key: "live", label: "上线中" },
  { key: "ended", label: "已结束" },
] as const;

const PUBLISH_TABS = [
  { key: "todo", label: "待发布", badge: 12 },
  { key: "done", label: "已发布" },
] as const;

export default function TabsPreview() {
  const [order, setOrder] = useState<(typeof ORDER_TABS)[number]["key"]>("producing");
  const [publish, setPublish] = useState<(typeof PUBLISH_TABS)[number]["key"]>("todo");
  return (
    <>
      <Demo title="五项：项高 44，选中 600 加 2px 主色下划线" bare>
        <Tabs items={ORDER_TABS} value={order} onChange={setOrder} />
      </Demo>
      <Demo title="两项，带数字角标" bare>
        <Tabs items={PUBLISH_TABS} value={publish} onChange={setPublish} />
      </Demo>
    </>
  );
}
