// W0-23 的门禁：兼容脚本（CI 的“redis:compat”一步）。没给连接串时必须失败并说明缺的是哪个变量，
// 不能悄悄去连别的地址（比如退回 REDIS_URL）。
// 要先有产物（pnpm --filter @liyoxi/worker build，CI 里是“构建”一步）。没有时这一例会红，不会被悄悄跳过。
export default {
  gate: "兼容脚本（pnpm redis:compat）",
  mutation: "不给 REDIS_COMPAT_URL，只给了 REDIS_URL",
  reason: /REDIS_COMPAT_URL 未设置/,
  run(ctx) {
    return ctx.node("apps/worker/dist/redis-compat.js", ["--no-prompt"], {
      env: { REDIS_COMPAT_URL: "", REDIS_URL: "redis://localhost:6389/0" },
    });
  },
};
