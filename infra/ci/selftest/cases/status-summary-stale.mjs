// W0-03 的门禁：状态汇总无差异。改了状态文件却没重新生成（或手改了汇总），核对必须失败。
const file = (status) =>
  [
    "# W9-01 示例包",
    "",
    "| 项 | 内容 |",
    "| --- | --- |",
    "| 编号 | W9-01 |",
    "| 里程碑 | M9 |",
    `| 状态 | ${status} |`,
    "| PR | — |",
    "| 依赖 | — |",
    "| 评审级别 | 乙 |",
    "| 规模 | S |",
    "| 阻塞原因 | 无 |",
    "",
  ].join("\n");

export default {
  gate: "状态汇总无差异",
  mutation: "状态文件改成“完成”，汇总没重新生成",
  reason: /SUMMARY\.md 与状态文件不一致/,
  run(ctx) {
    const dir = ctx.tempDir();
    ctx.writeFiles(dir, { "W9-01.md": file("未开工") });
    const first = ctx.node("infra/ci/status-summary.mjs", ["--dir", dir]);
    if (first.status !== 0) throw new Error(`基线汇总没生成出来：${first.output.trim()}`);
    ctx.writeFiles(dir, { "W9-01.md": file("完成") });
    return ctx.node("infra/ci/status-summary.mjs", ["--dir", dir, "--check"]);
  },
};
