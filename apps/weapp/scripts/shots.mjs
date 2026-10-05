#!/usr/bin/env node
// 小程序页面截图。根脚本是 pnpm weapp:shots（= pnpm --filter @liyoxi/weapp shots）。
//
// 用法：pnpm weapp:shots [-- --page <路由> …] [--no-build]
//   不带参数      页面清单（src/pages.ts）里已建的页各出一张
//   --page <路由> 只出这一页，可给多次。路由照页面清单的写法，如 pages/home/index
//   --no-build    不重新构建，直接用上一次的 H5 产物
// 做法（任务书 W0-27a 第 11 节第 1 项）：先出一份 Taro 的 H5 构建（shots/dist/h5/），本机起一个只服务这个目录的
// 静态服务，用 Playwright 的 Chromium 按 375 × 812、1 倍像素打开每一页截图。产物在 shots/dist/png/，
// 文件名是路由把 / 换成 __，宽 375；不入库，CI 把这个目录作为产物 weapp-shots 上传。
// 浏览器：缺省用 Playwright 自带的 Chromium（CI 里先 playwright install）；本机可用 LYX_E2E_CHANNEL=chrome。
// 与真机的差异（PR 描述里要写）：H5 是近似，不是小程序渲染层。原生导航栏在 H5 下不出现（没有标题栏与胶囊），
// 标签栏是 Taro 的 H5 仿制件，高度与字体都与微信不同；自绘导航取不到胶囊位置，用的是兜底值；页面底色没有铺满，
// 内容区是白的；尺寸在 375 宽下恰好是原型的 px。真机上的样子以开发者工具与手机为准（E16、E7）。
// 退出码：0 全部出图；1 有页面没出来（路由不在已建的页里、页面报错、截不到）；2 用法或环境错误。
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const h5Dir = path.join(appRoot, "shots/dist/h5");
const outDir = path.join(appRoot, "shots/dist/png");
const VIEWPORT = { width: 375, height: 812 };
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function fail(message, code = 2) {
  console.error(`小程序截图：${message}`);
  process.exit(code);
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const wanted = [];
let build = true;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--no-build") build = false;
  else if (args[index] === "--page") {
    const route = args[(index += 1)];
    if (!route) fail("--page 后面要跟一个路由，如 pages/home/index");
    wanted.push(route.replace(/^\//, ""));
  } else fail(`不认识的参数 ${args[index]}`);
}

// 页面清单是 TypeScript，用 Node 自带的类型擦除直接读（文件里不得有要运行的 import）
const { WEAPP_PAGES, isBuilt } = await import(
  pathToFileURL(path.join(appRoot, "src/pages.ts")).href
);
const builtRoutes = WEAPP_PAGES.filter(isBuilt).map((item) => item.route);
const unknown = wanted.filter((route) => !builtRoutes.includes(route));
if (unknown.length > 0) {
  fail(`这些路由不在已建的页里：${unknown.join("、")}。已建的页：${builtRoutes.join("、")}`, 1);
}
const routes = wanted.length > 0 ? wanted : builtRoutes;

if (build) {
  const result = spawnSync(process.execPath, [path.join(appRoot, "scripts/build.mjs"), "h5"], {
    cwd: appRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) fail("H5 构建没过，出不了图", result.status ?? 1);
}
if (!existsSync(path.join(h5Dir, "index.html"))) fail("没有 H5 产物：去掉 --no-build 再跑");

/** 只服务 H5 产物目录的静态服务：只听本机，路径越出目录即 404 */
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const file = path.join(h5Dir, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(h5Dir + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ channel: process.env.LYX_E2E_CHANNEL || undefined });
} catch (error) {
  server.close();
  fail(`浏览器起不来（本机可加 LYX_E2E_CHANNEL=chrome）。${String(error.message).split("\n")[0]}`);
}
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
});
const failed = [];
for (const route of routes) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${origin}/#/${route}`, { waitUntil: "networkidle" });
    await page.locator(".taro_page").first().waitFor({ state: "visible", timeout: 15_000 });
    if (errors.length > 0) throw new Error(`页面报错：${errors[0]}`);
    const file = path.join(outDir, `${route.replaceAll("/", "__")}.png`);
    await page.screenshot({ path: file });
    console.log(`已出图 ${path.relative(appRoot, file)}`);
  } catch (error) {
    failed.push(`${route}：${String(error.message).split("\n")[0]}`);
  }
  await page.close();
}
await browser.close();
server.close();
if (failed.length > 0) fail(`有页面没出图。\n  ${failed.join("\n  ")}`, 1);
console.log(`小程序截图：${routes.length} 页，宽 ${VIEWPORT.width}，在 apps/weapp/shots/dist/png/`);
