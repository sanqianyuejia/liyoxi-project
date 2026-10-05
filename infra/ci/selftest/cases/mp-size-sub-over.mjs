// W0-27a 的门禁：小程序体积（infra/ci/check-mp-size.mjs）。
// 某个分包超限：两个分包里 sub/order 801KB，主包与另一个分包都在红线内。检查必须失败并指出是哪个分包。
import { mpDist } from "../lib/mp-size.mjs";

export default {
  gate: "小程序体积门禁：分包 ≤800KB",
  mutation: "分包 sub/order 801KB（主包 300KB、分包 sub/catalog 100KB，都在红线内）",
  reason: /超出红线。\s+sub\/order 801\.\dKB，超过 800KB/,
  run(ctx) {
    const dir = ctx.tempDir();
    ctx.writeFiles(
      dir,
      mpDist(["sub/catalog", "sub/order"], {
        "taro.js": 300 * 1024,
        "sub/catalog/index/index.js": 100 * 1024,
        "sub/order/index/index.js": 801 * 1024,
      }),
    );
    return ctx.node("infra/ci/check-mp-size.mjs", [dir]);
  },
};
