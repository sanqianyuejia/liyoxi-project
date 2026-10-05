#!/usr/bin/env node
// apps/api 的构建（W0-22；D7 第 2.2 节末段、第 7.4 节）。pnpm --filter @liyoxi/api build
//
// 产物：dist/server.js（进程入口）、dist/check-env.js（环境变量自检），ESM，带 source map。
// @liyoxi/* 是源码包，内联进产物；node_modules 里的第三方包不打进去，运行时从 apps/api/node_modules 解析。
// 所以产物里出现的每个第三方包都得是本包 package.json 的 dependencies：构建完按产物的引用清单核对一遍，
// 有没声明的即失败（不核对的话，要到线上启动时才报“找不到模块”）。
// 镜像标签取构建环境的 LYX_BUILD，写进产物的 __LYX_BUILD__；没给即 dev。
// dist/ 里别的文件（已挂载清单 mounted-operations.json）不动。
// 打包器直接用 esbuild：02 第 5 节选的 tsup 8.5.1 装不上（它的依赖 chokidar@4.0.3 过不了 trustPolicy: no-downgrade），
// tsup 底下就是 esbuild，这里只用到打包这一件事。
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = `${root}dist/`;
const manifest = JSON.parse(readFileSync(`${root}package.json`, "utf8"));

/** 包名：@scope/name/sub → @scope/name；name/sub → name */
const packageOf = (specifier) => specifier.split("/", specifier.startsWith("@") ? 2 : 1).join("/");

// 只清上一次构建留下的脚本与 source map
mkdirSync(dist, { recursive: true });
for (const entry of readdirSync(dist, { withFileTypes: true })) {
  if (entry.isFile() && /\.js(\.map)?$/.test(entry.name)) rmSync(`${dist}${entry.name}`);
}

const result = await build({
  absWorkingDir: root,
  entryPoints: { server: "src/server.ts", "check-env": "src/check-env.ts" },
  outdir: "dist",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: true,
  metafile: true,
  logLevel: "warning",
  define: { __LYX_BUILD__: JSON.stringify(process.env.LYX_BUILD?.trim() || "dev") },
  plugins: [
    {
      name: "external-node-modules",
      setup(context) {
        // 裸模块名里只有 @liyoxi/* 往下解析、打进产物；其余一律留给运行时
        context.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith("@liyoxi/") ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});

const used = new Set();
for (const output of Object.values(result.metafile.outputs)) {
  for (const { path, external } of output.imports) {
    if (external && !isBuiltin(path)) used.add(packageOf(path));
  }
}
const undeclared = [...used].filter((name) => !(name in manifest.dependencies)).sort();
if (undeclared.length > 0) {
  console.error(
    `apps/api 的产物引了没在 package.json 的 dependencies 里声明的包：${undeclared.join("、")}。` +
      "它们是内联进来的 @liyoxi/* 包的依赖，打包后要从 apps/api/node_modules 解析：照那些包里的版本加进本包的 dependencies",
  );
  process.exit(1);
}
const files = Object.keys(result.metafile.outputs).filter((name) => name.endsWith(".js"));
console.log(`apps/api 构建完成：${files.length} 个文件，第三方包 ${used.size} 个，都已声明`);
