#!/usr/bin/env bash
# 狸有戏 · 预发节点步骤（ADR-041“决定”第 4.7 节；D7 第 8.2 节）。W2-25 交基础的几步，发布编排用的由 W2-26 接着补。
# 每一步都可以重跑。节点上以 root 执行；发布用户经受限 SSH 进来时只能执行本脚本（见文末“经 SSH”）。
#
# 用法：node-step.sh <步骤> [参数]
#   deps               起库与 Redis 两个容器，等到健康（首次起环境时排在 db-init.sh 之前；已经起着就什么都不做）
#   pull <标签>        拉这个版本的镜像。没配镜像仓库前缀（LYX_IMAGE_PREFIX 为空）时是本地镜像：只核对镜像在，不拉
#   check-env <标签>   密钥文件齐备检查 → 用这个版本的镜像跑环境变量自检（不连库）
#   migrate <标签>     一次性容器跑 prisma migrate deploy（迁移账号）
#   seed <标签>        一次性容器播种（应用登录账号）：没有才插；播完跑六条配置类断言，有违规即以 1 退出
#   up <标签>          记下“现在跑这个版本”，起（换）六个容器，等到都在跑且健康
#   status             六个容器的状态与版本、经 gateway 的探活、worker 是否持有租约；有一项不对即非 0
#   verify-db <标签>   库的核对：库名、两个扩展、应用连库用的是登录账号而不是属主、角色与授权
#  下面三个给 systemd 单元用（infra/deploy/systemd/），不经 SSH：
#   run <服务>         前台起一个服务（docker compose up --no-deps），容器退出即返回
#   stop <服务>        停一个服务（按 Compose 里的 stop_grace_period 等它收尾）
#   wait <服务>...     等这些服务的容器在跑且健康，最多 90 秒
# 发布的顺序：pull → check-env → migrate → seed → up → status（→ verify-db）。前一步非 0 就不要往下跑。
# 标签是镜像标签（sha-<12 位提交号>）。up 之前的几步用参数给的标签起一次性容器，不动正在跑的；
# 只有 up 把它写进 $LYX_NODE_HOME/release.env，systemd 重启容器时读的就是这个文件。
#
# 环境变量（都可以不设，见 lib.sh）：LYX_NODE_HOME、LYX_SECRETS_DIR、LYX_NODE_PREFIX、LYX_NODE_PROJECT；另有
#   LYX_NODE_SUPERVISOR  谁管容器的生命周期：systemd（缺省，节点上）或 compose（本机演练：直接 docker compose up -d）
#   LYX_IMAGE_PREFIX     镜像仓库前缀（以 / 结尾），缺省取 $LYX_NODE_HOME/node.env 里的；空 = 本地镜像
# 非敏感配置读 infra/compose/env/stg.env；同名的环境变量优先（演练用它换端口、网段、域名）。
# 经 SSH：发布用户的 authorized_keys 里写 command="<本脚本>"，步骤与参数取自 SSH_ORIGINAL_COMMAND，按空白切开、
#   逐个核对（步骤在上面第一组之内，标签只许字母、数字、点、下划线、连字符），不经 shell 解释；
#   然后经 sudo 以 root 重新执行本脚本（sudoers 只放行这一个脚本，节点初始化时写好）。
# 退出码：0 成功；1 这一步没成（seed 是它自己的退出码：1 有违规，2 环境不对或连不上库）；2 用法或环境不对。
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"

SELF="$LYX_SRC/infra/deploy/node-step.sh"
STG_ENV="$LYX_SRC/infra/compose/env/stg.env"
NODE_ENV="$LYX_NODE_HOME/node.env"
RELEASE_ENV="$LYX_NODE_HOME/release.env"
COMPOSE_FILE="$LYX_SRC/infra/compose/node.yml"
SUPERVISOR="${LYX_NODE_SUPERVISOR:-systemd}"
SERVICES="postgres redis mediatool api worker gateway"
PUBLIC_STEPS="deps pull check-env migrate seed up status verify-db"
USAGE="用法：node-step.sh deps | pull <标签> | check-env <标签> | migrate <标签> | seed <标签> | up <标签> | status | verify-db <标签>"

via_ssh=0
if [ $# -eq 0 ] && [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
  via_ssh=1
  read -r -a argv <<<"$SSH_ORIGINAL_COMMAND"
  set -- ${argv[@]+"${argv[@]}"}
fi
[ $# -ge 1 ] || usage_die "$USAGE"
step="$1"
shift

in_list() { case " $2 " in *" $1 "*) return 0 ;; esac; return 1; }
need_tag() {
  [ $# -eq 1 ] || usage_die "$step 后面要跟一个镜像标签。$USAGE"
  [[ "$1" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || usage_die "镜像标签只许字母、数字、点、下划线、连字符"
}
need_services() {
  [ $# -ge 1 ] || usage_die "$step 后面要跟服务名：$SERVICES"
  for one in "$@"; do in_list "$one" "$SERVICES" || usage_die "不认识的服务 $one。服务有：$SERVICES"; done
}
case "$step" in
  deps | status) [ $# -eq 0 ] || usage_die "$step 不带参数。$USAGE" ;;
  pull | check-env | migrate | seed | up | verify-db) need_tag "$@" ;;
  run | stop)
    need_services "$@"
    [ $# -eq 1 ] || usage_die "$step 只跟一个服务名"
    ;;
  wait) need_services "$@" ;;
  *) usage_die "不认识的步骤 $step。$USAGE" ;;
esac
if [ "$via_ssh" = 1 ]; then
  in_list "$step" "$PUBLIC_STEPS" || usage_die "经 SSH 只能跑：$PUBLIC_STEPS"
  if [ "$(id -u)" != 0 ]; then exec sudo -n -- "$SELF" "$step" "$@"; fi
fi
case "$SUPERVISOR" in systemd | compose) ;; *) usage_die "LYX_NODE_SUPERVISOR 只能是 systemd 或 compose" ;; esac
[ -r "$STG_ENV" ] || usage_die "读不了 infra/compose/env/stg.env"

