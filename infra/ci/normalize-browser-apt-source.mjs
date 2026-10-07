#!/usr/bin/env node
// Ubuntu 临时 CI runner：只将 Azure Ubuntu 镜像 URI 改到官方 HTTPS 源。
// node infra/ci/normalize-browser-apt-source.mjs [--root /etc/apt]
// 不更新索引、不安装包；随后原 Playwright --with-deps 命令照常执行。
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const officialUri = (uri) =>
  /^https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?$/.test(uri)
    ? "https://archive.ubuntu.com/ubuntu"
    : uri;

function normalize(content, deb822, mirrorlist = false) {
  let inUris = false;
  return content
    .split(/(\r?\n)/)
    .map((line) => {
      if (/^\s*#/.test(line) || /^\r?\n$/.test(line)) return line;
      if (mirrorlist) {
        return line.replace(/^(\s*)(\S+)/, (_, prefix, uri) => prefix + officialUri(uri));
      }
      if (!deb822) {
        return line.replace(
          /^(\s*deb(?:-src)?\s+(?:\[[^\]\r\n]*\]\s+)?)(\S+)/,
          (_, prefix, uri) => prefix + officialUri(uri),
        );
      }
      if (line.trim() === "") inUris = false;
      const field = line.match(/^([\w-]+):/);
      if (field) inUris = field[1].toLowerCase() === "uris";
      if (!inUris) return line;
      return line.replace(/\S+/g, (token) => officialUri(token));
    })
    .join("");
}

async function regular(path, directory, optional = false) {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (optional && error.code === "ENOENT") return false;
    throw error;
  }
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) {
    throw new Error("APT source path must be a regular file or directory, without symlinks");
  }
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--root" || !args[1])) {
    throw new Error("Usage: normalize-browser-apt-source.mjs [--root <apt-directory>]");
  }
  const root = resolve(args[1] ?? "/etc/apt");
  await regular(root, true);
  const paths = [];
  const legacy = join(root, "sources.list");
  if (await regular(legacy, false, true)) paths.push(legacy);
  const sourceDir = join(root, "sources.list.d");
  if (await regular(sourceDir, true, true)) {
    for (const name of (await readdir(sourceDir)).sort()) {
      if (!/\.(?:list|sources)$/.test(name)) continue;
      const path = join(sourceDir, name);
      await regular(path, false);
      paths.push(path);
    }
  }
  if (paths.length === 0) throw new Error("No APT source files found");
  // 官方 runner-images 的 Ubuntu 源使用 mirror+file:/etc/apt/apt-mirrors.txt。
  // 只处理该已知列表，不跟随来源文件里的任意 file URI；保留优先级与回退项。
  const mirrors = join(root, "apt-mirrors.txt");
  if (await regular(mirrors, false, true)) paths.push(mirrors);
  // 先验证并读取全部候选文件，坏路径不会造成部分源已被改写。
  const changes = [];
  for (const path of paths) {
    const content = await readFile(path, "utf8");
    const next = normalize(content, path.endsWith(".sources"), path === mirrors);
    if (next !== content) changes.push({ path, next });
  }
  for (const { path, next } of changes) await writeFile(path, next);
  console.log(`Ubuntu browser APT source: ${changes.length} file(s) normalized`);
}

main().catch(() => {
  // 不输出源文件内容或第三方源连接信息。
  console.error(
    "Browser APT source normalization failed: check arguments and regular source paths",
  );
  process.exitCode = 1;
});
