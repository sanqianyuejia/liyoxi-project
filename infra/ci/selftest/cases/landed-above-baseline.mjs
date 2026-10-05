// W0-10 的门禁：待落地数只减不增（node infra/ci/landed.mjs --check）。待落地数比基线多一条，检查必须失败。
// 不动本仓库的文件：拿提交的路由清单加一条谁也没实现的 V1.0 接口，另写一份基线，数取“加了这一条之后的待落地数减一”
//（先跑一遍 --report 读出来，不写死）。换的只是路由清单与基线两个输入，判定用的处理器清单、接口层测试、留桩清单
// 都是仓库里真的那几份。
// CI 里没有了这一步（它在 test 任务里）、或检查不再拿待落地数与基线比时，这一例会红。不连库。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ciCommand } from "./docs-check-wrong-permission.mjs";

const ROUTES = "packages/contract/generated/routes.json";

export default {
  gate: "待落地数只减不增（landed.mjs --check）",
  mutation: "路由清单多出一条没有落地的 V1.0 接口，待落地数比基线多一条",
  reason: /已落地判定未通过[\s\S]*待落地数 \d+ 高于基线 \d+：待落地数只减不增/,
  run(ctx) {
    const [, script] = ciCommand(ctx, "node infra/ci/landed.mjs --check");
    const routes = JSON.parse(readFileSync(join(ctx.repoRoot, ROUTES), "utf8"));
    const extra = {
      ...routes.find((route) => route.version === "V1.0"),
      operationId: "m.lyxSelftest.neverLanded",
      path: "/m/lyx-selftest",
    };
    const dir = ctx.tempDir();
    ctx.writeFiles(dir, {
      "routes.json": JSON.stringify([...routes, extra]),
      "baseline.txt": "0\n",
    });
    const inputs = ["--routes", join(dir, "routes.json"), "--baseline", join(dir, "baseline.txt")];
    const report = ctx.node(script, ["--report", ...inputs]);
    const pending = report.output.match(/待落地 (\d+)；/)?.[1];
    if (pending === undefined) throw new Error(`读不出待落地数：${report.output.slice(0, 200)}`);
    ctx.writeFiles(dir, { "baseline.txt": `${Number(pending) - 1}\n` });
    return ctx.node(script, ["--check", ...inputs]);
  },
};
