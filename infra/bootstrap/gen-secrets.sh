#!/usr/bin/env bash
# 狸有戏 · 预发节点：生成“随机就行”的密钥文件（ADR-041 第 4.6 节；W2-25）。由业主在节点上执行；演练也用它现造假值。
# 这些值只在这台节点上用，不必从别处抄来：数据库与 Redis 的口令（连同连接串）、字段加密、盲索引、后台登录三份密钥文件。
# 第三方给的密钥（微信、对象存储、短信等）不在这里，接进来时由业主照清单写入。
#
# 用法：gen-secrets.sh [--dir <密钥目录>] [--dry-run]
#   --dir      密钥目录，缺省 $LYX_SECRETS_DIR（再缺省 /opt/liyoxi/secrets）。目录不在就建，权限 0700
#   --dry-run  只说会生成哪些文件，什么都不写
# 已有的文件一个不动（可以重复执行；换密钥是另一回事，见 docs/plan/runbook.md 第 4 节）。只打印文件名，不打印任何内容。
# 写出的文件权限 0400；以 root 执行时把属主改成清单写的 uid（读它的容器的运行用户），不是 root 时不改并说明。
# 随机数取自 /dev/urandom：口令是 48 个十六进制字符（进连接串不用转义），密钥是 base64 写的 32 字节。
# 连接串里的主机名是 node.yml 里的服务名（postgres、redis），账号名固定：lyx_migrator、lyx_app_login、lyx_backup_login。
# 退出码：0 成功；1 没做成；2 用法不对。
set -eu
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../deploy" && pwd -P)/lib.sh"

dir="$LYX_SECRETS_DIR"
dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir)
      [ $# -ge 2 ] || usage_die "--dir 后面要跟目录"
      dir="$2"
      shift 2
      ;;
    --dry-run)
      dry=1
      shift
      ;;
    *) usage_die "用法：gen-secrets.sh [--dir <密钥目录>] [--dry-run]" ;;
  esac
done

DB_NAME="${LYX_DB_NAME:-liyoxi}"
umask 077
hex() { od -An -tx1 -N24 /dev/urandom | tr -d ' \n'; }
key32() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }
exists() { [ -e "$dir/$1" ] || [ -L "$dir/$1" ]; }

# 从标准输入收内容，写成 0400 的文件；属主按清单
put() {
  local file="$1" uid tmp
  uid="$(manifest_rows | awk -F'|' -v f="$file" '$1 == f { print $2 }')"
  [ -n "$uid" ] || die "清单里没有 $file：先在 infra/deploy/secrets.manifest.json 登记"
  tmp="$dir/.$file.tmp"
  cat >"$tmp"
  chmod 0400 "$tmp"
  if [ "$(id -u)" = 0 ]; then chown "$uid:$uid" "$tmp"; fi
  mv -f "$tmp" "$dir/$file"
  echo "已生成  $file"
}

# 一组文件要么都在、要么都不在：只剩一部分时不猜，停下
group_state() {
  local have=0 total=0 one
  for one in "$@"; do
    total=$((total + 1))
    if exists "$one"; then have=$((have + 1)); fi
  done
  if [ "$have" = 0 ]; then
    echo missing
  elif [ "$have" = "$total" ]; then
    echo present
  else
    die "这几个文件要成对：$*。现在只有一部分，补上缺的，或把剩下的删掉重新生成"
  fi
}

# 文件名、怎么生成；成组的写在一起（同一个口令出现在两处）
plan() {
  local state
  state="$(group_state "$@")" || exit 1
  if [ "$state" = present ]; then
    for one in "$@"; do echo "已有，不动  $one"; done
    return 1
  fi
  if [ "$dry" = 1 ]; then
    for one in "$@"; do echo "会生成  $one"; done
    return 1
  fi
  return 0
}

if [ "$dry" = 0 ]; then
  mkdir -p "$dir"
  chmod 0700 "$dir"
fi

if plan postgres-password; then hex | put postgres-password; fi
if plan migrator-database-url; then
  printf 'postgresql://lyx_migrator:%s@postgres:5432/%s\n' "$(hex)" "$DB_NAME" | put migrator-database-url
fi
if plan database-url; then
  printf 'postgresql://lyx_app_login:%s@postgres:5432/%s\n' "$(hex)" "$DB_NAME" | put database-url
fi
if plan backup-database-url; then
  printf 'postgresql://lyx_backup_login:%s@postgres:5432/%s\n' "$(hex)" "$DB_NAME" | put backup-database-url
fi
if plan redis-auth.conf redis-url; then
  redis_password="$(hex)"
  printf 'requirepass %s\n' "$redis_password" | put redis-auth.conf
  printf 'redis://:%s@redis:6379/0\n' "$redis_password" | put redis-url
  unset redis_password
fi
if plan data-keys.json; then
  printf '{"current":"k1","keys":{"k1":"%s"}}\n' "$(key32)" | put data-keys.json
fi
if plan bidx-keys.json; then
  printf '{"phone":"%s","uscc":"%s"}\n' "$(key32)" "$(key32)" | put bidx-keys.json
fi
if plan auth-keys.json; then
  printf '{"ticket":"%s","device":"%s","mfa":{"current":"k1","keys":{"k1":"%s"}}}\n' \
    "$(key32)" "$(key32)" "$(key32)" | put auth-keys.json
fi

# 清单上有、这里不会生成的：要业主自己写入
known=" postgres-password migrator-database-url database-url backup-database-url redis-auth.conf redis-url data-keys.json bidx-keys.json auth-keys.json "
manifest_rows | while IFS='|' read -r file uid required mounts env; do
  case "$known" in *" $file "*) continue ;; esac
  if ! exists "$file"; then echo "要自己写入（这里生成不了）  $file"; fi
done
if [ "$dry" = 0 ] && [ "$(id -u)" != 0 ]; then
  echo "注意：不是 root，文件的属主没有改。节点上要用 root 执行，属主才是清单写的 uid。"
fi
echo "三份密钥文件 data-keys.json、bidx-keys.json、auth-keys.json 离线另存一份（密码库）：丢了数据解不开。"
