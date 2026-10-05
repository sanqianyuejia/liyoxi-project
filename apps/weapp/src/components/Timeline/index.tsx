import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { Icon } from "@/components/Icon";
import type { StatusTone } from "@/components/StatusTag";
import { cx } from "@/lib/cx";

import "./index.scss";

export interface TimelineItem {
  /** 列表的键；不给就用序号 */
  key?: string;
  title: ReactNode;
  description?: ReactNode;
  /** 时间，写在标题右侧（“09-28 10:12”） */
  time?: string;
  /** 进度时间轴用：done 已完成、current 当前、todo 未到。不给按 todo */
  state?: "done" | "current" | "todo";
}

export interface TimelineProps {
  items: readonly TimelineItem[];
  /**
   * progress 进度时间轴：节点 20 的圆环，完成是对勾、当前是内点、未到是空环（不单靠颜色区分）。
   * record 记录时间轴：10 的圆点，第一条是最新的，按状态取色，其余是历史记录。
   */
  variant?: "progress" | "record";
  /** 记录时间轴里最新一条的色调，缺省 info */
  latestTone?: StatusTone;
  className?: string;
}

/** 时间轴（规范 第 4.3 节“步骤与进度”）：审核进度、订单进度用 progress；上线记录、处理记录用 record */
export function Timeline({
  items,
  variant = "progress",
  latestTone = "info",
  className,
}: TimelineProps) {
  return (
    <View className={cx("lyx-timeline", `lyx-timeline--${variant}`, className)}>
      {items.map((item, index) => {
        const state = item.state ?? "todo";
        const modifier =
          variant === "progress"
            ? `lyx-timeline__item--${state}`
            : index === 0
              ? `lyx-timeline__item--latest lyx-timeline__item--${latestTone}`
              : "lyx-timeline__item--history";
        return (
          <View key={item.key ?? index} className={cx("lyx-timeline__item", modifier)}>
            <View className="lyx-timeline__rail">
              <View className="lyx-timeline__node">
                {variant === "progress" && state === "done" ? (
                  <Icon name="check" size={14} />
                ) : null}
              </View>
              <View className="lyx-timeline__line" />
            </View>
            <View className="lyx-timeline__content">
              <View className="lyx-timeline__head">
                <View className="lyx-timeline__title">{item.title}</View>
                {item.time ? <View className="lyx-timeline__time">{item.time}</View> : null}
              </View>
              {item.description !== undefined ? (
                <View className="lyx-timeline__description">{item.description}</View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
