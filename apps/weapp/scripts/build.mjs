#!/usr/bin/env node
// 小程序构建。根脚本是 pnpm weapp:build（= pnpm --filter @liyoxi/weapp build）。
//
// 用法：node scripts/build.mjs <weapp|h5> [--watch]      在 apps/weapp 下跑
//   weapp   出 dist/（微信开发者工具导入 apps/weapp）；随后由模板生成 project.config.json，再过体积门禁
//           （主包 ≤1,500KB、分包 ≤800KB，infra/ci/check-mp-size.mjs）。超限即以非 0 退出
//   h5      出 shots/dist/h5/，只给截图命令（scripts/shots.mjs）用，不发布
//   --watch 开发用：改了就重新构建，不过体积门禁（开发构建不压缩）
// 环境变量（都可不给；不读 .env）：
//   WEAPP_APPID         小程序 AppID，写进 project.config.json；缺省是测试号占位 touristappid
//   WEAPP_API_BASE_URL  接口基址（不含 /api/v1）；缺省为空，请求层与四个端上封装空转
//   WEAPP_VERSION       小程序版本号，随请求头 X-Client-Version 带出；缺省 0.1.0
//   WEAPP_SENTRY_DSN    错误上报的 DSN（公开部分，不是密钥）；缺省为空，错误上报不发请求
// project.config.json 是生成物、不入库：仓库里只有模板 project.config.template.json，appid 不手改。
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [type, ...flags] = process.argv.slice(2);
if (type !== "weapp" && type !== "h5") {
  console.error("小程序构建：第一个参数要是 weapp 或 h5");
  process.exit(2);
}
const watch = flags.includes("--watch");
const outDir = type === "weapp" ? "dist" : "shots/dist/h5";

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    console.error(`小程序构建：${command} 没跑起来。${result.error.message}`);
    process.exit(2);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (type === "weapp") {
  const appid = process.env.WEAPP_APPID || "touristappid";
  const template = readFileSync(path.join(appRoot, "project.config.template.json"), "utf8");
  writeFileSync(
    path.join(appRoot, "project.config.json"),
    template.replace("__WEAPP_APPID__", appid),
  );
}

// 先清掉上一次的产物：删掉的页面、改名的文件不该留在包里（体积门禁量的是整个目录）
rmSync(path.join(appRoot, outDir), { recursive: true, force: true });
run(
  path.join(appRoot, "node_modules/.bin/taro"),
  ["build", "--type", type, ...(watch ? ["--watch"] : [])],
  { NODE_ENV: watch ? "development" : "production", TARO_ENV: type },
);
if (type === "weapp" && !watch) {
  run(process.execPath, [path.resolve(appRoot, "../../infra/ci/check-mp-size.mjs"), "dist"]);
}
