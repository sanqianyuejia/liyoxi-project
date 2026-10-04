// W0-03 的门禁：密钥扫描，扫 git 历史的那条路（CI 里跑的就是它）。
// 私钥先提交进历史、下一个提交删掉：工作区里已经没有，历史里还在，必须命中。
// 扫描范围限在 HEAD 这条线上（--log-opts）；这一例同时防着范围写错、一个提交都没扫却报通过。
// 假密钥在运行时拼出来（随机内容的私钥块），不把形似密钥的字符串入库。
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";

export default {
  gate: "密钥扫描（gitleaks，git 历史）",
  mutation: "私钥提交进历史，下一个提交又删掉",
  reason: /leaks found: 1[\s\S]*密钥扫描未通过/,
  run(ctx) {
    const marker = (edge) => ["-----", edge, " RSA PRIVATE ", "KEY-----"].join("");
    const body = randomBytes(360)
      .toString("base64")
      .match(/.{1,64}/g)
      .join("\n");
    const dir = ctx.gitRepo({
      "README.md": "# 反例\n",
      "deploy/id_rsa.pem": `${marker("BEGIN")}\n${body}\n${marker("END")}\n`,
    });
    ctx.git(dir, "commit", "-q", "-m", "base");
    rmSync(join(dir, "deploy/id_rsa.pem"));
    ctx.git(dir, "add", "-A");
    ctx.git(dir, "commit", "-q", "-m", "remove");
    const result = ctx.node("infra/ci/secret-scan.mjs", [], { cwd: dir });
    // 退出码 2 是环境问题（Docker 没在运行、镜像拉不下来），不算“检查失败”
    if (result.status === 2) throw new Error(result.output.trim().split("\n").slice(-2).join(" "));
    return result;
  },
};
