// 图标：数据取 W0-26 的图标集，不单独装图标库（任务书 第 11 节第 9 项）。线宽照各图标自己的那一档。
import { ICON_VIEW_BOX, ICONS, type IconName } from "@liyoxi/shared/design/icons";
import type { CSSProperties } from "react";

export interface IconProps {
  name: IconName;
  /** 边长，缺省 18（侧栏与按钮里的图标） */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 18, className, style }: IconProps) {
  const icon = ICONS[name];
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={icon.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}
