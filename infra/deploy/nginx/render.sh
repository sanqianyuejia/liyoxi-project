#!/usr/bin/env bash
# 狸有戏 · 预发：渲染宿主机 nginx 的三个站点文件（ADR-041“决定”第 4.3 节；W2-25）。
# 只往 --out 指的目录里写文件：不碰 /etc/nginx，不重载 nginx。装到宿主机 nginx 上是业主的一步，
# 做法、核对与回退见 infra/bootstrap/README.md 第 5 节。
#
# 用法：render.sh --out <目录> [--tls-dir <目录>] [--acme-root <目录>] [--http-only]
#   --out        渲染到哪。写出 lyx-stg-api.conf、lyx-stg-admin.conf、lyx-stg-portal.conf
#   --http-only  只渲染 80 端口的那一段（证书验证目录加跳转）。证书还没签下来时先装这一份，签完再渲染完整的
#   --tls-dir    证书放在哪，缺省 /etc/nginx/lyx-tls。每个域名一个子目录，里面是 fullchain.pem 与 privkey.pem
#   --acme-root  证书签发的 HTTP 验证目录，缺省 /var/www/lyx-acme
# 三个域名与 gateway 的端口取自 infra/compose/env/stg.env（LYX_API_HOST、LYX_ADMIN_HOST、LYX_PORTAL_HOST、
# LYX_GATEWAY_PORT）；同名的环境变量优先。模板是同目录的 site.conf.template。
# 退出码：0 成功；2 用法不对或取值不合规。
set -eu
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)/lib.sh"

USAGE="用法：render.sh --out <目录> [--tls-dir <目录>] [--acme-root <目录>] [--http-only]"
out="" tls_dir=/etc/nginx/lyx-tls acme_root=/var/www/lyx-acme http_only=0
while [ $# -gt 0 ]; do
  case "$1" in
    --http-only)
      http_only=1
      shift
      ;;
    --out | --tls-dir | --acme-root)
      [ $# -ge 2 ] || usage_die "$1 后面要跟目录"
      case "$1" in
        --out) out="$2" ;;
        --tls-dir) tls_dir="$2" ;;
        --acme-root) acme_root="$2" ;;
      esac
      shift 2
      ;;
    *) usage_die "$USAGE" ;;
  esac
done
[ -n "$out" ] || usage_die "$USAGE"

stg_env="$LYX_SRC/infra/compose/env/stg.env"
template="$LYX_SRC/infra/deploy/nginx/site.conf.template"
setting() {
  local key="$1"
  if [ -n "${!key+x}" ]; then
    printf '%s' "${!key}"
  else
    sed -n "s/^$key=//p" "$stg_env" | head -n 1 | tr -d '\n'
  fi
}
port="$(setting LYX_GATEWAY_PORT)"
case "$port" in "" | *[!0-9]*) usage_die "LYX_GATEWAY_PORT 要是端口号" ;; esac
# 这些值会原样写进 nginx 配置：只许路径与域名里会出现的字符
for dir in "$tls_dir" "$acme_root"; do
  case "$dir" in /*) ;; *) usage_die "证书目录与验证目录要写绝对路径" ;; esac
  case "$dir" in *[!A-Za-z0-9._/-]*) usage_die "目录名只许字母、数字、点、下划线、连字符、斜杠" ;; esac
done

mkdir -p "$out"
for site in api admin portal; do
  key="LYX_$(printf '%s' "$site" | tr '[:lower:]' '[:upper:]')_HOST"
  host="$(setting "$key")"
  case "$host" in "" | *[!A-Za-z0-9.-]*) usage_die "$key 只能是域名" ;; esac
  # --http-only：模板里“以下是 https 的站点”那一行起都不要
  awk -v http_only="$http_only" 'http_only == 1 && /^# ---- 以下是 https 的站点/ { exit } { print }' "$template" |
    sed -e "s|\${LYX_SITE_HOST}|$host|g" -e "s|\${LYX_TLS_DIR}|$tls_dir|g" \
      -e "s|\${LYX_ACME_ROOT}|$acme_root|g" -e "s|\${LYX_GATEWAY_PORT}|$port|g" \
      >"$out/lyx-stg-$site.conf"
  echo "已渲染  lyx-stg-$site.conf（$host → 127.0.0.1:$port$([ "$http_only" = 1 ] && echo '；只有 80 端口的那一段')）"
done
