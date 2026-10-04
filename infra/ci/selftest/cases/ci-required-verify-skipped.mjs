// W0-03 的门禁：汇总任务 required。必过任务被跳过不等于通过：平台把“依赖被跳过”的检查当成没失败，
// 所以 required 要自己判。只有 --may-skip 点名的任务（只在 PR 上跑的 gate-classify）可以是 skipped。
export default {
  gate: "汇总任务 required",
  mutation:
    "verify 的结论是 skipped（推到 main 的那种运行：gate-classify 允许被跳过，verify 不允许）",
  reason: /required 未通过：verify（skipped）/,
  run(ctx) {
    const needs = { verify: { result: "skipped" }, "gate-classify": { result: "skipped" } };
    return ctx.node(
      "infra/ci/ci-required.mjs",
      ["--needs", JSON.stringify(needs), "--may-skip", "gate-classify"],
      { cwd: ctx.tempDir(), env: { GITHUB_STEP_SUMMARY: "" } },
    );
  },
};
