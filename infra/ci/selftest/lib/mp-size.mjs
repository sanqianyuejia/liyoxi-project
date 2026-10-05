// 体积门禁反例共用：造一份最小的小程序产物。sizes 是 { 相对路径: 字节数 }，内容用占位字节填满。
export function mpDist(subRoots, sizes) {
  const files = {
    "app.json": JSON.stringify({
      pages: ["pages/home/index"],
      subPackages: subRoots.map((root) => ({ root, pages: ["index/index"] })),
    }),
  };
  for (const [path, bytes] of Object.entries(sizes)) files[path] = "x".repeat(bytes);
  return files;
}
