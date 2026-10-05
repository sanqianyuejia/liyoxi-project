// 播种的镜像内入口（W1-22）：node apps/worker/dist/seed.js
// 库要先跑完迁移（prisma migrate deploy）。环境变量只经 loadEnv 读（APP_ENV、DATABASE_URL、REDIS_URL；
// stg、prod 下连接串只认 *_FILE）。Redis 用不到，只是 loadEnv 要它在。做什么、退出码见 seed-command.ts。
// 整套本地环境的 pnpm stack:up 与预发的节点步骤 seed（W2-25）跑的都是这一条。
import { runSeedCommand } from "./seed-command.js";

/** 构建时由 build.mjs 写入；没经构建直接跑时是 dev */
declare const __LYX_VERSION__: string | undefined;

runSeedCommand({ version: typeof __LYX_VERSION__ === "string" ? __LYX_VERSION__ : "dev" }).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `播种失败：${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`,
    );
    process.exitCode = 2;
  },
);
