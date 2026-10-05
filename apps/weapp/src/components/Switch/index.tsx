import NutSwitch from "@nutui/nutui-react-taro/dist/es/packages/switch";
import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
}

/** 开关：NutUI 的 Switch 套一层，轨道 34 × 20、滑块 16，开主色、关灰（规范 第 4.3 节“表单”）。商家端只用于筛选开关 */
export function Switch({ checked, disabled = false, onChange, className }: SwitchProps) {
  return (
    <View className={cx("lyx-switch", disabled && "lyx-switch--disabled", className)}>
      <NutSwitch checked={checked} disabled={disabled} onChange={(next) => onChange?.(next)} />
    </View>
  );
}
