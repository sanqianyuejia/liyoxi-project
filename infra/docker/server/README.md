# server 镜像

`liyoxi/server`：api、worker、迁移、播种、环境变量自检用同一个镜像，四者永远是同一份代码与同一份 Prisma schema（[D7](../../../docs/appendix/design/d7-platform.md) 第 7.4 节）。W1-22 交付第一版；预发照用（W2-25）。

## 1. 怎么构建

```sh
pnpm stack:build   # 连同 gateway、mediatool 一起；标签 :local
# 或单独构建。上下文是仓库根：
docker build -f infra/docker/server/Dockerfile --build-arg LYX_BUILD=<构建号> -t liyoxi/server:<标签> .
```

- 上下文是白名单（`Dockerfile.dockerignore`）：只有锁文件与根上三份清单、`apps/api`、`apps/worker`、`packages/`、`fonts/` 进得来；没有 `.git`、`docs/`、任何 `node_modules`、`dist`、`.env`。Dockerfile 要从上下文拷新的路径，先在白名单里放行（`infra/ci/test/stack.test.ts` 会核对）。
- 构建号经 `LYX_BUILD` 传入，写进两个应用的产物（`/health` 的 `version`、租约的 `holder_version`）。`pnpm stack:build` 给的是 `sha-<12 位提交号>`，工作区有没提交的改动时带 `-dirty`。
- 四个阶段：`sys`（基础镜像加系统包）→ `pnpm`（装依赖用的公共底座）→ `build`（装全量依赖、生成数据库客户端、出两份产物）与 `deps`（只装三个包的生产依赖）→ 最终镜像只从 `build` 拷产物、从 `deps` 拷依赖。
- 基础镜像 `node:24-slim` 固定到摘要，与 mediatool 的是同一个。系统包：PGDG 源的 `postgresql-client-17`（主版本写死、小版本不钉，构建完核对主版本）、Debian 的 `age`。PGDG 的签名公钥按 sha256 核对。
- 换 npm 源：`--build-arg NPM_CONFIG_REGISTRY=<地址>`（`pnpm stack:build` 读 `LYX_NPM_REGISTRY`）。

## 2. 里面有什么，怎么跑

工作目录 `/app`，用户 `node`（1000:1000）。运行时的约束由 Compose 套上：根只读、`/tmp` 内存盘、去掉全部能力、`init: true`（写法见 `infra/compose/stack.yml`）。

| 要做什么 | 命令 |
| --- | --- |
| api | `node apps/api/dist/server.js --port 3000`（镜像的缺省命令，端口缺省 3000） |
| worker | `node apps/worker/dist/index.js`；只做装配与自检：加 `--check`（要连跑过迁移的库） |
| 环境变量自检 | `node apps/api/dist/check-env.js`（只读环境变量，不连库） |
| 迁移 | 工作目录换成 `/app/packages/db`：`prisma migrate deploy`（连接串只取 `DATABASE_URL`） |
| 播种 | `node apps/worker/dist/seed.js`：没有才插、已有的行不改，播完跑六条配置类断言；退出码同 `pnpm db:seed`（0、1、2） |
| 逻辑备份、加密 | `pg_dump`（17）、`psql`、`age` 在 PATH 上 |

| 路径 | 内容 |
| --- | --- |
| `apps/api/dist`、`apps/worker/dist` | 两个应用的构建产物，`@liyoxi/*` 已内联 |
| `node_modules`、`apps/*/node_modules`、`packages/db/node_modules` | 三个包的生产依赖。`prisma` 命令行是 `@prisma/client` 的对等依赖，跟着装上；链到 `packages/db/node_modules` 与 `/usr/local/bin/prisma` |
| `packages/db/prisma`、`prisma.config.ts` | schema 与迁移。连接串只取 `DATABASE_URL` |
| `fonts/` | 三个 TTF 与两份许可文本（[fonts/README.md](fonts/README.md)）；目录在环境变量 `LYX_PDF_FONT_DIR` 里 |
| `/work` | 与 mediatool 共享的目录的挂载点，属主 1000:1000 |

没有的：ffmpeg（在 mediatool 镜像里）、pnpm、源码、任何密钥与 `.env`。环境变量只有 `loadEnv` 读的那几个（`packages/services/src/kernel/env.ts`），由 Compose 给。

## 3. 怎么验

```sh
node infra/stack/smoke.mjs --image-only   # 只看镜像的内容，不要整套环境在跑
pnpm stack:up && pnpm stack:smoke         # 整套：迁移与播种就是用这个镜像的一次性容器跑的
```

升级基础镜像（与 mediatool 的摘要一起改）、改系统包之后重跑上面两条与 `pnpm mediatool:verify`。
