// W0-03 的门禁：密钥扫描不认写在被扫文件里的放行注释（放行项只在 .gitleaks.toml）。
// gitleaks 缺省认行尾的放行注释：命中的那一行带上它就不报。这种注释写在业务文件里，门禁改动分类看不到。
// 这一例把带注释的私钥提交进历史，走 CI 里跑的那条路，必须照样命中；扫描脚本去掉 --ignore-gitleaks-allow 时这里会红。
// 假密钥与放行注释都在运行时拼出来，不把形似密钥的字符串、也不把这个注释入库。
import { randomBytes } from "node:crypto";

export default {
  gate: "密钥扫描（gitleaks，行内放行注释）",
  mutation: "私钥的首尾两行都带上 gitleaks 的行内放行注释",
  reason: /leaks found: 1[\s\S]*密钥扫描未通过/,
  run(ctx) {
    const marker = (edge) => ["-----", edge, " RSA PRIVATE ", "KEY-----"].join("");
    const allow = ["# gitleaks", "allow"].join(":");
    const body = randomBytes(360)
      .toString("base64")
      .match(/.{1,64}/g)
      .join("\n");
    const dir = ctx.gitRepo({
      "README.md": "# 反例\n",
      "deploy/id_rsa.pem": `${marker("BEGIN")} ${allow}\n${body}\n${marker("END")} ${allow}\n`,
    });
    ctx.git(dir, "commit", "-q", "-m", "base");
    const result = ctx.node("infra/ci/secret-scan.mjs", [], { cwd: dir });
    // 退出码 2 是环境问题（Docker 没在运行、镜像拉不下来），不算“检查失败”
    if (result.status === 2) throw new Error(result.output.trim().split("\n").slice(-2).join(" "));
    return result;
  },
};
