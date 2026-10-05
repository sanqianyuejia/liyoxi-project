import { useState } from "react";

import { Segmented } from "@/components/Segmented";

import { Demo } from "../demo";

const TWO = [
  { key: "month", label: "按月" },
  { key: "year", label: "按年" },
] as const;

const THREE = [
  { key: "all", label: "全部" },
  { key: "income", label: "获得" },
  { key: "expense", label: "消耗" },
] as const;

export default function SegmentedPreview() {
  const [two, setTwo] = useState<(typeof TWO)[number]["key"]>("month");
  const [three, setThree] = useState<(typeof THREE)[number]["key"]>("income");
  return (
    <>
      <Demo title="两项：轨道高 40，内边距 3；选中白底 600" bare>
        <Segmented items={TWO} value={two} onChange={setTwo} />
      </Demo>
      <Demo title="三项" bare>
        <Segmented items={THREE} value={three} onChange={setThree} />
      </Demo>
    </>
  );
}
