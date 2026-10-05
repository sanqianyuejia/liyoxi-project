import { useState } from "react";

import { FilterChips } from "@/components/FilterChips";

import { Demo } from "../demo";

const GENRES = ["全部", "都市温情", "古装", "悬疑", "职场", "乡村", "喜剧", "家庭"].map(
  (label) => ({
    key: label,
    label,
  }),
);

const ASSETS = [
  { key: "all", label: "全部", count: 36 },
  { key: "photo", label: "照片", count: 28 },
  { key: "video", label: "视频", count: 6 },
  { key: "doc", label: "文档", count: 2 },
];

export default function FilterChipsPreview() {
  const [genre, setGenre] = useState("都市温情");
  const [asset, setAsset] = useState("all");
  return (
    <>
      <Demo title="可横向滑动；选中是深色：高 34，14px，间距 8" bare>
        <FilterChips items={GENRES} value={genre} onChange={setGenre} />
      </Demo>
      <Demo title="带数量" bare>
        <FilterChips items={ASSETS} value={asset} onChange={setAsset} />
      </Demo>
    </>
  );
}
