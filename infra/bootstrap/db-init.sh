#!/usr/bin/env bash
# 狸有戏 · 预发节点：库的初始化（ADR-041 第 4.4 节；packages/db/README.md 第 9 节；W2-25 任务书 第 10 节第 1 项）。
# 由业主在节点上以 root 执行（要读密钥文件）；首次起环境时跑一次，换口令之后再跑一次。
#
# 用法：db-init.sh [--dry-run]
#   --dry-run  只核对三份连接串文件的写法、说出会建什么，不连库、不改任何东西
# 前提：密钥文件齐备（check-secrets.sh 通过）；PostgreSQL 容器已起（node-step.sh deps）。
# 做什么（可重复执行，已有的不重建）：
#   1. 两个不可登录的角色 lyx_app、lyx_readonly：先于迁移建好，迁移账号就不用建角色的权限
#   2. 迁移账号 lyx_migrator（库与表的属主）、应用登录账号、备份登录账号：都只能登录，没有超级用户、建库、建角色的权限；
#      口令每次按文件里的重设（换口令就是改文件后再跑一遍）
#   3. 应用登录账号加为 lyx_app 的成员，备份登录账号加为 lyx_readonly 的成员；不带 ADMIN OPTION，不加入别的角色
#   4. 库（名字取自连接串，预发是 liyoxi），属主 lyx_migrator；收回 PUBLIC 的连接权，授给两个角色（成员靠继承连得上）
#   5. 在库里装 btree_gist、pg_trgm 两个扩展
# 账号名与口令从三份连接串文件里读（migrator-database-url、database-url、backup-database-url），不另给：
#   文件里写的是什么账号，建的就是什么账号。口令只经标准输入交给容器里的 psql，不进命令行参数，不打印；
#   改口令的语句执行前先关掉这个会话的语句日志，psql 的报错也调成不带语句原文：出错时终端与库的日志里都不留口令。
# 连库的办法：docker exec 进 PostgreSQL 容器，经容器里的本机套接字以超级用户执行，不用超级用户的口令。
# 退出码：0 成功；1 没做成；2 用法或前提不对。
set -eu
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../deploy" && pwd -P)/lib.sh"

dry=0
case "${1:-}" in
  "") ;;
  --dry-run) dry=1 ;;
  *) usage_die "用法：db-init.sh [--dry-run]" ;;
esac
[ $# -le 1 ] || usage_die "用法：db-init.sh [--dry-run]"

container="${LYX_NODE_PREFIX}-postgres"
# 连接串只许这一种写法：账号、库名是小写蛇形，口令只有字母、数字、下划线、连字符（进 SQL 与连接串都不用转义）
URL_RE='^postgres(ql)?://([a-z_][a-z0-9_]*):([A-Za-z0-9_-]+)@([A-Za-z0-9.-]+):([0-9]+)/([a-z_][a-z0-9_]*)$'

# 读一份连接串文件，拆出账号、口令、库名；只报文件名，不报内容
url_user="" url_password="" url_db=""
read_url() {
  local file="$1" line
  [ -r "$LYX_SECRETS_DIR/$file" ] || usage_die "读不了密钥文件 $file：用 root 跑，并先过 check-secrets.sh"
  line="$(head -n 1 "$LYX_SECRETS_DIR/$file" | tr -d '\r')"
  if [[ ! "$line" =~ $URL_RE ]]; then
    usage_die "$file 的写法不对：要是 postgresql://<账号>:<口令>@<主机>:<端口>/<库名>，口令只用字母、数字、下划线、连字符"
  fi
  url_user="${BASH_REMATCH[2]}"
  url_password="${BASH_REMATCH[3]}"
  url_db="${BASH_REMATCH[6]}"
}

read_url migrator-database-url
migrator="$url_user" migrator_password="$url_password" db="$url_db"
read_url database-url
app_login="$url_user" app_password="$url_password" app_db="$url_db"
read_url backup-database-url
backup_login="$url_user" backup_password="$url_password" backup_db="$url_db"
unset url_password

[ "$migrator" = lyx_migrator ] || usage_die "migrator-database-url 里的账号要是 lyx_migrator"
[ "$db" = "$app_db" ] && [ "$db" = "$backup_db" ] || usage_die "三份连接串指的不是同一个库"
case "$db" in postgres | template0 | template1) usage_die "库名不能是 $db" ;; esac
for login in "$app_login" "$backup_login"; do
  case "$login" in
    lyx_app | lyx_readonly | lyx_migrator | postgres)
      usage_die "登录账号不能叫 $login：lyx_app、lyx_readonly 是不可登录的角色，登录账号另起名字（如 lyx_app_login）"
      ;;
  esac
done
[ "$app_login" != "$backup_login" ] || usage_die "应用与备份要用两个不同的登录账号"

say "库 $db；迁移账号 $migrator（属主）；应用登录账号 $app_login → lyx_app；备份登录账号 $backup_login → lyx_readonly"
if [ "$dry" = 1 ]; then
  say "--dry-run：三份连接串的写法都对；不连库，什么都没改"
  exit 0
fi

docker exec "$container" pg_isready -q -U postgres -d postgres ||
  usage_die "PostgreSQL 容器 $container 没在运行或还没就绪：先 node-step.sh deps"

# 标识符都过了上面的正则（小写蛇形），口令只有不用转义的字符：直接拼进语句
docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null <<SQL || die "库的初始化没做成：看上面 psql 的报错（里面没有口令）"
\set VERBOSITY terse
SET client_min_messages = warning;
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;
DO \$\$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['lyx_app', 'lyx_readonly'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['$migrator', '$app_login', '$backup_login'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN', r);
    END IF;
  END LOOP;
END;
\$\$;
ALTER ROLE $migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '$migrator_password';
ALTER ROLE $app_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '$app_password';
ALTER ROLE $backup_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '$backup_password';
GRANT lyx_app TO $app_login;
GRANT lyx_readonly TO $backup_login;
SELECT format('CREATE DATABASE %I OWNER %I', '$db', '$migrator')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$db') \gexec
REVOKE CONNECT ON DATABASE $db FROM PUBLIC;
GRANT CONNECT ON DATABASE $db TO lyx_app, lyx_readonly;
\connect $db
SET client_min_messages = warning;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
unset migrator_password app_password backup_password

say "库已初始化：$db（属主 $migrator），扩展 btree_gist、pg_trgm 已装，两个登录账号已加为成员。下一步：node-step.sh migrate <标签>"
