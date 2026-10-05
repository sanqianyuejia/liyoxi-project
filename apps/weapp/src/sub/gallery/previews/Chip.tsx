import { View } from "@tarojs/components";
import { useState } from "react";

import { Chip } from "@/components/Chip";

import { Demo } from "../demo";

import "./form.scss";

const DURATIONS = ["15 秒", "30 秒", "60 秒"];

export default function ChipPreview() {
  const [duration, setDuration] = useState("30 秒");
  return (
    <>
      <Demo title="未选、选中（橙色）、不可选：高 34，13px">
        <View className="lyx-form-demo__chips">
          <Chip>新品上市</Chip>
          <Chip selected>节日促销</Chip>
          <Chip disabled>门店环境</Chip>
        </View>
      </Demo>
      <Demo title="大号：高 40，14px（弹层里）">
        <View className="lyx-form-demo__chips">
          {DURATIONS.map((item) => (
            <Chip
              key={item}
              size="lg"
              selected={item === duration}
              onClick={() => setDuration(item)}
            >
              {item}
            </Chip>
          ))}
          <Chip size="lg" disabled>
            120 秒
          </Chip>
        </View>
      </Demo>
      <Demo title="说明">
        <View className="lyx-demo__note">
          表单里取值用它（橙色选中）；列表上方的筛选用筛选胶囊（深色选中）。
        </View>
      </Demo>
    </>
  );
}
