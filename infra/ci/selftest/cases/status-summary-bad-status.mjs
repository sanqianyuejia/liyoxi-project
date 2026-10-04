// W0-03 的门禁：状态汇总。状态文件里写了取值范围之外的状态，生成必须失败。
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
  gate: "状态汇总",
  mutation: "状态文件的状态写成“待评审”",
  reason: /状态“待评审”不在取值范围内/,
  run(ctx) {
    const dir = ctx.tempDir();
    ctx.writeFiles(dir, { "W9-01.md": file("待评审") });
    return ctx.node("infra/ci/status-summary.mjs", ["--dir", dir]);
  },
};
