// W0-03 的门禁：门禁改动分类，“放行文件与它的门禁条目同一个 PR 新建才算只增”的口径。
// 落后的分支（共同祖先上还没有清单）把目标分支上的门禁文件清单原样拷进来，再新建密钥扫描的放行文件：
// 清单与目标分支上的逐字相同，合并时不冲突；条目在目标分支上已经登记，这不是同建，没有 gate-change 标签必须失败。
// 分类脚本不看 --base 那一头的清单时这一例会红。
const REGISTRY = `${JSON.stringify({ files: [{ pattern: ".gitleaksignore", kind: "frozen" }] }, null, 2)}\n`;

export default {
  gate: "门禁改动分类（放行文件与门禁同建）",
  mutation:
    "落后的分支把目标分支上的清单原样拷进来，再新建密钥扫描的放行文件，没有 gate-change 标签",
  reason: /`\.gitleaksignore`：新建了密钥扫描的放行项\n[\s\S]*没有 gate-change 标签/,
  run(ctx) {
    const dir = ctx.gitRepo({ "src/app.ts": "export const a = 1;\n" });
    ctx.git(dir, "commit", "-q", "-m", "ancestor");
    ctx.git(dir, "branch", "work");
    ctx.writeFiles(dir, { "infra/ci/gate-files.json": REGISTRY });
    ctx.git(dir, "add", "-A");
    ctx.git(dir, "commit", "-q", "-m", "target");
    ctx.git(dir, "checkout", "-q", "work");
    ctx.writeFiles(dir, {
      "infra/ci/gate-files.json": REGISTRY,
      ".gitleaksignore": "abc:README.md:generic-api-key:1\n",
    });
    ctx.git(dir, "add", "-A");
    ctx.git(dir, "commit", "-q", "-m", "work");
    return ctx.node("infra/ci/classify-gate-changes.mjs", ["--base", "main"], { cwd: dir });
  },
};
