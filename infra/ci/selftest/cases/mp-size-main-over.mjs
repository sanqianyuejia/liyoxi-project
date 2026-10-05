// W0-27a 的门禁：小程序体积（infra/ci/check-mp-size.mjs）。
// 主包超限：主包 1,501KB，唯一的分包 100KB。检查必须失败并指出是主包；分包的体积没被算进主包、也没被判超限。
import { mpDist } from "../lib/mp-size.mjs";

export default {
  gate: "小程序体积门禁：主包 ≤1,500KB",
  mutation: "主包 1,501KB（分包 100KB，在红线内）",
  reason: /超出红线。\s+主包 150\d\.\dKB，超过 1500KB/,
  run(ctx) {
    const dir = ctx.tempDir();
    ctx.writeFiles(
      dir,
      mpDist(["sub/catalog"], {
        "taro.js": 1501 * 1024,
        "sub/catalog/index/index.js": 100 * 1024,
      }),
    );
    return ctx.node("infra/ci/check-mp-size.mjs", [dir]);
  },
};
