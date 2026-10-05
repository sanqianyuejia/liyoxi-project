// 引导命令的镜像内入口（W1-01a）：node apps/worker/dist/staff-bootstrap.js --name <姓名> --phone <手机号>
// 库要先跑完迁移与播种（角色与默认组）。环境变量只经 loadEnv 读（APP_ENV、DATABASE_URL、REDIS_URL 与三份密钥文件的路径；
// stg、prod 下连接串只认 *_FILE）。Redis 用不到，只是 loadEnv 要它在。做什么、退出码见 staff-bootstrap-command.ts。
import { runStaffBootstrapCommand } from "./staff-bootstrap-command.js";

/** 构建时由 build.mjs 写入；没经构建直接跑时是 dev */
declare const __LYX_VERSION__: string | undefined;

runStaffBootstrapCommand({
  version: typeof __LYX_VERSION__ === "string" ? __LYX_VERSION__ : "dev",
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `引导失败：${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`,
    );
    process.exitCode = 2;
  },
);
