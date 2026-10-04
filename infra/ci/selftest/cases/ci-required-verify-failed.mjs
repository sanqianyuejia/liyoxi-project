// W0-03 的门禁：汇总任务 required。必过任务 verify 失败时，required 必须失败（它是唯一设为必过的检查）。
export default {
  gate: "汇总任务 required",
  mutation: "verify 的结论是 failure",
  reason: /required 未通过：verify（failure）/,
  run(ctx) {
    const needs = { verify: { result: "failure" }, "gate-classify": { result: "success" } };
    return ctx.node("infra/ci/ci-required.mjs", ["--needs", JSON.stringify(needs)], {
      cwd: ctx.tempDir(),
      env: { GITHUB_STEP_SUMMARY: "" },
    });
  },
};