# 取一项非敏感配置：环境变量优先，其次节点上的 node.env，再次 stg.env
setting() {
  local key="$1" file
  if [ -n "${!key+x}" ]; then
    printf '%s' "${!key}"
    return
  fi
  for file in "$NODE_ENV" "$STG_ENV"; do
    if [ -r "$file" ] && grep -q "^$key=" "$file"; then
      sed -n "s/^$key=//p" "$file" | head -n 1 | tr -d '\n'
      return
    fi
  done
}
current_tag() { [ -r "$RELEASE_ENV" ] && sed -n 's/^LYX_TAG=//p' "$RELEASE_ENV" | head -n 1; }
container() { printf '%s-%s' "$LYX_NODE_PREFIX" "$1"; }

# docker compose 的公共参数，放进 COMPOSE_ARGS：变量替换的来源是 stg.env、节点上的 node.env（有才带）与当前环境
COMPOSE_ARGS=()
compose_args() {
  COMPOSE_ARGS=(compose -p "$LYX_NODE_PROJECT" --env-file "$STG_ENV")
  if [ -f "$NODE_ENV" ]; then COMPOSE_ARGS+=(--env-file "$NODE_ENV"); fi
  COMPOSE_ARGS+=(-f "$COMPOSE_FILE")
}
# compose <标签> <参数…>
compose() {
  local tag="$1"
  shift
  compose_args
  LYX_TAG="$tag" docker "${COMPOSE_ARGS[@]}" "$@"
}
# 一次性容器：不带依赖、不要终端，跑完即删
one_off() {
  local tag="$1" service="$2"
  compose "$tag" run --rm --no-deps -T "$service"
}

# 等容器在跑且健康（没有健康检查的只看在跑）：wait_healthy <秒数> <服务…>
wait_healthy() {
  local limit="$1" waited=0 one state pending
  shift
  while :; do
    pending=""
    for one in "$@"; do
      state="$(docker inspect --type container -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$(container "$one")" 2>/dev/null)"
      case "$state" in "running healthy" | "running none") ;; *) pending="$pending $one（${state:-没有这个容器}）" ;; esac
    done
    [ -z "$pending" ] && return 0
    if [ "$waited" -ge "$limit" ]; then
      printf '等了 %s 秒还没好：%s\n' "$limit" "$pending" >&2
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
}

step_deps() {
  local tag
  tag="$(current_tag)"
  if [ "$SUPERVISOR" = systemd ]; then
    systemctl enable --now lyx-postgres.service lyx-redis.service || die "库与 Redis 的单元没起成：systemctl status lyx-postgres lyx-redis"
  else
    compose "${tag:-none}" up -d --no-deps postgres redis || die "库与 Redis 没起成"
  fi
  wait_healthy 90 postgres redis || die "库或 Redis 没有健康"
  say "库与 Redis 在跑且健康"
}

step_pull() {
  local tag="$1" prefix image
  prefix="$(setting LYX_IMAGE_PREFIX)"
  if [ -z "$prefix" ]; then
    for image in liyoxi/server liyoxi/gateway liyoxi/mediatool; do
      docker image inspect "$image:$tag" >/dev/null 2>&1 || die "没配镜像仓库前缀，本地又没有镜像 $image:$tag"
    done
    say "没配镜像仓库前缀：用本地镜像（标签 $tag），跳过拉取"
    return
  fi
  compose "$tag" pull || die "镜像没拉成（标签 $tag）：线上没有动"
  say "镜像已拉取：标签 $tag"
}

step_check_env() {
  "$LYX_SRC/infra/deploy/check-secrets.sh" || die "密钥文件不齐备：线上没有动"
  one_off "$1" check-env || die "环境变量自检没过（上面逐条是“键名: 原因”，不带值）：线上没有动"
  say "环境变量自检通过"
}

step_migrate() {
  wait_healthy 30 postgres || die "库没在运行：先 node-step.sh deps"
  one_off "$1" migrate || die "迁移没成：正在跑的容器没有动"
  say "迁移完成"
}

