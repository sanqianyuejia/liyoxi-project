import { StepBar } from "@/components/StepBar";

import { Demo } from "../demo";

const STEPS = ["基础信息", "门店环境", "主推服务", "证照"];

export default function StepBarPreview() {
  return (
    <>
      <Demo title="第一步">
        <StepBar steps={STEPS} current={0} />
      </Demo>
      <Demo title="第三步：前面的已完成，当前的文字是主色 600">
        <StepBar steps={STEPS} current={2} />
      </Demo>
      <Demo title="全部完成">
        <StepBar steps={STEPS} current={STEPS.length} />
      </Demo>
      <Demo title="三步">
        <StepBar steps={["选择套餐", "支付", "开通"]} current={1} />
      </Demo>
    </>
  );
}
