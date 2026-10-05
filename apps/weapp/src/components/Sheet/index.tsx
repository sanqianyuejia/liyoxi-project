import type { ReactNode } from "react";

import NutPopup from "@nutui/nutui-react-taro/dist/es/packages/popup";
import { ScrollView, View } from "@tarojs/components";

import { IconButton } from "@/components/IconButton";
import { cx } from "@/lib/cx";

import "./index.scss";

export interface SheetProps {
  visible: boolean;
  title: ReactNode;
  /** 标题下的说明，13px */
  description?: ReactNode;
  /** 关闭：点右上角、点遮罩都走它 */
  onClose: () => void;
  /** 关闭按钮的无障碍名称 */
  closeLabel?: string;
  /** 点遮罩关不关，缺省关。提交中这类不能半途关掉的传 false */
  closeOnOverlayClick?: boolean;
  /** 弹层底部：一个通栏主按钮，或两个等分的按钮（放弃的在左，主操作在右），高 46 */
  footer?: ReactNode;
  className?: string;
  /** 正文：比弹层高时在内部滚动 */
  children?: ReactNode;
}

/**
 * 底部弹层：NutUI 的 Popup 套一层（规范 第 4.3 节“提示与反馈”）。上两角圆角 16，最高为屏高的 90%。
 * 商家端不设居中确认框：要确认的地方一律用它，危险操作的确认键用危险按钮（规范 第 8 节）。
 */
export function Sheet({
  visible,
  title,
  description,
  onClose,
  closeLabel = "关闭",
  closeOnOverlayClick = true,
  footer,
  className,
  children,
}: SheetProps) {
  return (
    <NutPopup
      visible={visible}
      position="bottom"
      round
      closeable={false}
      closeOnOverlayClick={closeOnOverlayClick}
      className="lyx-sheet-popup"
      overlayClassName="lyx-sheet-overlay"
      onClose={onClose}
    >
      <View className={cx("lyx-sheet", className)}>
        <View className="lyx-sheet__header">
          <View className="lyx-sheet__titles">
            <View className="lyx-sheet__title">{title}</View>
            {description !== undefined ? (
              <View className="lyx-sheet__description">{description}</View>
            ) : null}
          </View>
          <IconButton
            icon="close"
            label={closeLabel}
            tone="muted"
            className="lyx-sheet__close"
            onClick={onClose}
          />
        </View>
        {/* 正文用 scroll-view：NutUI 的弹层为了不让底下的页面跟着滚，拦了自己身上的滑动，普通容器在里面滚不动 */}
        {children !== undefined ? (
          <ScrollView scrollY enhanced showScrollbar={false} className="lyx-sheet__body">
            {children}
          </ScrollView>
        ) : null}
        {footer !== undefined ? <View className="lyx-sheet__footer">{footer}</View> : null}
      </View>
    </NutPopup>
  );
}
