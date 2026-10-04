// W0-03 的门禁：门禁改动分类。把“删一条 lint 规则”的差异喂给分类脚本，没有 gate-change 标签必须失败。
const BASE = [
  "export const repoRules = {",
  '  "@typescript-eslint/no-explicit-any": "error",',
  '  "no-restricted-imports": ["error", { paths: ["axios"] }],',
  "};",
  "",
].join("\n");

export default {
  gate: "门禁改动分类",
  mutation: "工作包 PR 里删掉一条 lint 规则，没有 gate-change 标签",
  reason: /放松类门禁改动[\s\S]*没有 gate-change 标签/,
  run(ctx) {
    const dir = ctx.gitRepo({ "packages/config/eslint/repo.js": BASE });
    ctx.git(dir, "commit", "-q", "-m", "base");
    ctx.writeFiles(dir, {
      "packages/config/eslint/repo.js": BASE.replace(/^.*no-restricted-imports.*\n/m, ""),
      "packages/shared/src/http.ts": "export const ok = true;\n",
    });
    ctx.git(dir, "add", "-A");
    ctx.git(dir, "commit", "-q", "-m", "head");
    return ctx.node("infra/ci/classify-gate-changes.mjs", ["--base", "HEAD~1"], { cwd: dir });
  },
};
