#!/usr/bin/env bash
# 狸有戏 · 预发节点初始化（ADR-041“决定”第 4.2、4.7、4.10 节；D7 第 2.1 节末段；W2-25）。
# 由业主在节点上以 root 执行，或业主在场逐步确认后由调度会话执行。先带 --dry-run 看一遍，再去掉参数执行。
# 可以重复执行：已有的目录、用户、文件照原样补齐，不删任何东西。
#
# 用法：node-init.sh [--dry-run] [--deploy-key <公钥文件>] [--registry <镜像仓库前缀>] [--nginx-oom]
#   --dry-run     只做核对、只说会做什么，不建、不改任何东西（不用 root）
#   --deploy-key  发布用的公钥（一行）。给了才写发布用户的 authorized_keys；私钥由业主录入 CI 密文，不经会话
#   --registry    镜像仓库前缀，以 / 结尾（如 registry.example.com/liyoxi-stg/），写进节点上的 node.env；
#                 不给就留空，节点步骤 pull 按本地镜像处理。仓库用哪家由业主定
#   --nginx-oom   另装一份 systemd 覆盖文件，内存见底时别先杀宿主机 nginx（公司官网也在它上面）。
#                 这是动别人的服务，单列一个参数，业主同意才带；nginx 下次重启后生效，本脚本不重启它
# 先核对，有一项不过就停下并说明，什么都不改：
#   1. Docker 与 Compose 在；
#   2. 参考工程没有复活：它的容器没在跑，进程里没有它（名字里带 liyo、又不是 liyoxi 的）；
#   3. gateway 要占的回环端口（stg.env 的 LYX_GATEWAY_PORT，8080）空闲，或占着它的就是我们自己的 gateway；
#      80、443 是宿主机 nginx 的，不算冲突；
#   4. Compose 网络的固定网段（stg.env 的 LYX_NODE_SUBNET）不与已有的 Docker 网络、本机网卡的网段相撞。
# 再动手（每一步打印出来）：
#   a. 建目录：$LYX_NODE_HOME（缺省 /opt/liyoxi）、secrets/（0700，只有 root 能进）、static/{admin,portal}/assets/；
#   b. 把本脚本所在那棵树的 infra/compose、infra/deploy、infra/bootstrap 拷到 $LYX_NODE_HOME/infra/ 下；
#   c. 写 node.env（只有镜像仓库前缀；已有就不覆盖，给了 --registry 才改那一行）；
#   d. 建发布用户 lyx-deploy（不设口令，只能用密钥）；sudoers 只放行它以 root 执行 node-step.sh 这一个脚本；
#      给了 --deploy-key 就写 authorized_keys：一行，限定只能执行 node-step.sh，不给终端，不许任何转发；
#   e. 装六个 systemd 单元并重新加载（不启用、不启动：启用与启动在节点步骤 deps、up 里）；
#   f. 带了 --nginx-oom 才装宿主机 nginx 的那份覆盖文件。
# 不做的：不改宿主机 nginx 的任何站点，不重载、不重启 nginx；不碰参考工程留下的容器、卷、文件（只报告）；
#         不写任何密钥（gen-secrets.sh 与业主自己写）；不拉镜像，不起容器。
# 退出码：0 成功（或 --dry-run 核对通过）；1 核对没过或某一步没成；2 用法不对。
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../deploy" && pwd -P)/lib.sh"

USAGE="用法：node-init.sh [--dry-run] [--deploy-key <公钥文件>] [--registry <镜像仓库前缀>] [--nginx-oom]"
dry=0 deploy_key="" registry="" registry_given=0 nginx_oom=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --nginx-oom) nginx_oom=1 ;;
    --deploy-key | --registry)
      [ $# -ge 2 ] || usage_die "$1 后面要跟一个值。$USAGE"
      if [ "$1" = --deploy-key ]; then deploy_key="$2"; else
        registry="$2"
        registry_given=1
      fi
      shift
      ;;
    *) usage_die "$USAGE" ;;
  esac
  shift
done

