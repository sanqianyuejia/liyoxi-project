// 环境变量自检（D7 第 7.4、7.5 节）：发布时在起新版本之前用新镜像跑一遍，只读环境变量，不连库。
// node apps/api/dist/check-env.js：通过退出码 0；不通过逐条打出“键名: 原因”（不带任何值），退出码 1。
import { EnvError, loadEnv } from "@liyoxi/services";

try {
  const env = loadEnv();
  console.error(`环境变量校验通过（APP_ENV=${env.APP_ENV}）`);
} catch (error) {
  if (!(error instanceof EnvError)) throw error;
  console.error(error.message);
  process.exit(1);
}
