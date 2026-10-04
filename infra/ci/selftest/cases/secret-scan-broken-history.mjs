// W0-03 的门禁：密钥扫描读不全 git 历史时不得报通过。
// 私钥在最早的提交里（后来删掉了）；中间一个提交的树对象读不到，git log 走到那里就出错，更早的提交没扫到。
// gitleaks 这时只记一行 ERR，照样以 0 退出并报“没有命中”。扫描脚本要把它判成没跑完（退出码 2）。
// 假密钥在运行时拼出来（随机内容的私钥块），不把形似密钥的字符串入库。
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";

export default {
  gate: "密钥扫描（gitleaks，历史读不全）",
  mutation: "历史里有一个对象读不到，带私钥的那个提交没被扫到",
  reason: /ERR \[git\][\s\S]*git 历史没有读全/,
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
    ctx.git(dir, "commit", "-q", "-m", "c1");
    rmSync(join(dir, "deploy"), { recursive: true });
    for (const name of ["c2", "c3", "c4"]) {
      ctx.writeFiles(dir, { [`${name}.txt`]: `${name}\n` });
      ctx.git(dir, "add", "-A");
      ctx.git(dir, "commit", "-q", "-m", name);
    }
    // 弄坏：删掉 c2 的树对象。c4、c3 的差异还出得来，轮到 c2 时读不到，c1 就没扫
    const tree = ctx.git(dir, "rev-parse", "HEAD~2^{tree}").output.trim();
    rmSync(join(dir, ".git/objects", tree.slice(0, 2), tree.slice(2)));
    return ctx.node("infra/ci/secret-scan.mjs", [], { cwd: dir });
  },
};
