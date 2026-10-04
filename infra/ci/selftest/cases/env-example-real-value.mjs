// W0-03 的门禁：.env.example 只放占位。连接串在这里拼出来，不把形似真实配置的字符串入库。
export default {
  gate: ".env.example 核对",
  mutation: "样例里的连接串写了真实的主机与口令",
  reason: /DATABASE_URL 的值不是占位/,
  run(ctx) {
    const dir = ctx.tempDir();
    const url = ["postgresql://app", "s3cr3t-pass@db.internal", "5432/app"].join(":");
    ctx.writeFiles(dir, { "env.example": `APP_ENV=<环境>\nDATABASE_URL=${url}\n` });
    return ctx.node("infra/ci/check-env-example.mjs", [
      "--file",
      `${dir}/env.example`,
      "--keys",
      "APP_ENV,DATABASE_URL",
    ]);
  },
};
