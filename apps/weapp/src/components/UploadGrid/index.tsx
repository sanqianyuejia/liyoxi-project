import type { ReactNode } from "react";

import { Image, View } from "@tarojs/components";

import { Icon } from "@/components/Icon";
import { cx } from "@/lib/cx";
import { clampPercent } from "@/lib/percent";

import "./index.scss";

export interface UploadItem {
  key: string;
  /** 缩略图地址（本地临时路径或已上传的地址）；没有时显示一个图片图标 */
  src?: string;
  /** done 已传（缺省）；uploading 上传中；failed 上传失败 */
  status?: "done" | "uploading" | "failed";
  /** 上传中的进度，0–100 */
  progress?: number;
}

export interface UploadGridProps {
  items: readonly UploadItem[];
  /** 最多几个：到了就不再显示添加格 */
  max?: number;
  /** 添加格里的文字，由页面传（“添加照片”） */
  addText?: ReactNode;
  /** 不能再添加、不能删除（提交中、只读） */
  disabled?: boolean;
  failedText?: string;
  retryText?: string;
  /** 删除按钮的无障碍名称 */
  removeLabel?: string;
  /** 点添加格：选取与上传由页面接（微信的媒体选择接口，经 withPrivacy） */
  onAdd?: () => void;
  /** 点右上角的删除钮。删除刚上传的照片不需要确认（规范 第 8 节） */
  onRemove?: (key: string) => void;
  /** 点失败格里的“重试” */
  onRetry?: (key: string) => void;
  /** 点已传的格子（预览大图） */
  onPreview?: (key: string) => void;
  className?: string;
}

/**
 * 上传网格：三列，间距 8，格子为正方形、圆角 10（规范 第 4.3 节“上传、播放与其他”）。
 * 上传中的格子盖一层半透明深色与进度百分比；失败的盖深色层，显示“上传失败”与“重试”（规范 第 12 节）。
 * 只管显示与回调，不含选取与上传的逻辑。
 */
export function UploadGrid({
  items,
  max,
  addText,
  disabled = false,
  failedText = "上传失败",
  retryText = "重试",
  removeLabel = "删除",
  onAdd,
  onRemove,
  onRetry,
  onPreview,
  className,
}: UploadGridProps) {
  const canAdd = !disabled && (max === undefined || items.length < max);
  return (
    <View className={cx("lyx-upload-grid", className)}>
      {items.map((item) => {
        const status = item.status ?? "done";
        return (
          <View key={item.key} className="lyx-upload-grid__cell">
            <View
              className="lyx-upload-grid__inner"
              onClick={status === "done" ? () => onPreview?.(item.key) : undefined}
            >
              {item.src ? (
                <Image className="lyx-upload-grid__image" src={item.src} mode="aspectFill" />
              ) : (
                <View className="lyx-upload-grid__blank">
                  <Icon name="image" size={24} />
                </View>
              )}
              {status === "uploading" ? (
                <View className="lyx-upload-grid__overlay">
                  <View className="lyx-upload-grid__percent">{clampPercent(item.progress)}%</View>
                </View>
              ) : null}
              {status === "failed" ? (
                <View className="lyx-upload-grid__overlay">
                  <View className="lyx-upload-grid__failed">{failedText}</View>
                  <View
                    className="lyx-upload-grid__retry"
                    hoverClass="lyx-upload-grid__retry--pressed"
                    ariaRole="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRetry?.(item.key);
                    }}
                  >
                    {retryText}
                  </View>
                </View>
              ) : null}
            </View>
            {disabled ? null : (
              <View
                className="lyx-upload-grid__remove"
                hoverClass="lyx-upload-grid__remove--pressed"
                ariaRole="button"
                ariaLabel={removeLabel}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove?.(item.key);
                }}
              >
                <View className="lyx-upload-grid__remove-dot">
                  <Icon name="close" size={16} />
                </View>
              </View>
            )}
          </View>
        );
      })}
      {canAdd ? (
        <View className="lyx-upload-grid__cell">
          <View
            className="lyx-upload-grid__inner lyx-upload-grid__add"
            hoverClass="lyx-upload-grid__add--pressed"
            ariaRole="button"
            onClick={onAdd}
          >
            <Icon name="plus" size={20} />
            {addText !== undefined ? (
              <View className="lyx-upload-grid__add-text">{addText}</View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
