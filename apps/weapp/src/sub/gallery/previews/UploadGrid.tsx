import { useState } from "react";

import { UploadGrid, type UploadItem } from "@/components/UploadGrid";

import { Demo } from "../demo";

import sample from "../assets/sample-cover.png";

const INITIAL: UploadItem[] = [
  { key: "a", src: sample },
  { key: "b", src: sample, status: "uploading", progress: 45 },
  { key: "c", src: sample, status: "failed" },
  { key: "d" },
];

export default function UploadGridPreview() {
  const [items, setItems] = useState(INITIAL);
  return (
    <>
      <Demo title="已传、上传中（进度）、上传失败（重试）、没有缩略图；最后是添加格">
        <UploadGrid
          items={items}
          max={9}
          addText="添加照片"
          onRemove={(key) => setItems((list) => list.filter((item) => item.key !== key))}
          onRetry={(key) =>
            setItems((list) =>
              list.map((item) =>
                item.key === key ? { ...item, status: "uploading", progress: 0 } : item,
              ),
            )
          }
          onAdd={() => setItems((list) => [...list, { key: `n${list.length}`, src: sample }])}
        />
      </Demo>
      <Demo title="空的：只有添加格">
        <UploadGrid items={[]} addText="添加照片" />
      </Demo>
      <Demo title="到上限：不再显示添加格">
        <UploadGrid
          items={[
            { key: "a", src: sample },
            { key: "b", src: sample },
            { key: "c", src: sample },
          ]}
          max={3}
        />
      </Demo>
      <Demo title="禁用（提交中、只读）：不能添加，不能删除">
        <UploadGrid
          items={[
            { key: "a", src: sample },
            { key: "b", src: sample },
          ]}
          disabled
        />
      </Demo>
    </>
  );
}
