import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("index.html 里没有 #root");
// 把构建号挂在根节点上，排障时在页面上就能看到是哪一版
container.dataset.build = __LYX_BUILD__;
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
