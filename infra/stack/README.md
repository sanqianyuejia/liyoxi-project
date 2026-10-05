# 本地整套环境

本机一条命令起一套“像预发一样”的环境：gateway（nginx，听 8080）→ api，worker 与无网络的 mediatool 共用一个卷；库、Redis、对象存储用 `infra/compose/local.yml` 那一份共享实例。W1-22 交付。依据：[01](../../docs/01-architecture.md) 第 11 节；[D7](../../docs/appendix/design/d7-platform.md) 第 7.2、7.4 节；[约定](../../docs/api/00-conventions.md) C1；任务书 `docs/plan/tasks/W1-22.md`。

预发照用这里的三个镜像与 gateway 模板，节点上的 Compose、密钥文件、推镜像仓库归 W2-25。

## 1. 这里有什么

| 路径 | 内容 |
| --- | --- |
| `infra/compose/stack.yml` | 整套环境的 Compose：项目名 `liyoxi-stack`，四个容器 `lyx-gateway`、`lyx-api`、`lyx-worker`、`lyx-mediatool`，另有迁移、播种两个一次性容器 |
| `infra/stack/up.mjs` | 构建、起、停（`pnpm stack:build`、`stack:up`、`stack:down`） |
| `infra/stack/smoke.mjs` | 冒烟（`pnpm stack:smoke`） |
| `infra/stack/lib.mjs` | 两个脚本共用的：名字与取值、跑 docker、库名的守卫 |
| `infra/stack/lan.yml` | `--lan` 时叠在 `stack.yml` 上的那一份 |
| `infra/docker/server/` | server 镜像（api、worker、迁移、播种同一个镜像）。见那里的 [README](../docker/server/README.md) |
| `infra/docker/gateway/`、`infra/docker/nginx/` | gateway 镜像；nginx 的主配置、站点模板、渲染脚本 |
| `infra/docker/mediatool/` | mediatool 镜像，X-02 的那一份，原样用 |
| `infra/ci/test/stack.test.ts` | 脚本的用例（`docker` 桩掉）与三份 Compose、镜像定义的写法核对，在 `pnpm test` 的 `infra` 项目里 |

## 2. 怎么用

本机要有 Docker。脚本只用 Node 自带模块，不用先装依赖。

```sh
pnpm stack:build   # 出三个镜像 liyoxi/{server,gateway,mediatool}:local，三个同时构建。第一次要下载，十来分钟
pnpm stack:up      # 依赖没起先起 → 镜像不在先构建 → 建库 lyx_stack → 迁移 → 播种 → 四个容器都健康才返回
pnpm stack:smoke   # 冒烟
pnpm stack:down    # 只停这四个容器；卷与库保留，依赖的三个容器不动
```

起来之后：

| 地址 | 是什么 |
| --- | --- |
| `http://admin.localhost:8080` | 后台（M1 的登录包合并前是外壳） |
| `http://portal.localhost:8080` | 下载页 |
| `http://api.localhost:8080` | 小程序与回调的接口面；探活 `/healthz`、`/readyz`、`/health` |

- 浏览器把 `*.localhost` 解析到本机。命令行里不一定：`curl -H "Host: api.localhost" http://127.0.0.1:8080/healthz`。
- `pnpm stack:up` 可以反复跑：迁移没有待执行的就什么都不做，播种只插缺的行。改了代码要看效果：`pnpm stack:up --build`（重建镜像，再把容器换成新的）。
- `pnpm stack:down --reset`：另删库 `lyx_stack`、共享卷与本环境在 Redis 里的键，下次从空库开始。库名不以 `lyx_` 开头，或是两个校验库、测试库，拒绝执行。
- `/health` 现在回 503：探针循环 M2 才有（`probeAgeSec` 是 `null`）。响应体里 `worker` 是 `ok` 即 worker 持有租约。
- 整套只起一份：容器名写死，哪个 worktree 里起的都是同一套；换了 worktree 想跑自己的代码就 `pnpm stack:up --build`。

可调的环境变量（都可以不设）：

| 变量 | 缺省 | 做什么 |
| --- | --- | --- |
| `LYX_STACK_PORT` | `8080` | gateway 发布到宿主机的端口。8080 被占时换一个 |
| `LYX_STACK_DB` | `lyx_stack` | 用哪个库 |
| `LYX_STACK_TAG` | `local` | 三个镜像的标签 |
| `LYX_NPM_REGISTRY` | 不设 | 构建镜像时换 npm 源（装的仍是锁文件里的版本，按锁文件的校验和核对） |

## 3. 与共享的本地依赖怎么相处

- 另一个 Compose 项目，接在 `local.yml` 那个项目的网络 `liyoxi_default` 上，按容器名连 `lyx-postgres`、`lyx-redis`、`lyx-minio`。`pnpm stack:down` 不动它们；本包的脚本不调 `infra:down`。
- 库用 `lyx_stack`，不碰 `liyoxi`（留给手工开发）、`lyx_schema_check`、`lyx_migrate_check`。
- Redis 用 1 号库，键前缀照 `APP_ENV=local` 的缺省（`lyx:local:`）。手工开发在 0 号库上用同样的前缀：分开库号，两边的 worker 才不会互相领对方队列里的任务。`--reset` 只清 1 号库里这个前缀下的键（SCAN 加 UNLINK），不用 FLUSHDB。
- 口令只有 `local.yml` 那一组公开的开发值。api、worker 拿到的环境变量就是 `loadEnv` 读的那几个，没有密钥文件。
- 只有 gateway 发布端口，缺省只绑回环地址。