# 系统路径的前缀：缺省为空（就是 /etc/…）。用例把它指到临时目录
FS_ROOT="${LYX_FS_ROOT:-}"
DEPLOY_USER="${LYX_DEPLOY_USER:-lyx-deploy}"
# 参考工程在容器名、Compose 项目名、进程命令行里的名字
REF_NAME="${LYX_REF_NAME:-liyo}"
STG_ENV="$LYX_SRC/infra/compose/env/stg.env"
NODE_STEP="$LYX_NODE_HOME/infra/deploy/node-step.sh"
stg() { sed -n "s/^$1=//p" "$STG_ENV" | head -n 1 | tr -d '\n'; }
PORT="${LYX_GATEWAY_PORT:-$(stg LYX_GATEWAY_PORT)}"
SUBNET="${LYX_NODE_SUBNET:-$(stg LYX_NODE_SUBNET)}"

case "$registry" in
  "" | */) ;;
  *) usage_die "--registry 要以 / 结尾" ;;
esac
case "$registry" in *[!A-Za-z0-9._:/-]*) usage_die "--registry 只许域名、端口与路径里会出现的字符" ;; esac
if [ -n "$deploy_key" ]; then
  [ -r "$deploy_key" ] || usage_die "读不了 --deploy-key 指的公钥文件"
  [ "$(grep -c . "$deploy_key")" = 1 ] || usage_die "公钥文件要恰好一行（一把公钥）"
  grep -Eq '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/=]+( [^"]*)?$' "$deploy_key" ||
    usage_die "公钥文件的写法不对：要是“类型 公钥 [备注]”一行，前面不带选项（选项由本脚本加）"
fi
if [ "$dry" = 0 ] && [ "$(id -u)" != 0 ]; then usage_die "要用 root 执行（先带 --dry-run 看一遍不用 root）"; fi

# ---------- 核对 ----------
stop() {
  printf '停下：%s\n什么都没有改。\n' "$*" >&2
  exit 1
}
ip_int() {
  local IFS=.
  # shellcheck disable=SC2086
  set -- $1
  echo $((($1 << 24) + ($2 << 16) + ($3 << 8) + $4))
}
# 两个 IPv4 网段有没有交集
overlaps() {
  local a="${1%/*}" al="${1#*/}" b="${2%/*}" bl="${2#*/}" len mask
  len=$((al < bl ? al : bl))
  mask=$((len == 0 ? 0 : (0xFFFFFFFF << (32 - len)) & 0xFFFFFFFF))
  [ $(($(ip_int "$a") & mask)) -eq $(($(ip_int "$b") & mask)) ]
}
is_cidr() { [[ "$1" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; }

say "核对（只读）"
docker_version="$(docker version --format '{{.Server.Version}}' 2>/dev/null)" || stop "连不上 Docker：先把 Docker 起起来"
compose_version="$(docker compose version --short 2>/dev/null)" || stop "没有 docker compose 这个子命令：要装 Compose v2"
echo "  Docker $docker_version，Compose $compose_version"

running="$(docker ps --format '{{.Names}} {{.Label "com.docker.compose.project"}}' 2>/dev/null)"
ref_containers="$(printf '%s\n' "$running" | awk -v ref="$REF_NAME" '$2 == ref || $1 ~ ("^" ref "[-_]") { print $1 }' | tr '\n' ' ')"
[ -z "${ref_containers// /}" ] || stop "参考工程的容器在跑：$ref_containers。它应该是停着的（ADR-041 第 5.1 节）：先弄清是谁起的，本脚本不处置它"
ref_processes="$(pgrep -fl "$REF_NAME" 2>/dev/null | grep -v "${REF_NAME}xi" | grep -v 'node-init' | head -n 5)"
[ -z "$ref_processes" ] || stop "参考工程的进程在跑（命令行里带 $REF_NAME）：
$ref_processes
它应该已经停用（ADR-041 第 5.1 节）：先弄清是谁起的，本脚本不处置它"
echo "  参考工程没有在跑的容器与进程"

is_cidr "$SUBNET" || stop "stg.env 的 LYX_NODE_SUBNET 不是 IPv4 网段"
case "$PORT" in "" | *[!0-9]*) stop "stg.env 的 LYX_GATEWAY_PORT 不是端口号" ;; esac
holder="$(ss -ltnH 2>/dev/null | awk -v port=":$PORT" '$4 ~ (port "$") { print $4 }' | head -n 1)"
if [ -n "$holder" ]; then
  ours="$(docker ps --filter "name=^${LYX_NODE_PREFIX}-gateway$" --format '{{.Ports}}' 2>/dev/null)"
  case "$ours" in
    *":$PORT->"*) echo "  端口 $PORT 由我们自己的 gateway 占着" ;;
    *) stop "端口 $PORT 被别的进程占着（$holder）。gateway 要占回环地址的这个端口：先弄清是谁（ss -ltnp），或在 stg.env 里换一个端口" ;;
  esac
