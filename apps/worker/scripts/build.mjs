// 任务进程的构建（W0-23）：node scripts/build.mjs。产物在 dist/：index.js（任务进程）、redis-compat.js（兼容脚本）。
// 工作区的包都是源码包，连同第三方依赖一起打进产物；只留下面两个包在外面：它们运行时要读自己包里的文件，
// 不能打进去，所以也写在本包的 dependencies 里，产物从 apps/worker/node_modules 解析得到。
// 02 第 3.3 节定的构建工具是 tsup，它就是包了一层 esbuild；tsup 8.5.1 的依赖 chokidar@4.0.3 过不了
// 可信级别检查（pnpm-workspace.yaml 的 trustPolicy），装不上，这里直接用锁文件里已有的 esbuild。
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const EXTERNAL = ["bullmq", "ioredis"];

function version() {
  if (process.env.LYX_BUILD_VERSION) return process.env.LYX_BUILD_VERSION;
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const root = fileURLToPath(new URL("../", import.meta.url));
rmSync(`${root}dist/index.js`, { force: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: { index: "src/index.ts", "redis-compat": "src/cli/redis-compat.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external: EXTERNAL,
  define: { __LYX_VERSION__: JSON.stringify(version()) },
  // 打进来的 CommonJS 依赖（pg 等）要用 require 取 Node 内置模块（做法借自参考工程 apps/worker/tsup.config.ts）
  banner: {
    js: 'import { createRequire as __lyxCreateRequire } from "node:module"; const require = __lyxCreateRequire(import.meta.url);',
  },
  logLevel: "warning",
  metafile: true,
});
for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  if (file.endsWith(".js")) console.log(`${file}  ${(meta.bytes / 1024).toFixed(0)} KB`);
}
