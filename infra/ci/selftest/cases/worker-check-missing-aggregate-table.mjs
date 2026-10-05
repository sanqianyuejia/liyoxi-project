// W0-23 的门禁：任务进程的产物自检（CI 的“worker 产物自检”一步）。把它指到一个没有业务表的库，自检必须失败，
// 并说出是聚合类型对不上：契约登记的聚合类型都得是库里存在的表。
// 库用实例自带的维护库 postgres：只读它的系统目录，不建不改任何东西。
// 要先有产物（pnpm --filter @liyoxi/worker build，CI 里是“构建”一步）、本地那套 PostgreSQL 在运行，
// 并给出 DATABASE_URL（CLAUDE.md 第 9 节）。条件不具备时这一例会红，不会被悄悄跳过。
import { readFileSync } from "node:fs";
import { join } from "node:path";

export default {
  gate: "worker 产物自检（node apps/worker/dist/index.js --check）",
  mutation: "连到一个没有业务表的库",
  reason: /契约登记的聚合类型在库里没有对应的表/,
  run(ctx) {
    const step = readFileSync(join(ctx.repoRoot, ".github/workflows/ci.yml"), "utf8").match(
      /^ {6}- name: worker 产物自检\n(?: {8}.+\n)*? {8}run: node (apps\/worker\/dist\/index\.js) (--check)$/m,
    );
    if (!step) throw new Error("ci.yml 的 verify 里找不到“worker 产物自检”那一步");
    if (!process.env.DATABASE_URL)
      throw new Error("DATABASE_URL 未设置：这一例要连本地的 PostgreSQL");
    const empty = new URL(process.env.DATABASE_URL);
    empty.pathname = "/postgres";
    return ctx.node(step[1], [step[2]], {
      env: {
        APP_ENV: "test",
        DATABASE_URL: empty.toString(),
        REDIS_URL: "redis://localhost:6389/0",
      },
    });
  },
};