step_seed() {
  local code=0
  wait_healthy 30 postgres redis || die "库或 Redis 没在运行：先 node-step.sh deps"
  one_off "$1" seed || code=$?
  if [ "$code" != 0 ]; then
    printf '播种没过（退出码 %s：1 是配置类断言有违规，2 是环境不对或连不上库）：不要往下起容器\n' "$code" >&2
    exit "$code"
  fi
  say "播种完成，断言 0 违规"
}

step_up() {
  local tag="$1" one
  mkdir -p "$LYX_NODE_HOME"
  printf '# 现在该跑的版本：由 node-step.sh up 写，systemd 重启容器时读。不要手改。\nLYX_TAG=%s\n' "$tag" >"$RELEASE_ENV.tmp" &&
    mv -f "$RELEASE_ENV.tmp" "$RELEASE_ENV" || die "写不了 $RELEASE_ENV"
  if [ "$SUPERVISOR" = systemd ]; then
    systemctl enable --now lyx-postgres.service lyx-redis.service || die "库与 Redis 的单元没起成"
    wait_healthy 90 postgres redis || die "库或 Redis 没有健康"
    # 先 mediatool 与 worker，再 api 与 gateway（D7 第 8.2 节的先后）；重启即按 release.env 换成新版本
    for one in mediatool worker api gateway; do
      systemctl enable "lyx-$one.service" >/dev/null 2>&1
      systemctl restart "lyx-$one.service" || die "lyx-$one 的单元没起成：systemctl status lyx-$one"
    done
  else
    compose "$tag" up -d --remove-orphans || die "容器没起成"
  fi
  # shellcheck disable=SC2086
  wait_healthy 240 $SERVICES || die "六个容器没有都健康：node-step.sh status 看是哪个，docker logs 看原因"
  say "六个容器都在跑且健康：标签 $tag"
}

step_status() {
  local tag host bad=0 one row state health image path body tries=0
  tag="$(current_tag)"
  host="$(setting LYX_API_HOST)"
  printf '应该在跑的版本（release.env）：%s\n' "${tag:-还没有，up 过才有}"
  for one in $SERVICES; do
    row="$(docker inspect --type container -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}|{{.Config.Image}}' "$(container "$one")" 2>/dev/null)" || row="没有这个容器|-|-"
    IFS='|' read -r state health image <<<"$row"
    printf '  %-22s %-10s %-10s %s\n' "$(container "$one")" "$state" "$health" "$image"
    [ "$state" = running ] || bad=1
    case "$health" in healthy | -) ;; *) bad=1 ;; esac
    case "$one" in
      postgres | redis) ;;
      *) case "$image" in *":$tag") ;; *) bad=1 ;; esac ;;
    esac
  done
  [ "$bad" = 0 ] || die "status：有容器没在跑、不健康或版本不对（见上）"
  # 探活在 gateway 容器里发：带上接口域名的 Host，走的就是外面进来的那条路
  for path in /healthz /readyz; do
    if docker exec "$(container gateway)" curl -fsS -o /dev/null -m 5 -H "Host: $host" "http://127.0.0.1:8080$path" 2>/dev/null; then
      printf '  经 gateway %s%s：200\n' "$host" "$path"
    else
      printf '  经 gateway %s%s：不通\n' "$host" "$path"
      bad=1
    fi
  done
  # /health 的整体状态码不看（探针循环 M2 才有，在那之前是 503）；只看 worker 一项：ok 即 worker 持有租约
  while :; do
    body="$(docker exec "$(container gateway)" curl -sS -m 5 -H "Host: $host" "http://127.0.0.1:8080/health" 2>/dev/null)"
    if printf '%s' "$body" | grep -Eq '"worker" *: *"ok"'; then
      printf '  worker 持有租约（/health 里 worker 是 ok）\n'
      break
    fi
    tries=$((tries + 1))
    if [ "$tries" -ge 20 ]; then
      printf '  worker 没有持有租约（/health 里 worker 不是 ok）\n'
      bad=1
      break
    fi
    sleep 2
  done
  [ "$bad" = 0 ] || die "status：探活没过（见上）"
  say "status：六个容器在跑，版本一致，探活通过"
}

step_verify_db() {
  wait_healthy 30 postgres || die "库没在运行：先 node-step.sh deps"
  one_off "$1" verify-db || die "库的核对没过（见上）"
}

step_run() {
  local tag
  tag="$(current_tag)"
  case "$1" in
    postgres | redis) tag="${tag:-none}" ;;
    *) [ -n "$tag" ] || die "还没有 release.env：先 node-step.sh up <标签>" ;;
  esac
  compose_args
  LYX_TAG="$tag" exec docker "${COMPOSE_ARGS[@]}" up --no-deps "$1"
}

case "$step" in
  deps) step_deps ;;
  pull) step_pull "$1" ;;
  check-env) step_check_env "$1" ;;
  migrate) step_migrate "$1" ;;
  seed) step_seed "$1" ;;
  up) step_up "$1" ;;
  status) step_status ;;
  verify-db) step_verify_db "$1" ;;
  run) step_run "$1" ;;
  stop)
    tag="$(current_tag)"
    compose "${tag:-none}" stop "$1" || die "没停成：$1"
    ;;
  wait) wait_healthy 90 "$@" || exit 1 ;;
esac
