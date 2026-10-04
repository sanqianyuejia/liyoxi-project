import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("下载页空壳", () => {
  it("只有一个占位页；不出现价格、套餐与购买入口", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("狸有戏 · 电脑端下载");
    expect(html).toContain("页面建设中");
    expect(html).not.toMatch(/¥|套餐|购买|支付|充值/);
  });
});
