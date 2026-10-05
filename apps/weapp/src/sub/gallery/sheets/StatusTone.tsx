import { STATUS_TONE_GROUPS } from "@liyoxi/shared/design/status-tone";
import { View } from "@tarojs/components";

import { merchantStatusByState, StatusTag } from "@/components/StatusTag";

import { Demo } from "../demo";

// 状态取色表（规范 第 6.2 节）的商家端一侧：状态色调字典里每个业务对象一段，列出商家端出现的全部状态。
// 色调与叫法都从字典取（与页面里用的是同一个出口 merchantStatusByState），这里不挑颜色。

/** 商家端出现的状态：业务对象 → [状态名, 色调, 叫法]。字典里商家端不出现的状态不列 */
export function merchantToneRows(): { key: string; object: string; states: string[] }[] {
  return STATUS_TONE_GROUPS.map((group) => ({
    key: group.key,
    object: group.object,
    states: group.entries.filter((entry) => entry.merchant !== null).map((entry) => entry.state),
  })).filter((group) => group.states.length > 0);
}

export default function StatusToneSheet() {
  return (
    <>
      <Demo title="怎么判：橙是轮到商家动手，蓝是进行中或在等对方，绿是完成，红是要补救，灰是已结束">
        <View className="lyx-demo__note">
          下面逐个业务对象列出商家端会出现的状态，顺序同规范 第 6.2
          节的表；后台那一侧在后台的陈列页里。
        </View>
      </Demo>
      {merchantToneRows().map((group) => (
        <Demo key={group.key} title={group.object} row>
          {group.states.map((state) => {
            const status = merchantStatusByState(group.key, state);
            return status ? (
              <StatusTag key={state} tone={status.tone}>
                {status.label}
              </StatusTag>
            ) : null;
          })}
        </Demo>
      ))}
    </>
  );
}
