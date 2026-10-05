#!/bin/sh
# 狸有戏 · gateway 启动前渲染配置（W1-22）。官方镜像的入口脚本按文件名顺序执行 /docker-entrypoint.d/ 下的脚本，
# 有一个失败容器就起不来。这里不用官方那一步 envsubst（它往 /etc/nginx/conf.d 写，根文件系统只读时写不了，
# 而且写不了只记一行日志照样往下起）：自己渲染到 /tmp/nginx，变量逐个核对，缺了、写错了当场失败。
#
# 环境变量：
#   API_HOST、ADMIN_HOST、PORTAL_HOST   三个域名，必填
#   API_UPSTREAM                        api 的地址（主机:端口），必填
#   TRUSTED_PROXY_CIDRS                 可信代理的网段，空格或逗号分隔；不给即不信任何转发头
#   MEDIA_ORIGINS                       对象存储与 CDN 的源（写进 CSP），空格分隔；可不给
#   MINIO_UPSTREAM                      只有挂了 lan.conf.template 时才用
set -eu

out=/tmp/nginx
templates=/etc/nginx/lyx-templates
fail() {
  echo "gateway：$1" >&2
  exit 1
}

for name in API_HOST ADMIN_HOST PORTAL_HOST API_UPSTREAM; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || fail "环境变量 $name 没给"
done
# 这些值会原样写进 nginx 配置：只许域名与地址里会出现的字符
for name in API_HOST ADMIN_HOST PORTAL_HOST; do
  eval "value=\$$name"
  case "$value" in *[!A-Za-z0-9.-]*) fail "$name 只能是域名" ;; esac
done
for name in API_UPSTREAM MINIO_UPSTREAM; do
  eval "value=\${$name:-}"
  case "$value" in *[!A-Za-z0-9.:-]*) fail "$name 要写成 主机:端口" ;; esac
done
MEDIA_ORIGINS="${MEDIA_ORIGINS:-}"
case "$MEDIA_ORIGINS" in *[!A-Za-z0-9.:/*\ -]*) fail "MEDIA_ORIGINS 只能是空格分隔的源（协议://主机[:端口]）" ;; esac
MINIO_UPSTREAM="${MINIO_UPSTREAM:-}"

mkdir -p "$out/conf.d" "$out/client_body" "$out/proxy" "$out/fastcgi" "$out/uwsgi" "$out/scgi"

# 可信代理网段：一段一行 set_real_ip_from
: > "$out/real-ip.inc"
for cidr in $(printf '%s' "${TRUSTED_PROXY_CIDRS:-}" | tr ',' ' '); do
  printf '%s' "$cidr" | grep -Eq '^[0-9A-Fa-f:.]+(/[0-9]{1,3})?$' || fail "TRUSTED_PROXY_CIDRS 里的 $cidr 不是网段"
  echo "set_real_ip_from $cidr;" >> "$out/real-ip.inc"
done

# 域名解析用容器的 DNS（Compose 网络里是 Docker 内置的那个）：上游地址每次重新解析
RESOLVERS=$(awk '$1 == "nameserver" { printf "%s%s", sep, ($2 ~ /:/ ? "[" $2 "]" : $2); sep = " " }' /etc/resolv.conf)
[ -n "$RESOLVERS" ] || fail "/etc/resolv.conf 里没有 nameserver"
export RESOLVERS MEDIA_ORIGINS MINIO_UPSTREAM

# 只替换这几个变量：模板里 nginx 自己的 $host、$uri 之类不动
vars='${API_HOST} ${ADMIN_HOST} ${PORTAL_HOST} ${API_UPSTREAM} ${MEDIA_ORIGINS} ${RESOLVERS} ${MINIO_UPSTREAM}'
for template in "$templates"/*.template; do
  name=$(basename "$template" .template)
  envsubst "$vars" < "$template" > "$out/conf.d/$name"
done
echo "gateway：配置已渲染到 $out/conf.d（域名 $API_HOST、$ADMIN_HOST、$PORTAL_HOST；上游 $API_UPSTREAM）"
