#!/usr/bin/env node
// 小程序体积门禁（D7 第 4.2 节；计划 第 5.5 节）：主包与各分包的体积不超过红线。
//
// 用法：node infra/ci/check-mp-size.mjs <小程序构建产物目录>      如 apps/weapp/dist
// 口径：
//   1. 分包取产物里 app.json 的 subPackages（或 subpackages）各项的 root；一个分包的体积 = 它的 root 目录下全部文件的字节数。
//   2. 主包 = 产物目录下全部文件的字节数 − 各分包的体积（与参考工程的“dist 总量减分包”一致）。
//   3. 红线：主包 ≤ 1,500KB，任一分包 ≤ 800KB；1KB = 1,024 字节。微信的硬上限是主包 2MB，这里留了余量。
//   4. 打印各包的体积与占红线的比例；超限的逐个指出超了多少。
// 量的是产物目录里实际有的文件：构建前要先清掉上一次的产物（apps/weapp/scripts/build.mjs 会清）。
// 退出码：0 都在红线内；1 有超限；2 用法或环境错误（目录不在、没有 app.json、app.json 读不懂、分包目录不在）。
// 本脚本不引依赖。反例在 selftest/cases/mp-size-*.mjs。

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const MAIN_LIMIT_KB = 1500;
const SUB_LIMIT_KB = 800;
const KB = 1024;

function fail(message) {
  console.error(`小程序体积门禁：${message}`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith("-")) {
  fail("用法：node infra/ci/check-mp-size.mjs <小程序构建产物目录>");
}
const dist = resolve(args[0]);
if (!existsSync(dist) || !statSync(dist).isDirectory()) fail(`产物目录不在：${args[0]}（先构建）`);

/** 目录下全部文件的字节数；不跟软链接 */
function sizeOf(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += sizeOf(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

let appConfig;
try {
  appConfig = JSON.parse(readFileSync(join(dist, "app.json"), "utf8"));
} catch (error) {
  fail(`读不了 ${args[0]}/app.json：${error.message}`);
}
const declared = appConfig.subPackages ?? appConfig.subpackages ?? [];
if (!Array.isArray(declared)) fail("app.json 的 subPackages 不是数组");

const subs = declared.map((item) => {
  const root = typeof item?.root === "string" ? item.root.replace(/^\/+|\/+$/g, "") : "";
  if (root === "" || root.split("/").includes(".."))
    fail("app.json 里有分包没写 root，或 root 不合法");
  const dir = join(dist, root);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`分包目录不在：${root}`);
  return { name: root, bytes: sizeOf(dir), limitKb: SUB_LIMIT_KB };
});
const total = sizeOf(dist);
const main = {
  name: "主包",
  bytes: total - subs.reduce((sum, sub) => sum + sub.bytes, 0),
  limitKb: MAIN_LIMIT_KB,
};

const kb = (bytes) => (bytes / KB).toFixed(1);
const packages = [main, ...subs];
const over = packages.filter((item) => item.bytes > item.limitKb * KB);
console.log("小程序体积（KB，1KB = 1,024 字节）：");
for (const item of packages) {
  const ratio = ((item.bytes / (item.limitKb * KB)) * 100).toFixed(0);
  console.log(`  ${item.name}  ${kb(item.bytes)} / ${item.limitKb}（${ratio}%）`);
}
console.log(`  合计  ${kb(total)}`);
if (over.length > 0) {
  console.error("小程序体积门禁：超出红线。");
  for (const item of over) {
    console.error(
      `  ${item.name} ${kb(item.bytes)}KB，超过 ${item.limitKb}KB，多了 ${kb(item.bytes - item.limitKb * KB)}KB`,
    );
  }
  console.error("  把只有某个分包用的代码与图片移进那个分包，大图走 CDN（D7 第 4.2 节）。");
  process.exit(1);
}
console.log("小程序体积门禁通过。");
