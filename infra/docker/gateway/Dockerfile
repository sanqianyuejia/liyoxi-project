# 狸有戏 · gateway 镜像（D7 第 7.2、7.4 节；W1-22）。镜像名 liyoxi/gateway。
# 里面有：nginx、后台与下载页当前版本的静态产物（入口页与带哈希的资源）、站点模板与渲染脚本（infra/docker/nginx/）。
#
# 构建上下文是仓库根（要锁文件、两个前端与它们依赖的工作区包）：
#   docker build -f infra/docker/gateway/Dockerfile --build-arg LYX_BUILD=<构建号> -t liyoxi/gateway:<标签> .
# 平常不直接敲：pnpm stack:build。上下文放行哪些路径写在同目录的 Dockerfile.dockerignore（白名单）。
# 运行时的约束（非 root、根只读、/tmp 内存盘）由 Compose 套上；变量与站点的说明见 infra/docker/nginx/ 下各文件开头。

# 构建阶段的基础镜像与 server、mediatool 的是同一个摘要（Node 24.21.0）
FROM node:24-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
# 要换 npm 源时传 --build-arg NPM_CONFIG_REGISTRY=<地址>；装的仍是锁文件里的版本，按锁文件里的校验和核对
ARG NPM_CONFIG_REGISTRY=
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_store_dir=/pnpm/store
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# 根清单里的 prepare（装提交钩子）在镜像里用不上：只在这一层里拿掉。pnpm 的版本取 package.json 的 packageManager
RUN set -eux; \
    npm pkg delete scripts.prepare; \
    if [ -n "${NPM_CONFIG_REGISTRY}" ]; then export COREPACK_NPM_REGISTRY="${NPM_CONFIG_REGISTRY}"; fi; \
    corepack enable; \
    corepack install; \
    pnpm --version
COPY apps/admin/package.json apps/admin/
COPY apps/portal/package.json apps/portal/
COPY packages/config/package.json packages/config/
COPY packages/contract/package.json packages/contract/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=lyx-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@liyoxi/admin..." --filter "@liyoxi/portal..."
COPY packages/config/ packages/config/
COPY packages/contract/ packages/contract/
COPY packages/shared/ packages/shared/
COPY apps/admin/ apps/admin/
COPY apps/portal/ apps/portal/
# 构建号写进入口页的 <meta name="lyx-build">、代码与 build.json。上下文里没有 .git，不给就是 dev。
# 两个 build 脚本各自带产物检查：文件名带内容哈希、写入了构建号、是生产构建、不含夹具
ARG LYX_BUILD=dev
RUN set -eux; \
    export LYX_BUILD="${LYX_BUILD}"; \
    pnpm --filter @liyoxi/admin build; \
    pnpm --filter @liyoxi/portal build


# 基础镜像固定到摘要。多架构清单的摘要，amd64 与 arm64 共用；取自 Docker Hub 官方库（2026-10-06）：
#   docker buildx imagetools inspect nginx:stable-alpine
# 内容：nginx 1.30.5，Alpine。升级：改摘要，重跑 pnpm stack:build && pnpm stack:up && pnpm stack:smoke。
FROM nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 AS gateway
# 官方镜像自带的缺省站点不要；它的入口脚本照用：按文件名顺序执行 /docker-entrypoint.d/ 下的脚本，再起 nginx
RUN rm -f /etc/nginx/conf.d/default.conf
COPY infra/docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/docker/nginx/proxy.inc /etc/nginx/lyx/proxy.inc
COPY infra/docker/nginx/templates/ /etc/nginx/lyx-templates/
COPY infra/docker/nginx/40-lyx-render.sh /docker-entrypoint.d/40-lyx-render.sh
# 静态产物：入口页与 /assets/ 都在镜像里。节点上滚动发布时 /assets/ 另由宿主机目录盖上（D7 第 7.4 节“静态资源”，W2-25）
COPY --from=build /repo/apps/admin/dist/app/ /usr/share/nginx/admin/
COPY --from=build /repo/apps/portal/dist/app/ /usr/share/nginx/portal/

# 基础镜像自带的 nginx 用户（101:101）。不是 root 就绑不了 1024 以下的端口：听 8080
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=2s --retries=6 CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/_gateway/healthz"]
