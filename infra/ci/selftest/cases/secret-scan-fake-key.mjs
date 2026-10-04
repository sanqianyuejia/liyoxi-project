// W0-03 的门禁：密钥扫描。假密钥在运行时拼出来（随机内容的私钥块），不把形似密钥的字符串入库。
import { randomBytes } from "node:crypto";

export default {
  gate: "密钥扫描（gitleaks）",
  mutation: "配置文件里出现一段私钥",
  reason: /leaks found: 1[\s\S]*密钥扫描未通过/,
  run(ctx) {
    const dir = ctx.tempDir();
    const marker = (edge) => ["-----", edge, " RSA PRIVATE ", "KEY-----"].join("");
    const body = randomBytes(360)
      .toString("base64")
      .match(/.{1,64}/g)
      .join("\n");
    ctx.writeFiles(dir, {
      "deploy/id_rsa.pem": `${marker("BEGIN")}\n${body}\n${marker("END")}\n`,
    });
    const result = ctx.node("infra/ci/secret-scan.mjs", ["--dir", dir]);
    // 退出码 2 是环境问题（Docker 没在运行、镜像拉不下来），不算“检查失败”
    if (result.status === 2) throw new Error(result.output.trim().split("\n").slice(-2).join(" "));
    return result;
  },
};
