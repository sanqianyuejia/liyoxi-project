# 狸有戏 · server 镜像（D7 第 7.4 节；W1-22）。镜像名 liyoxi/server。api、worker、迁移、播种用同一个镜像：
# 四者永远是同一份代码与同一份 Prisma schema。入口见 README.md 第 2 节。
#
# 构建上下文是仓库根（要锁文件、两个应用与各包的源码、字体）：
#   docker build -f infra/docker/server/Dockerfile --build-arg LYX_BUILD=<构建号> -t liyoxi/server:<标签> .
# 平常不直接敲：pnpm stack:build。上下文里放行哪些路径写在同目录的 Dockerfile.dockerignore（白名单）。
# 里面有：两个应用的构建产物（@liyoxi/* 已内联）、生产依赖（含 prisma 命令行）、packages/db/prisma（schema 与迁移）、
# 三个静态中文字体、PGDG 源的 PostgreSQL 17 客户端（pg_dump、psql）、age。不含 ffmpeg（在 mediatool 镜像里）、
# 不含 pnpm 与源码、不含任何密钥与 .env。运行时的约束（根只读、/tmp 内存盘、--init）由 Compose 套上。

# 基础镜像固定到摘要，与 mediatool 的是同一个（infra/docker/mediatool/Dockerfile）：Node 24.21.0，Debian 12。
# 升级时两处一起改，改完重跑 pnpm mediatool:verify 与 pnpm stack:build && pnpm stack:up && pnpm stack:smoke。
FROM node:24-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS sys

# pg_dump 的主版本要 ≥ 数据库的主版本，否则拒绝执行；Debian 12 自带的客户端是 15，所以装 PGDG 的。
# 主版本写在这里，小版本不钉：PGDG 的源里只留最新的小版本，钉了每个季度都要改。构建完当场核对主版本，
# node infra/stack/smoke.mjs --image-only 再拿它与 infra/compose/local.yml 里数据库的主版本比一次。
ARG PG_MAJOR=17
# PGDG 软件源的签名公钥（https://www.postgresql.org/media/keys/ACCC4CF8.asc，取数 2026-10-06）的 sha256。
# PGDG 给公钥延期后这里会对不上，构建失败：核对新公钥的指纹（B97B 0AFC AA1A 47F0 44F2 44A0 7FCC 7D46 ACCC 4CF8）后改这一行。
ARG PGDG_ASC_SHA256=0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76

# 软件源走 HTTPS，系统根证书用 Node 自带的那一份，装完即删，软件源文件改回原样（做法与理由同 mediatool 的 Dockerfile）。
RUN set -eux; \
    node -e 'require("node:fs").writeFileSync("/tmp/node-ca.pem", require("node:tls").rootCertificates.join("\n"))'; \
    cp /etc/apt/sources.list.d/debian.sources /tmp/debian.sources.orig; \
    sed -i 's|http://deb.debian.org|https://deb.debian.org|' /etc/apt/sources.list.d/debian.sources; \
    PGDG_ASC_SHA256="${PGDG_ASC_SHA256}" node -e 'fetch("https://www.postgresql.org/media/keys/ACCC4CF8.asc").then(async (r) => { if (!r.ok) throw new Error("取 PGDG 公钥：HTTP " + r.status); const key = Buffer.from(await r.arrayBuffer()); const sum = require("node:crypto").createHash("sha256").update(key).digest("hex"); if (sum !== process.env.PGDG_ASC_SHA256) throw new Error("PGDG 公钥的 sha256 对不上：" + sum); require("node:fs").writeFileSync("/tmp/pgdg.asc", key); }).catch((e) => { console.error(e.message); process.exit(1); })'; \
    . /etc/os-release; \
    echo "deb [signed-by=/tmp/pgdg.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
    apt-get -o Acquire::https::CAInfo=/tmp/node-ca.pem -o Acquire::Retries=3 update; \
    apt-get -o Acquire::https::CAInfo=/tmp/node-ca.pem -o Acquire::Retries=3 install -y --no-install-recommends "postgresql-client-${PG_MAJOR}" age; \
    cp /tmp/debian.sources.orig /etc/apt/sources.list.d/debian.sources; \
    rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/pgdg.list /tmp/node-ca.pem /tmp/pgdg.asc /tmp/debian.sources.orig; \
    pg_dump --version | grep -E "^pg_dump \(PostgreSQL\) ${PG_MAJOR}\."; \
    psql --version; \
    age --version


