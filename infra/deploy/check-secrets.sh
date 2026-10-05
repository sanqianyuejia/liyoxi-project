#!/usr/bin/env bash
# 狸有戏 · 预发节点：密钥文件齐备检查（ADR-041 第 4.2、4.6 节；W2-25）。
# systemd 单元的 ExecStartPre 与节点步骤 check-env 都跑它：密钥不齐，容器不起。
#
# 用法：check-secrets.sh [--dir <密钥目录>] [--service <服务名>]... [--skip-owner]
#   --dir         密钥目录，缺省 $LYX_SECRETS_DIR（再缺省 /opt/liyoxi/secrets）
#   --service     只看挂给这个服务的那几项（node.yml 里的服务名，可以给多次）；不给就看清单上的全部
#   --skip-owner  不核对属主（本机演练用：macOS 上改不了属主，Docker 的文件共享也不看它）；设 LYX_SECRETS_SKIP_OWNER=1 等同
# 查什么（清单是同目录的 secrets.manifest.json）：密钥目录只有属主能进（0700）；清单上“现在就要”的每一项
#   文件在、是普通文件、权限恰好 0400、不是空的、属主是清单写的 uid。不是现在就要的项，文件在才查。
# 输出只有文件名与原因；不读、不打印任何文件的内容。
# 退出码：0 齐备；1 有不合格的；2 用法不对或目录读不了。
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"

dir="$LYX_SECRETS_DIR"
services=""
check_owner=1
[ "${LYX_SECRETS_SKIP_OWNER:-}" = 1 ] && check_owner=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir)
      [ $# -ge 2 ] || usage_die "--dir 后面要跟目录"
      dir="$2"
      shift 2
      ;;
    --service)
      [ $# -ge 2 ] || usage_die "--service 后面要跟服务名"
      services="$services $2"
      shift 2
      ;;
    --skip-owner)
      check_owner=0
      shift
      ;;
    *) usage_die "用法：check-secrets.sh [--dir <密钥目录>] [--service <服务名>]... [--skip-owner]" ;;
  esac
done

# ls -ldn 的第 1 列是类型与权限（末尾可能多一个 @、+、.），第 3 列是属主的 uid：GNU 与 BSD 的 ls 都这样
mode_of() { ls -ldn "$1" 2>/dev/null | awk '{ print substr($1, 1, 10) }'; }
owner_of() { ls -ldn "$1" 2>/dev/null | awk '{ print $3 }'; }

[ -d "$dir" ] || usage_die "密钥目录不在：先跑节点初始化（infra/bootstrap/node-init.sh）"
[ -x "$dir" ] && [ -r "$dir" ] || usage_die "进不了密钥目录：用 root 跑（目录只有属主能进）"

bad=0
checked=0
fail() {
  printf '不合格  %s：%s\n' "$1" "$2" >&2
  bad=$((bad + 1))
}

case "$(mode_of "$dir")" in
  drwx------) ;;
  *) fail "（密钥目录）" "权限要是 0700，只有属主能进" ;;
esac

# 这一项挂不挂给点名的服务；没点名就都算
wanted() {
  [ -z "$services" ] && return 0
  for one in $services; do
    case " $1 " in *" $one "*) return 0 ;; esac
  done
  return 1
}

rows="$(manifest_rows)" || exit 1
[ -n "$rows" ] || die "密钥清单里一项都没读出来"
while IFS='|' read -r file uid required mounts env; do
  [ -n "$file" ] || continue
  wanted "$mounts" || continue
  path="$dir/$file"
  if [ ! -e "$path" ] && [ ! -L "$path" ]; then
    [ "$required" = "true" ] && fail "$file" "没有这个文件"
    continue
  fi
  checked=$((checked + 1))
  if [ -L "$path" ] || [ ! -f "$path" ]; then
    fail "$file" "不是普通文件"
    continue
  fi
  case "$(mode_of "$path")" in
    -r--------) ;;
    *) fail "$file" "权限要是 0400" ;;
  esac
  [ -s "$path" ] || fail "$file" "文件是空的"
  if [ "$check_owner" = 1 ] && [ "$(owner_of "$path")" != "$uid" ]; then
    fail "$file" "属主要是 uid $uid（读它的容器的运行用户）"
  fi
done <<EOF
$rows
EOF

if [ "$bad" -gt 0 ]; then
  printf '密钥文件不齐备：%s 处不合格。清单与各项的用途见 infra/deploy/secrets.manifest.json\n' "$bad" >&2
  exit 1
fi
printf '密钥文件齐备：查了 %s 个文件%s\n' "$checked" "${services:+（服务：${services# }）}"
