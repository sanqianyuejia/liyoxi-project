// W0-30 的门禁：台账单项文件核对（CI 里的 node infra/ci/plan-summaries.mjs --check）。
// 留桩、计划变更、外部验证三张汇总不入库，这一步只查单项文件合不合规；留桩的状态是“留桩数”与“已落地”判定读的键，
// 写成表外的值必须失败，并点出是哪个文件的哪一项。
// 在仓库外摆一棵最小的 docs/plan：先核对合规的那一版通过，再把一份留桩的状态改掉。
// CI 里没有了这一步、或核对不再看状态取值时，这一例会红。不连库。
import { ciCommand } from "./docs-check-wrong-permission.mjs";

const table = (title, rows) =>
  [
    `# ${title}`,
    "",
    "| 项 | 内容 |",
    "| --- | --- |",
    ...Object.entries(rows).map(([key, value]) => `| ${key} | ${value} |`),
    "",
  ].join("\n");
const stub = (status) =>
  table("样例留桩", {
    状态: status,
    留桩内容: "样例接口只出框架",
    骨架里的做法: "返回空",
    登记的工作包: "W9-01",
    回补里程碑: "M9",
    回补的工作包: "待拆包后填",
    依据: "计划 第 7.3 节",
  });

export default {
  gate: "台账单项文件核对（plan-summaries.mjs --check）",
  mutation: "一份留桩文件的状态写成表外的“已完成”",
  reason: /docs\/plan\/stubs\/m9-ops-sample\.md：状态“已完成”不在取值范围内，只能是 留桩中、已回补/,
  run(ctx) {
    const [, script, ...args] = ciCommand(ctx, "node infra/ci/plan-summaries.mjs --check");
    const root = ctx.tempDir();
    ctx.writeFiles(root, {
      "docs/plan/stubs/m9-ops-sample.md": stub("留桩中"),
      "docs/plan/changes/W9-01-sample.md": table("样例变更", {
        改了什么: "样例",
        原因: "样例",
        影响的包: "W9-01",
        类别: "拆并",
        PR: "—",
      }),
      "docs/plan/external-verification/v99-sample.md": table("V99 样例", {
        编号: "V99",
        来源: "样例",
        验证什么: "样例",
        通过标准: "样例",
        依赖的业主事项: "无",
        谁来做: "W9-01",
        最晚关闭点: "M9 退出",
        不通过的退路: "—",
        状态: "未开始",
        结论: "",
        证据: "",
        关闭日期: "",
      }),
    });
    const baseline = ctx.node(script, [...args, "--root", root]);
    if (baseline.status !== 0) throw new Error(`合规的基线没通过核对：${baseline.output.trim()}`);
    ctx.writeFiles(root, { "docs/plan/stubs/m9-ops-sample.md": stub("已完成") });
    return ctx.node(script, [...args, "--root", root]);
  },
};