else
  echo "  端口 $PORT 空闲"
fi

networks="$(docker network ls --format '{{.Name}}' 2>/dev/null | while read -r name; do
  docker network inspect -f '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}' "$name" 2>/dev/null
done)"
clash="$(printf '%s\n' "$networks" | while read -r name subnets; do
  [ "$name" = "${LYX_NODE_PREFIX}-node" ] && continue
  for one in $subnets; do
    if is_cidr "$one" && overlaps "$SUBNET" "$one"; then echo "Docker 网络 $name（$one）"; fi
  done
done
ip -4 -o addr show 2>/dev/null | awk '$2 !~ /^(lo|docker|br-|veth)/ { print $2, $4 }' | while read -r dev addr; do
  if is_cidr "$addr" && overlaps "$SUBNET" "$addr"; then echo "网卡 $dev（$addr）"; fi
done)"
[ -z "$clash" ] || stop "网段 $SUBNET 与已有的相撞：$(printf '%s' "$clash" | tr '\n' ' ')。在 stg.env 里把 LYX_NODE_SUBNET 与 LYX_TRUSTED_PROXY_CIDRS 换成不相撞的一段"
echo "  网段 $SUBNET 不与已有的 Docker 网络、本机网卡相撞"

uid_owner="$(getent passwd 1000 2>/dev/null | cut -d: -f1)"
echo "  提醒：容器里的运行用户是 uid 1000；宿主机上 uid 1000 是${uid_owner:+用户 $uid_owner}${uid_owner:-没有对应的用户}。密钥目录只有 root 能进，这个用户读不到密钥文件"
if command -v nginx >/dev/null 2>&1; then
  echo "  宿主机 nginx：$(nginx -v 2>&1 | head -n 1)。本脚本不动它的站点（三个预发站点由业主照 README 第 5 节装）"
else
  echo "  提醒：没找到宿主机的 nginx 命令。三个预发站点要装在终止 TLS 的那个 nginx 上"
fi

# ---------- 动手 ----------
# act <说明> <命令…>：--dry-run 只打印说明
act() {
  local what="$1"
  shift
  if [ "$dry" = 1 ]; then
    echo "  会做：$what"
    return 0
  fi
  echo "  $what"
  "$@" || die "没做成：$what"
}
say "$([ "$dry" = 1 ] && echo '会做什么（--dry-run：下面一条都不执行）' || echo '动手')"

make_dirs() {
  mkdir -p "$LYX_NODE_HOME/infra" "$LYX_SECRETS_DIR" "$LYX_NODE_HOME/static/admin/assets" "$LYX_NODE_HOME/static/portal/assets" &&
    chmod 0755 "$LYX_NODE_HOME" && chmod 0700 "$LYX_SECRETS_DIR"
}
act "建目录 $LYX_NODE_HOME（secrets/ 权限 0700，static/ 两个子目录）" make_dirs

