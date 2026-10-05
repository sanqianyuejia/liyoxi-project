import { View } from "@tarojs/components";
import { useState } from "react";

import { List, ListRow } from "@/components/List";
import { Switch } from "@/components/Switch";

import { Demo } from "../demo";

export default function SwitchPreview() {
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  return (
    <>
      <Demo title="开与关：轨道 34 × 20，滑块 16" row>
        <Switch checked={on} onChange={setOn} />
        <Switch checked={off} onChange={setOff} />
      </Demo>
      <Demo title="禁用" row>
        <Switch checked disabled />
        <Switch checked={false} disabled />
      </Demo>
      <Demo title="在筛选行里" bare>
        <List>
          <ListRow title="只看可订购" value={<Switch checked={on} onChange={setOn} />} />
        </List>
      </Demo>
      <Demo title="说明">
        <View className="lyx-demo__note">
          商家端的开关只用于筛选，用主色；后台的开关表示启用，用成功绿。
        </View>
      </Demo>
    </>
  );
}
