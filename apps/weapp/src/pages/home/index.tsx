import { View } from "@tarojs/components";

import { NavBar } from "@/components/NavBar";

import "@/styles/placeholder.scss";

// 占位页：首页 随 W1-18 交付
export default function Page() {
  return (
    <View className="lyx-placeholder-page">
      <NavBar>狸有戏</NavBar>
      <View className="lyx-placeholder-page__card">
        <View className="lyx-placeholder-page__title">首页</View>
        <View className="lyx-placeholder-page__note">页面建设中</View>
      </View>
    </View>
  );
}