copy_tree() {
  local one
  [ "$LYX_SRC" = "$LYX_NODE_HOME" ] && return 0
  for one in compose deploy bootstrap; do
    rm -rf "$LYX_NODE_HOME/infra/$one.new" &&
      cp -R "$LYX_SRC/infra/$one" "$LYX_NODE_HOME/infra/$one.new" &&
      rm -rf "$LYX_NODE_HOME/infra/$one" &&
      mv "$LYX_NODE_HOME/infra/$one.new" "$LYX_NODE_HOME/infra/$one" || return 1
  done
  chmod 0755 "$LYX_NODE_HOME"/infra/deploy/*.sh "$LYX_NODE_HOME"/infra/deploy/nginx/*.sh "$LYX_NODE_HOME"/infra/bootstrap/*.sh
}
act "拷贝 infra/compose、infra/deploy、infra/bootstrap 到 $LYX_NODE_HOME/infra/" copy_tree

write_node_env() {
  local file="$LYX_NODE_HOME/node.env"
  if [ ! -e "$file" ]; then
    printf '# 这台节点自己的非敏感设置（不入库）。节点步骤与 Compose 都读它；同名的项盖过 infra/compose/env/stg.env。\n# 镜像仓库前缀，以 / 结尾；空 = 用本地镜像。\nLYX_IMAGE_PREFIX=%s\n' "$registry" >"$file"
  elif [ "$registry_given" = 1 ]; then
    grep -v '^LYX_IMAGE_PREFIX=' "$file" >"$file.tmp"
    printf 'LYX_IMAGE_PREFIX=%s\n' "$registry" >>"$file.tmp"
    mv -f "$file.tmp" "$file"
  fi
  chmod 0644 "$file"
}
act "写 $LYX_NODE_HOME/node.env（镜像仓库前缀：${registry:-空，用本地镜像}；已有且没给 --registry 就不动）" write_node_env

ensure_user() {
  id -u "$DEPLOY_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$DEPLOY_USER"
}
act "建发布用户 $DEPLOY_USER（已有就不动；不设口令，只能用密钥登录）" ensure_user

write_sudoers() {
  local file="$FS_ROOT/etc/sudoers.d/$DEPLOY_USER"
  mkdir -p "$FS_ROOT/etc/sudoers.d" &&
    printf '# 狸有戏预发：发布用户只能以 root 执行节点步骤这一个脚本（infra/bootstrap/node-init.sh 写）。\n# 它登录时不给终端，所以这一个用户不要求终端。\nDefaults:%s !requiretty\n%s ALL=(root) NOPASSWD: %s\n' "$DEPLOY_USER" "$DEPLOY_USER" "$NODE_STEP" >"$file.tmp" &&
    chmod 0440 "$file.tmp" && visudo -cf "$file.tmp" >/dev/null && mv -f "$file.tmp" "$file"
}
act "写 /etc/sudoers.d/$DEPLOY_USER：只放行以 root 执行 $NODE_STEP" write_sudoers

write_authorized_keys() {
  local home ssh_dir
  home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  [ -n "$home" ] || return 1
  ssh_dir="$home/.ssh"
  mkdir -p "$ssh_dir" && chmod 0700 "$ssh_dir" &&
    printf 'command="%s",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc %s\n' "$NODE_STEP" "$(head -n 1 "$deploy_key")" >"$ssh_dir/authorized_keys" &&
    chmod 0600 "$ssh_dir/authorized_keys" && chown -R "$DEPLOY_USER:$DEPLOY_USER" "$ssh_dir"
}
if [ -n "$deploy_key" ]; then
  act "写发布用户的 authorized_keys：一行，限定只能执行 node-step.sh，不给终端，不许转发" write_authorized_keys
else
  echo "  没给 --deploy-key：发布用户的 authorized_keys 不写（公钥到位后带上它重跑本脚本）"
fi

install_units() {
  local unit
  mkdir -p "$FS_ROOT/etc/systemd/system" || return 1
  for unit in "$LYX_SRC"/infra/deploy/systemd/lyx-*.service; do
    sed "s|/opt/liyoxi/|$LYX_NODE_HOME/|g" "$unit" >"$FS_ROOT/etc/systemd/system/$(basename "$unit")" || return 1
  done
  systemctl daemon-reload
}
act "装六个 systemd 单元（lyx-postgres、lyx-redis、lyx-mediatool、lyx-api、lyx-worker、lyx-gateway）并重新加载；不启用、不启动" install_units

install_nginx_oom() {
  mkdir -p "$FS_ROOT/etc/systemd/system/nginx.service.d" &&
    cp "$LYX_SRC/infra/deploy/systemd/nginx-oom.conf" "$FS_ROOT/etc/systemd/system/nginx.service.d/lyx-oom.conf" &&
    systemctl daemon-reload
}
if [ "$nginx_oom" = 1 ]; then
  act "装宿主机 nginx 的覆盖文件（内存见底时别先杀它）；nginx 下次重启后生效，这里不重启它" install_nginx_oom
else
  echo "  没带 --nginx-oom：宿主机 nginx 的 systemd 覆盖文件不装"
fi

if [ "$dry" = 1 ]; then
  say "--dry-run：核对通过；上面的都没有执行"
else
  say "节点初始化完成。下一步（infra/bootstrap/README.md 第 3 节起）：写密钥文件 → node-step.sh deps → db-init.sh → 逐步发布"
fi
