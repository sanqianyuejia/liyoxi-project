// W0-03 的门禁：门禁改动分类。在工作区包里新增一份 eslint.config.js，这个包就不再用根上的 lint 装配
//（ESLint 从被检文件所在目录向上找配置）。lint 本身拦不住它，要靠分类脚本判成放松：没有 gate-change 标签必须失败。
export default {
  gate: "门禁改动分类（遮蔽已登记的配置）",
  mutation: "工作包 PR 在 packages/services 下新增一份空的 eslint.config.js，没有 gate-change 标签",
  reason:
    /`packages\/services\/eslint\.config\.js`：新建了根上那份以外的 lint 配置[\s\S]*没有 gate-change 标签/,
  run(ctx) {
    const dir = ctx.gitRepo({ "packages/services/src/index.ts": "export const ok = true;\n" });
    ctx.git(dir, "commit", "-q", "-m", "base");
    ctx.writeFiles(dir, { "packages/services/eslint.config.js": "export default [];\n" });
    ctx.git(dir, "add", "-A");
    ctx.git(dir, "commit", "-q", "-m", "head");
    return ctx.node("infra/ci/classify-gate-changes.mjs", ["--base", "HEAD~1"], { cwd: dir });
  },
};
