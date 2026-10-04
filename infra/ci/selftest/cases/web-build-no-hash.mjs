// W0-28 的门禁：产物文件名带内容哈希、写入构建号（apps/admin/scripts/check-build.mjs）。
// 造一份脚本文件名不带哈希、index.html 里也没有构建号的产物：检查必须失败，两处都要指出来。
import { goodDist } from "../lib/web-build.mjs";

export default {
  gate: "构建产物检查：文件名带哈希、写入构建号",
  mutation: "脚本叫 assets/index.js（没有哈希），index.html 里没有构建号",
  reason: /没有 <meta name="lyx-build">[\s\S]*文件名不带内容哈希：assets\/index\.js/,
  run(ctx) {
    const dir = ctx.tempDir();
    const files = goodDist({
      "index.html": '<!doctype html><script type="module" src="/assets/index.js"></script>',
      "assets/index.js": 'console.log("app");\n',
    });
    delete files["assets/index-Ab12Cd34.js"];
    ctx.writeFiles(dir, files);
    return ctx.node("apps/admin/scripts/check-build.mjs", [dir, "--app", "admin"]);
  },
};
