// W0-02 的门禁：依赖方向与分层。夹具是 infra/ci/fixtures/layers/cross-layer，规则用仓库根的那份。
export default {
  gate: "依赖方向与分层（dependency-cruiser）",
  mutation: "越层：billing（L2）引 order（L3）",
  reason: /error layer-L2-no-upward: /,
  run(ctx) {
    return ctx.node(
      "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
      ["packages", "--config", `${ctx.repoRoot}/.dependency-cruiser.cjs`],
      { cwd: `${ctx.repoRoot}/infra/ci/fixtures/layers/cross-layer` },
    );
  },
};
