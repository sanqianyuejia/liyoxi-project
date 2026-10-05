// 业务状态 → 商家端的色调与叫法。对应关系只有一份，在 @liyoxi/shared 的状态色调字典里（规范 第 6.2 节）；
// 这里只取商家端那一侧，页面不自己判断颜色。本文件不引小程序运行时，用例在 Node 里跑。
import {
  statusToneByEnum,
  statusToneByState,
  type StatusToneEntry,
  type Tone,
} from "@liyoxi/shared/design/status-tone";

/** 商家端的五种色调，与类名修饰符、样式变量同名。紫色只在后台用 */
export type StatusTone = Exclude<Tone, "purple">;

export interface MerchantStatus {
  tone: StatusTone;
  /** 商家端的叫法（两端对同一状态的叫法可以不同，规范 第 6.3 节） */
  label: string;
}

function merchantSide(entry: StatusToneEntry | undefined): MerchantStatus | null {
  const side = entry?.merchant;
  if (!side) return null;
  // 字典里商家端没有紫色；万一写了，按中性灰显示，不让页面出现没有定义的颜色
  return { tone: side.tone === "purple" ? "neutral" : side.tone, label: side.label };
}

/** 按库里的“表.列”与取值找。字典里没有、或商家端不出现这个状态时是 null：页面按规范 第 6.1 节的方法另定 */
export function merchantStatusByEnum(column: string, value: string): MerchantStatus | null {
  return merchantSide(statusToneByEnum(column, value));
}

/** 按业务对象的分组键与状态名找：没有枚举对应的展示状态用这个 */
export function merchantStatusByState(groupKey: string, state: string): MerchantStatus | null {
  return merchantSide(statusToneByState(groupKey, state));
}
