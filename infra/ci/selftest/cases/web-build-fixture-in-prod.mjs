// W0-28 的门禁：生产构建不含夹具（apps/admin/scripts/check-build.mjs，后台与下载页的 build 脚本里跑）。
// 造一份别的都合格、只是脚本里带着夹具标记的产物：检查必须失败。
// 检查不再扫产物内容、或标记改了名而样例页没跟着改时，这一例会红。
import { goodDist } from "../lib/web-build.mjs";

// 标记在运行时拼出来，不作为字面量入库
const MARK = ["lyx", "dev", "fixture"].join("-");

export default {
  gate: "构建产物检查：生产构建不含夹具",
  mutation: "生产产物的脚本里带着夹具的标记（样例页进了生产包）",
  reason: /生产构建里出现了夹具的标记.*assets\/index-Ab12Cd34\.js/,
  run(ctx) {
    const dir = ctx.tempDir();
    ctx.writeFiles(
      dir,
      goodDist({ "assets/index-Ab12Cd34.js": `const staff = { id: "${MARK}" };\n` }),
    );
    return ctx.node("apps/admin/scripts/check-build.mjs", [dir, "--app", "admin"]);
  },
};