## 4. 真机走局域网

```sh
pnpm stack:up --lan
```

gateway 改绑全部网卡；按 IP 进来的请求（Host 不是三个域名）全部转 api（本地模板 `infra/docker/nginx/lan.conf.template`，不在镜像里）；另开 9110 端口把请求原样转给 MinIO（Host 不改写，预签名才验得过；端口可用 `LYX_STACK_MINIO_PORT` 换）。开发者工具与手机用 `http://<本机局域网地址>:8080`。

口令是公开的开发值：只在可信的局域网里开，用完 `pnpm stack:up`（不带 `--lan`）收回。带着 `--lan` 起的环境，冒烟写 `node infra/stack/smoke.mjs --lan`。演示手册怎么用它归 W1-21。

## 5. 冒烟查什么

`pnpm stack:smoke` 三段都跑，有一条不通过即以 1 退出，逐条打印看到的值：

| 段 | 内容 | 单独跑 |
| --- | --- | --- |
| 镜像 | server 镜像里 `pg_dump` 的主版本与 `local.yml` 的 PostgreSQL 相同、`age` 可跑、三个 TTF 的 sha256 与[字体目录的表](../docker/server/fonts/README.md)一致、没有 ffmpeg、运行用户不是 root、缺必填变量时 `worker --check` 与 `check-env` 非 0、`prisma` 可跑 | `node infra/stack/smoke.mjs --image-only`（不要整套环境在跑，不连库） |
| 经网关 | 探活；后台与下载页的入口页不缓存、带安全头，引用的 `/assets/` 文件 200 且长缓存；域名与接口面不配的组合由 gateway 回 404；请求体超 2MB（回调超 1MB）得 413；从 worker 容器经共享卷里的套接字问 mediatool；给全变量的 `worker --check` 以 0 退出 | — |
| 约束 | mediatool 的十三项与 `infra/docker/mediatool/compose.verify.yml` 的写法一致（期望值从那个文件读），另核对没用交换区；api、worker、gateway 非 root、根只读；只有 gateway 发布端口且只绑回环 | `node infra/stack/smoke.mjs --inspect-only` |

CI：`.github/workflows/stack-smoke.yml`，改到镜像定义、Compose、这里的脚本、两个服务端应用或迁移的 PR 与推到 main 时跑，不是必过检查。

## 6. gateway 的模板

站点在 `infra/docker/nginx/templates/gateway.conf.template`，容器启动时由 `40-lyx-render.sh` 渲染到 `/tmp/nginx/conf.d/`（根文件系统只读），变量缺了、写错了当场失败。

| 变量 | 本地填什么 | 说明 |
| --- | --- | --- |
| `API_HOST`、`ADMIN_HOST`、`PORTAL_HOST` | `api.localhost` 等 | 三个域名。预发填 `*.stg.liyoxi.timavia.com` |
| `API_UPSTREAM` | `lyx-api:3000` | api 的地址。每次按容器的 DNS 重新解析，api 容器重建不用重启 gateway |
| `TRUSTED_PROXY_CIDRS` | 共享网络的网段（`up.mjs` 现查） | 只信这些来源带来的 `X-Forwarded-For`；不给即不信任何转发头。预发填负载均衡的转发源网段（实测后填，D7 第 7.2 节） |
| `MEDIA_ORIGINS` | `http://localhost:9100` | 对象存储与 CDN 的源，写进静态页的 CSP；可不给 |

- 按域名隔离接口面：api 域名只放行 `/api/v1/m/`、`/api/v1/hooks/` 与三条探活；后台域名放行静态资源与 `/api/v1/admin/`；下载页域名放行静态资源与 `/api/v1/portal/`。其余组合 404，不转给 api。Host 不是三个域名的只给 `/healthz`、`/readyz`（负载均衡按节点地址探活）与 gateway 自己的 `/_gateway/healthz`。
- 请求体上限 2MB（回调 1MB）；反代读超时 35 秒；`/assets/` 长缓存，入口页不缓存；安全响应头只加在静态资源上（接口的由 api 设）；访问日志一行一条 JSON，只记路径不记查询串，`request_id` 与 api 日志里的是同一个。
- 静态产物都在镜像里。节点上滚动发布时 `/assets/` 另由宿主机目录盖上（D7 第 7.4 节“静态资源”），那是 W2-25 的事：挂到 `/usr/share/nginx/{admin,portal}/assets` 即可，模板不用改。
- 没有做的：HSTS（等 TLS 落地，W2-25）、停机维护的 503（约定 C72）、后台域名的来源 IP 白名单（Q9）。

## 7. 已知的限度

- 容器的重启策略是 `on-failure`：进程自己退出（看门狗、崩溃）会被拉起；Docker 重启之后不自己起来（依赖的三个容器也不会），要再跑一遍 `pnpm stack:up`。mediatool 的 README 第 3 节写的是 `unless-stopped`，这里没有照抄这一行。
- worker 容器的健康检查看的是租约那一行的心跳（60 秒之内）：进程起来并抢到租约才算健康。只在本地这样写，预发的节点上进程由 systemd 管（D7 第 7.4 节）。
- mediatool 的调用端还没有挂到媒体任务上（G3-A）：冒烟只验容器健康、约束与套接字连得上。
- 对象存储的桶、预签名用的对外地址还没有接进 `loadEnv`：`--lan` 的 MinIO 透传现在只有通道，等存储接线的包用。
- 镜像只在本机构建成本机的架构；多架构与推仓库归 W2-25。
