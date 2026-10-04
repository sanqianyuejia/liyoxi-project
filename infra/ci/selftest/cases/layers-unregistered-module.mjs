// W0-02 的门禁：依赖方向与分层。夹具是 infra/ci/fixtures/layers/unregistered-module，规则用仓库根的那份。
export default {
  gate: "依赖方向与分层（dependency-cruiser）",
  mutation: "引一个没登记的模块目录 partner",
  reason: /error services-unregistered-module: /,
  run(ctx) {
    return ctx.node(
      "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
      ["packages", "--config", `${ctx.repoRoot}/.dependency-cruiser.cjs`],
      { cwd: `${ctx.repoRoot}/infra/ci/fixtures/layers/unregistered-module` },
    );
  },
};