# ---- 装依赖用的公共底座：pnpm（版本取 package.json 的 packageManager）与各包的清单。不进最终镜像 ----
FROM sys AS pnpm
# 要换 npm 源时传 --build-arg NPM_CONFIG_REGISTRY=<地址>（pnpm stack:build 读环境变量 LYX_NPM_REGISTRY）。
# 装的仍是锁文件里的版本，逐个按锁文件里的校验和核对。
ARG NPM_CONFIG_REGISTRY=
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_store_dir=/pnpm/store
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# 根清单里的 prepare（装提交钩子）在镜像里用不上，也跑不了（不装根上的开发依赖）：只在这一层里拿掉
RUN set -eux; \
    npm pkg delete scripts.prepare; \
    if [ -n "${NPM_CONFIG_REGISTRY}" ]; then export COREPACK_NPM_REGISTRY="${NPM_CONFIG_REGISTRY}"; fi; \
    corepack enable; \
    corepack install; \
    pnpm --version
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/contract/package.json packages/contract/
COPY packages/db/package.json packages/db/
COPY packages/services/package.json packages/services/
COPY packages/shared/package.json packages/shared/


# ---- 构建：两个应用连同它们依赖的工作区包（带开发依赖）→ 生成数据库客户端 → 出两份产物 ----
FROM pnpm AS build
RUN --mount=type=cache,id=lyx-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@liyoxi/api..." --filter "@liyoxi/worker..."
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/worker/ apps/worker/
# 构建号写进产物：api 读 LYX_BUILD（/health 的 version），worker 读 LYX_BUILD_VERSION（租约的 holder_version）。
# 上下文里没有 .git，不给就是 dev。
ARG LYX_BUILD=dev
RUN set -eux; \
    export LYX_BUILD="${LYX_BUILD}" LYX_BUILD_VERSION="${LYX_BUILD}"; \
    pnpm db:generate; \
    pnpm --filter @liyoxi/api build; \
    pnpm --filter @liyoxi/worker build


# ---- 生产依赖：api、worker、db 三个包的 dependencies，不带开发依赖 ----
FROM pnpm AS deps
# prisma 命令行是 @prisma/client 的对等依赖，装生产依赖时已经跟着装上，只是没有链进 packages/db/node_modules
#（它在 packages/db 里登记的是开发依赖）。prisma.config.ts 要从它自己的目录解析到 prisma/config：
# 把与 @prisma/client 配套的那一份链过去，不另装第二份。链接写成相对路径，整个目录换个位置照样有效。
# 末尾删掉指向工作区包的链接：那些包已经内联进产物，镜像里没有它们的目录。
RUN --mount=type=cache,id=lyx-pnpm-store,target=/pnpm/store \
    set -eux; \
    pnpm install --frozen-lockfile --prod --filter @liyoxi/api --filter @liyoxi/worker --filter @liyoxi/db; \
    node -e 'const fs = require("node:fs"); const path = require("node:path"); const dir = "packages/db/node_modules"; const client = fs.realpathSync(path.join(dir, "@prisma/client")); const cli = fs.realpathSync(path.join(client, "..", "..", "prisma")); fs.symlinkSync(path.relative(dir, cli), path.join(dir, "prisma")); console.log("prisma 命令行：" + require(path.join(cli, "package.json")).version);'; \
    rm -rf apps/api/node_modules/@liyoxi apps/worker/node_modules/@liyoxi; \
    test -x packages/db/node_modules/prisma/build/index.js


# ---- 最终镜像 ----
FROM sys AS server
# LYX_PDF_FONT_DIR：授权书渲染读的字体目录（ADR-042；与 spikes/license-pdf 同名，G5-B 接 loadEnv 时沿用）。
# 后两个变量让 prisma 命令行不联网查更新、不打印升级提示。
ENV NODE_ENV=production \
    LYX_PDF_FONT_DIR=/app/fonts \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app
COPY --from=deps /repo/node_modules/ node_modules/
COPY --from=deps /repo/apps/api/node_modules/ apps/api/node_modules/
COPY --from=deps /repo/apps/worker/node_modules/ apps/worker/node_modules/
COPY --from=deps /repo/packages/db/node_modules/ packages/db/node_modules/
# 三份清单留在镜像里：产物是 ESM，要靠最近的 package.json 里的 "type": "module" 才按 ESM 加载
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma/ packages/db/prisma/
COPY --from=build /repo/apps/api/dist/ apps/api/dist/
COPY --from=build /repo/apps/worker/dist/ apps/worker/dist/
# 字体：三个 TTF 与两份许可文本（infra/docker/server/fonts/README.md）
COPY infra/docker/server/fonts/*.ttf infra/docker/server/fonts/OFL-*.txt fonts/
# prisma 放到 PATH 上：docker run --rm -w /app/packages/db <镜像> prisma migrate deploy。
# /work 是与 mediatool 共享的目录的挂载点：属主与 mediatool 镜像里的一致（1000:1000，基础镜像自带的 node 用户），
# 命名卷不论先挂到哪一边，沿用到的属主都一样。
RUN set -eux; \
    ln -s /app/packages/db/node_modules/prisma/build/index.js /usr/local/bin/prisma; \
    mkdir -p /work; \
    chown 1000:1000 /work; \
    chmod 0770 /work

USER 1000:1000
# 缺省起 api；worker、迁移、播种、环境变量自检各自给命令（README.md 第 2 节）
CMD ["node", "apps/api/dist/server.js"]
