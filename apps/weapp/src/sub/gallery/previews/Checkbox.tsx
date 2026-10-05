import { useState } from "react";

import { Checkbox } from "@/components/Checkbox";

import { Demo } from "../demo";

export default function CheckboxPreview() {
  const [agreed, setAgreed] = useState(true);
  const [all, setAll] = useState(false);
  const [pay, setPay] = useState<"points" | "transfer">("points");
  return (
    <>
      <Demo title="复选框：18 × 18，圆角 4；整行可点">
        <Checkbox checked={agreed} onChange={setAgreed}>
          我已查看样片
        </Checkbox>
        <Checkbox checked={all} onChange={setAll}>
          全选
        </Checkbox>
      </Demo>
      <Demo title="单选框：圆形">
        <Checkbox shape="round" checked={pay === "points"} onChange={() => setPay("points")}>
          积分支付
        </Checkbox>
        <Checkbox shape="round" checked={pay === "transfer"} onChange={() => setPay("transfer")}>
          对公转账
        </Checkbox>
      </Demo>
      <Demo title="禁用">
        <Checkbox checked disabled>
          已包含在套餐内
        </Checkbox>
        <Checkbox checked={false} disabled>
          剧已下架，不能选择
        </Checkbox>
      </Demo>
    </>
  );
}
