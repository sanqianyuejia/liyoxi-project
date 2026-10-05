import { useState } from "react";

import { SearchBar } from "@/components/SearchBar";

import { Demo } from "../demo";

export default function SearchBarPreview() {
  const [value, setValue] = useState("");
  return (
    <>
      <Demo title="缺省：高 40，胶囊形" bare>
        <SearchBar value={value} placeholder="搜索剧名、题材" onChange={setValue} />
      </Demo>
      <Demo title="输入中：描边变主色" bare>
        <SearchBar value="巷口" className="lyx-search-bar--focused" />
      </Demo>
      <Demo title="只作入口：点了去搜索页" bare>
        <SearchBar entry placeholder="搜索剧名、题材" onClick={() => undefined} />
      </Demo>
    </>
  );
}
