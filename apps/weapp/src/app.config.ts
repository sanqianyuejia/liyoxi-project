// 全局配置。页面、分包、预下载由页面清单（src/pages.ts）拼出，这里不手写路由。
// 颜色只能写十六进制字符串的地方，从设计变量取（页面不写色值，CLAUDE.md 硬性规则 24）。
import { sharedTokens } from "@liyoxi/shared/design/tokens";

import { buildRoutes } from "./pages";

const { pages, subPackages, preloadRule } = buildRoutes();
const color = sharedTokens.color;

export default defineAppConfig({
  pages,
  ...(subPackages.length > 0 ? { subPackages } : {}),
  ...(Object.keys(preloadRule).length > 0 ? { preloadRule } : {}),
  lazyCodeLoading: "requiredComponents",
  // 小程序默认都是 60 秒；取值照 D7 第 4.4 节（约定 C19），单次调用再按文件大小传 timeout
  networkTimeout: { request: 30_000, uploadFile: 300_000, downloadFile: 600_000 },
  window: {
    backgroundTextStyle: "dark",
    backgroundColor: color["bg-page"],
    navigationBarBackgroundColor: color["bg-page"],
    navigationBarTitleText: "狸有戏",
    navigationBarTextStyle: "black",
  },
  // 原生标签栏（规范 第 4.2 节；第 14 节第 3 项）。图标由 scripts/build-tabbar-icons.mjs 从图标源导出
  tabBar: {
    color: color["text-secondary"],
    selectedColor: color["primary-text"],
    backgroundColor: color["bg-card"],
    borderStyle: "white",
    list: [
      {
        pagePath: "pages/home/index",
        text: "首页",
        iconPath: "assets/tabbar/home.png",
        selectedIconPath: "assets/tabbar/home-active.png",
      },
      {
        pagePath: "pages/mall/index",
        text: "短剧商城",
        iconPath: "assets/tabbar/mall.png",
        selectedIconPath: "assets/tabbar/mall-active.png",
      },
      {
        pagePath: "pages/cart/index",
        text: "选剧单",
        iconPath: "assets/tabbar/cart.png",
        selectedIconPath: "assets/tabbar/cart-active.png",
      },
      {
        pagePath: "pages/mine/index",
        text: "我的",
        iconPath: "assets/tabbar/mine.png",
        selectedIconPath: "assets/tabbar/mine-active.png",
      },
    ],
  },
  // 隐私总开关：调隐私接口前走 ensurePrivacyAuthorized()（D7 第 4.14 节）
  __usePrivacyCheck__: true,
});
