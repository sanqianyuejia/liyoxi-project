import Taro from "@tarojs/taro";

/** 自绘导航栏要的几个数，都是设备像素，用行内样式写，不走单位转换（规范 第 4.1 节） */
export interface NavMetrics {
  /** 页头内容距页面顶端的距离 = 胶囊按钮上沿 */
  top: number;
  /** 页头行高 = 胶囊按钮高度，自绘标题与胶囊同轴 */
  height: number;
  /** 页头内容右侧要让出的宽度 = 胶囊左沿到屏幕右沿，再加 8（规范 第 4.2 节：胶囊左侧留 8px 以上） */
  right: number;
}

/** 胶囊取不到时的兜底（H5、老基础库），保证页头不贴顶、不压胶囊 */
const FALLBACK: NavMetrics = { top: 48, height: 32, right: 16 };
const CAPSULE_GAP = 8;

let cached: NavMetrics | null = null;

/** 自绘导航的页面用它对齐微信胶囊。一次会话内设备不变，量一次即可 */
export function getNavMetrics(): NavMetrics {
  if (cached) return cached;
  cached = measure();
  return cached;
}

function measure(): NavMetrics {
  try {
    const rect = Taro.getMenuButtonBoundingClientRect();
    if (rect && rect.height > 0) {
      const windowWidth = Taro.getWindowInfo().windowWidth;
      return {
        top: rect.top,
        height: rect.height,
        right: Math.max(windowWidth - rect.left, 0) + CAPSULE_GAP,
      };
    }
  } catch {
    // 落到下面按状态栏推算
  }
  try {
    const statusBarHeight = Taro.getWindowInfo().statusBarHeight ?? 0;
    if (statusBarHeight > 0) return { ...FALLBACK, top: statusBarHeight + 6 };
  } catch {
    // 落到兜底值
  }
  return FALLBACK;
}
