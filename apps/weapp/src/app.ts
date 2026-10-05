import type { PropsWithChildren } from "react";

import { useLaunch } from "@tarojs/taro";

import { startApp } from "@/lib/runtime";

import "@/styles/nutui";
import "./app.scss";

function App({ children }: PropsWithChildren) {
  useLaunch((options) => {
    // 装配请求层与四个端上封装；服务端接口没接上时全部空转，不阻塞进入首页
    startApp(options);
  });
  return children;
}

export default App;
