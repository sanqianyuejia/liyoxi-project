// W0-03 的门禁：密钥扫描不受 .gitattributes 影响。
// .gitattributes 里写一行“*.pem -diff”（或 binary），git log -p 对这类文件只出一行 “Binary files differ”，
// gitleaks 拿不到内容。.gitattributes 不是门禁文件，门禁改动分类看不到这一行。
// 这一例把私钥与这一行属性一起提交进历史，走 CI 里跑的那条路，必须照样命中；扫描脚本去掉 --text 时这里会红。
// 假密钥在运行时拼出来（随机内容的私钥块），不把形似密钥的字符串入库。
import { randomBytes } from "node:crypto";

export default {
  gate: "密钥扫描（gitleaks，.gitattributes 把文件标成不出差异）",
  mutation: "私钥所在的文件类型在 .gitattributes 里标了 -diff",
  reason: /leaks found: 1[\s\S]*密钥扫描未通过/,
  run(ctx) {
    const marker = (edge) => ["-----", edge, " RSA PRIVATE ", "KEY-----"].join("");
    const body = randomBytes(360)
      .toString("base64")
      .match(/.{1,64}/g)
      .join("\n");
    const dir = ctx.gitRepo({
      "README.md": "# 反例\n",
      ".gitattributes": "*.pem -diff\n",
      "deploy/id_rsa.pem": `${marker("BEGIN")}\n${body}\n${marker("END")}\n`,
    });
    ctx.git(dir, "commit", "-q", "-m", "base");
    const result = ctx.node("infra/ci/secret-scan.mjs", [], { cwd: dir });
    // 退出码 2 是环境问题（Docker 没在运行、镜像拉不下来），不算“检查失败”
    if (result.status === 2) throw new Error(result.output.trim().split("\n").slice(-2).join(" "));
    return result;
  },
};
