// W0-03 的门禁：密钥扫描的范围是 HEAD 能到的全部提交，合并提交自己的改动也在内。
// 私钥只出现在合并提交里：两条分支上都没有，是合并时手工加进去的（解决冲突时就能这样带进来）。
// gitleaks 缺省不看合并提交的差异；扫描脚本去掉 --diff-merges=first-parent 时这一例会红。
// 假密钥在运行时拼出来（随机内容的私钥块），不把形似密钥的字符串入库。
import { randomBytes } from "node:crypto";

export default {
  gate: "密钥扫描（gitleaks，合并提交）",
  mutation: "私钥只出现在合并提交自己的改动里",
  reason: /leaks found: 1[\s\S]*密钥扫描未通过/,
  run(ctx) {
    const marker = (edge) => ["-----", edge, " RSA PRIVATE ", "KEY-----"].join("");
    const body = randomBytes(360)
      .toString("base64")
      .match(/.{1,64}/g)
      .join("\n");
    const dir = ctx.gitRepo({ "README.md": "# 反例\n" });
    ctx.git(dir, "commit", "-q", "-m", "base");
    ctx.git(dir, "checkout", "-q", "-b", "other");
    ctx.writeFiles(dir, { "b.txt": "b\n" });
    ctx.git(dir, "add", "-A");
    ctx.git(dir, "commit", "-q", "-m", "other");
    ctx.git(dir, "checkout", "-q", "main");
    ctx.writeFiles(dir, { "c.txt": "c\n" });
    ctx.git(dir, "add", "-A");
    ctx.git(dir, "commit", "-q", "-m", "main");
    ctx.git(dir, "merge", "-q", "--no-ff", "--no-commit", "other");
    ctx.writeFiles(dir, {
      "deploy/id_rsa.pem": `${marker("BEGIN")}\n${body}\n${marker("END")}\n`,
    });
    ctx.git(dir, "add", "-A");
    ctx.git(dir, "commit", "-q", "-m", "merge");
    const result = ctx.node("infra/ci/secret-scan.mjs", [], { cwd: dir });
    // 退出码 2 是环境问题（Docker 没在运行、镜像拉不下来），不算“检查失败”
    if (result.status === 2) throw new Error(result.output.trim().split("\n").slice(-2).join(" "));
    return result;
  },
};
