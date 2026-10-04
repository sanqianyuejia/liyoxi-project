// W0-02 的门禁：依赖方向与分层。夹具是 infra/ci/fixtures/layers/fe-imports-db，规则用仓库根的那份。
export default {
  gate: "依赖方向与分层（dependency-cruiser）",
  mutation: "前端引数据包：apps/weapp 引 @liyoxi/db",
  reason: /error fe-no-server: /,
  run(ctx) {
    return ctx.node(
      "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
      ["apps", "packages", "--config", `${ctx.repoRoot}/.dependency-cruiser.cjs`],
      { cwd: `${ctx.repoRoot}/infra/ci/fixtures/layers/fe-imports-db` },
    );
  },
};
