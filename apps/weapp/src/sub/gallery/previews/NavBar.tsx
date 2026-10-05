import { View } from "@tarojs/components";

import { NavBar } from "@/components/NavBar";

import { Demo } from "../demo";

export default function NavBarPreview() {
  return (
    <>
      <NavBar>狸有戏</NavBar>
      <Demo title="自绘导航：只给首页与登录页用">
        <View className="lyx-demo__note">
          固定在页面顶部，运行时读胶囊位置避让；其余页面用原生导航栏。H5
          截图里取不到胶囊位置，用的是兜底值。
        </View>
      </Demo>
    </>
  );
}
