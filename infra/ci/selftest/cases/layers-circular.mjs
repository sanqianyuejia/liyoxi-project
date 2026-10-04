// W0-02 的门禁：依赖方向与分层。夹具是 infra/ci/fixtures/layers/circular，规则用仓库根的那份。
export default {
  gate: "依赖方向与分层（dependency-cruiser）",
  mutation: "成环：events 与 audit 互引",
  reason: /error no-circular: /,
  run(ctx) {
    return ctx.node(
      "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
      ["packages", "--config", `${ctx.repoRoot}/.dependency-cruiser.cjs`],
      { cwd: `${ctx.repoRoot}/infra/ci/fixtures/layers/circular` },
    );
  },
};
