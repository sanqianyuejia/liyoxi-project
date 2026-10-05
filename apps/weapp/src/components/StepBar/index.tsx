import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface StepBarProps {
  /** 各步的名字，由页面传 */
  steps: readonly string[];
  /** 当前是第几步，从 0 数。它之前的算已完成；等于 steps.length 表示全部完成 */
  current: number;
  className?: string;
}

/** 分段步骤条：等分，每段一条 4px 高的色条加 12px 文字（规范 第 4.3 节“步骤与进度”）。建档的几步用它 */
export function StepBar({ steps, current, className }: StepBarProps) {
  return (
    <View className={cx("lyx-step-bar", className)}>
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";
        return (
          <View key={step} className={cx("lyx-step-bar__item", `lyx-step-bar__item--${state}`)}>
            <View className="lyx-step-bar__bar" />
            <View className="lyx-step-bar__label">{step}</View>
          </View>
        );
      })}
    </View>
  );
}
