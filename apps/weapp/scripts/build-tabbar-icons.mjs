#!/usr/bin/env node
// 生成原生标签栏的图标位图（src/assets/tabbar/*.png），产物入库。只在改图标或改颜色时手动跑：
//   node apps/weapp/scripts/build-tabbar-icons.mjs        （本机没装 Playwright 自带的 Chromium 时加 LYX_E2E_CHANNEL=chrome）
// 为什么是位图：微信原生标签栏的 iconPath 只吃位图；Taro 4.2 的 Vite 编译器不产出 custom-tab-bar，
// 自定义标签栏走不通（D7 第 4.1 节）。
// 字形取 W0-26 的图标源（packages/shared/src/design/icons/*.svg），颜色取 design/tokens.json：
// 未选 text-secondary、选中 primary（规范 第 4.2 节）。本脚本里不写色值。81 × 81 是微信推荐的尺寸。
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const outDir = path.resolve(here, "../src/assets/tabbar");
const iconsDir = path.join(repoRoot, "packages/shared/src/design/icons");
const tokens = JSON.parse(readFileSync(path.join(repoRoot, "design/tokens.json"), "utf8"));

/** 标签 → 图标源的文件名（原型 Main 画板底部标签栏的四个图形） */
const ICONS = { home: "home", mall: "play-square", cart: "clipboard-list", mine: "user" };
const valueOf = (token) => (typeof token === "string" ? token : token.$value);
const VARIANTS = [
  { suffix: "", color: valueOf(tokens.shared.color["text-secondary"]) },
  { suffix: "-active", color: valueOf(tokens.shared.color.primary) },
];
const SIZE = 81;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.LYX_E2E_CHANNEL || undefined });
const page = await browser.newPage({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1,
});
for (const [name, source] of Object.entries(ICONS)) {
  const svg = readFileSync(path.join(iconsDir, `${source}.svg`), "utf8");
  for (const { suffix, color } of VARIANTS) {
    await page.setContent(
      `<body style="margin:0;color:${color}"><div style="width:${SIZE}px;height:${SIZE}px">${svg}</div></body>`,
    );
    const file = path.join(outDir, `${name}${suffix}.png`);
    await page.screenshot({ path: file, omitBackground: true });
    console.log(`已生成 ${path.relative(repoRoot, file)}`);
  }
}
await browser.close();
