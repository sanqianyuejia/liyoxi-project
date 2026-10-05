#!/usr/bin/env bash
# 狸有戏 · 预发节点脚本共用的部分（W2-25）。由 check-secrets.sh、node-step.sh 与 infra/bootstrap/ 下的脚本 source，自己不是命令。
# 写法兼容 bash 3.2（本机的用例在 macOS 上跑）与节点上的 bash 4 以上；只用 POSIX 的 awk、sed、ls，不要 jq、python。
#
# 两个目录：
#   LYX_SRC        脚本所在的那棵树的根（仓库根；节点上是 /opt/liyoxi，里面照仓库的样子放着 infra/）。按本文件的位置算，不用设
#   LYX_NODE_HOME  节点上放状态的目录，缺省 /opt/liyoxi：secrets/（密钥文件）、static/、node.env（本机的非敏感设置）、
#                  release.env（现在该跑哪个版本，由节点步骤 up 写）。演练时指到临时目录
# 其余可调的变量（都可以不设）：
#   LYX_SECRETS_DIR      密钥目录，缺省 $LYX_NODE_HOME/secrets
#   LYX_NODE_PREFIX      容器、网络、卷的名字前缀，缺省 lyx（容器就是 lyx-api 等）。演练时换一个，不撞本机别的容器
#   LYX_NODE_PROJECT     Compose 项目名，缺省 liyoxi-node

LYX_SRC="${LYX_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)}"
LYX_NODE_HOME="${LYX_NODE_HOME:-/opt/liyoxi}"
LYX_SECRETS_DIR="${LYX_SECRETS_DIR:-$LYX_NODE_HOME/secrets}"
LYX_NODE_PREFIX="${LYX_NODE_PREFIX:-lyx}"
LYX_NODE_PROJECT="${LYX_NODE_PROJECT:-liyoxi-node}"
LYX_MANIFEST="$LYX_SRC/infra/deploy/secrets.manifest.json"
export LYX_SRC LYX_NODE_HOME LYX_SECRETS_DIR LYX_NODE_PREFIX LYX_NODE_PROJECT

say() { printf '== %s\n' "$*"; }
# 某一步没成：退出码 1
die() {
  printf '%s\n' "$*" >&2
  exit 1
}
# 用法或环境不对：退出码 2
usage_die() {
  printf '%s\n' "$*" >&2
  exit 2
}

# 读密钥清单，一项一行，竖线分隔：文件名|属主 uid|现在就要(true/false)|挂给哪些服务（空格分隔，可空）|环境变量名（可空）。
# 读的一侧写 while IFS="|" read -r file uid required services env（竖线不是空白，空的字段不会被吞掉）。
# 清单是 JSON，这里按行读：每项的值只有字符串、数字、布尔，字符串里没有反斜杠与花括号（清单开头写了，用例核对）。
manifest_rows() {
  [ -r "$LYX_MANIFEST" ] || die "读不了密钥清单 infra/deploy/secrets.manifest.json"
  awk '
    function field(key,    re, s) {
      re = "\"" key "\"[ ]*:[ ]*(\"[^\"]*\"|[0-9]+|true|false)"
      if (!match($0, re)) return
      s = substr($0, RSTART, RLENGTH)
      sub(/^"[^"]*"[ ]*:[ ]*/, "", s)
      gsub(/^"|"$/, "", s)
      rec[key] = s
      seen[key] = 1
    }
    /"secrets"[ ]*:/ { on = 1; next }
    on {
      field("file"); field("uid"); field("required"); field("services"); field("env")
      if ($0 ~ /}/) {
        if (seen["file"]) printf "%s|%s|%s|%s|%s\n", rec["file"], rec["uid"], rec["required"], rec["services"], rec["env"]
        split("", rec); split("", seen)
      }
    }
  ' "$LYX_MANIFEST"
}
