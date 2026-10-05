// W0-10 的门禁：api-check 进 CI（node infra/ci/api-check.mjs）。“文档引用的表.列”一项连不上库时，
// tools/api-check/check.py 只写“未核对”、照样以 0 退出；CI 里这一项必须真的核对过，所以包装脚本把“未核对”按失败算。
// 这里让它连一个不存在的库，检查必须失败。不动本仓库的文件（报告写在 tools/api-check/out/，不入库），不写库。
// CI 里没有了这一步（它在 test 任务里）、或“未核对”不再按失败算时，这一例会红。
// 要 python3 与 psql 在 PATH 上，并给出 DATABASE_URL 或 PG* 环境变量。
import { ciCommand } from "./docs-check-wrong-permission.mjs";

export default {
  gate: "api-check（“表.列”一项未核对按失败算）",
  mutation: "让“表.列”一项去连一个不存在的库",
  reason: /api-check 未通过：“文档引用的表\.列”一项未核对（连不上库 lyx_selftest_no_such_db/,
  run(ctx) {
    const [, script] = ciCommand(ctx, "node infra/ci/api-check.mjs");
    // 环境里若带着 API_CHECK_DB，它优先于 --database：这里显式盖掉
    return ctx.node(script, ["--database", "lyx_selftest_no_such_db"], {
      env: { API_CHECK_DB: "lyx_selftest_no_such_db" },
    });
  },
};
