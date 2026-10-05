import { useState } from "react";

import { LoadError } from "@/components/LoadError";
import { toast } from "@/lib/toast";

import { Demo } from "../demo";

export default function LoadErrorPreview() {
  const [retrying, setRetrying] = useState(false);
  return (
    <>
      <Demo title="加载失败：一行说明加“重新加载”，样式同空状态" bare>
        <LoadError
          message="加载失败，请稍后重试"
          retrying={retrying}
          onRetry={() => {
            setRetrying(true);
            // 示意：点了以后按钮进入提交中，并弹一条无网络的轻提示（规范 第 8、12 节）
            toast("网络不可用，请检查后重试");
          }}
        />
      </Demo>
      <Demo title="正在重新加载：按钮显示加载图标，不可重复点" bare>
        <LoadError message="加载失败，请稍后重试" retrying />
      </Demo>
    </>
  );
}
