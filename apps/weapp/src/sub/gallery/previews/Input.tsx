import { useState } from "react";

import { Input } from "@/components/Input";
import { PillButton } from "@/components/PillButton";

import { Demo } from "../demo";

export default function InputPreview() {
  const [value, setValue] = useState("云间火锅（春熙路店）");
  return (
    <>
      <Demo title="缺省：高 44，圆角 10；占位符用辅助色">
        <Input placeholder="请填写门店名称" />
        <Input value={value} onChange={setValue} />
      </Demo>
      <Demo title="出错：描边变红">
        <Input value="1380013" error />
      </Demo>
      <Demo title="禁用">
        <Input value="成都云间餐饮管理有限公司" disabled />
      </Demo>
      <Demo title="右侧带单位或按钮">
        <Input type="digit" placeholder="请填写人均消费" suffix="元" />
        <Input
          type="number"
          placeholder="请填写验证码"
          suffix={<PillButton>获取验证码</PillButton>}
        />
      </Demo>
    </>
  );
}
