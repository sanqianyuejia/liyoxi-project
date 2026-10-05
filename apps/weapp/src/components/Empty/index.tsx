import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { Button } from "@/components/Button";
import { cx } from "@/lib/cx";

import "./index.scss";

export interface EmptyProps {
  /** 没有数据写“暂无……”，筛选无结果写“没有符合条件的……”（规范 第 7 节） */
  title: ReactNode;
  description?: ReactNode;
  /** 动作按钮的文字（“去选剧”“查看订单”）。给了才显示按钮：中档的次按钮（主色） */
  actionText?: string;
  onAction?: () => void;
  /** 动作进行中 */
  actionLoading?: boolean;
  className?: string;
}

/** 空状态：居中，上下留白 72、左右 24，不放插图（规范 第 4.3 节“提示与反馈”） */
export function Empty({
  title,
  description,
  actionText,
  onAction,
  actionLoading = false,
  className,
}: EmptyProps) {
  return (
    <View className={cx("lyx-empty", className)}>
      <View className="lyx-empty__title">{title}</View>
      {description !== undefined ? (
        <View className="lyx-empty__description">{description}</View>
      ) : null}
      {actionText ? (
        <View className="lyx-empty__action">
          <Button variant="outline" size="md" loading={actionLoading} onClick={onAction}>
            {actionText}
          </Button>
        </View>
      ) : null}
    </View>
  );
}
