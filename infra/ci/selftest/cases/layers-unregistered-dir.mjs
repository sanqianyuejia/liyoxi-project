// W0-02 的门禁：分层登记核对（pnpm depcheck 的第一步）。夹具里的 partner 目录没有登记。
export default {
  gate: "分层登记核对（check-layers）",
  mutation: "模块目录下多出一个没登记的目录 partner",
  reason: /partner：目录没有登记/,
  run(ctx) {
    return ctx.node("infra/ci/check-layers.mjs", [
      "--services-dir",
      `${ctx.repoRoot}/infra/ci/fixtures/layers/unregistered-module/packages/services/src`,
    ]);
  },
};
