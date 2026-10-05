import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";
import { clampPercent } from "@/lib/percent";

import "./index.scss";

export interface ProgressBarProps {
  /** 0–100，由服务端给或按已传字节算；超出的截到两头 */
  percent: number;
  className?: string;
}

/** 线性进度条：高 4，轨道灰、填充主色，到 100% 时填充改为成功绿（规范 第 4.3 节“步骤与进度”） */
export function ProgressBar({ percent, className }: ProgressBarProps) {
  const value = clampPercent(percent);
  return (
    <View className={cx("lyx-progress-bar", value >= 100 && "lyx-progress-bar--done", className)}>
      {/* 宽度是数据，只能写行内；它是百分比，不涉及单位转换 */}
      <View className="lyx-progress-bar__fill" style={{ width: `${value}%` }} />
    </View>
  );
}
