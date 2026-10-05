# 数据模型校验

表结构已由 `packages/db` 的迁移接管；[docs/data-model/](../../docs/data-model/README.md) 下的 `schema.prisma` 与 `constraints/` 是首版迁移的底稿，已冻结（`pnpm db:draft-freeze:check` 把守）。本工具保留，校验的对象从“草稿自洽”改成“分组文档有没有跟上迁移”（开发计划 第 4.2 节 Q3、第 5.7 节）：

1. 建一个临时 PostgreSQL 库，按目录名顺序执行 `packages/db/prisma/migrations/` 下的全部迁移；
2. 逐列比对 15 份分组文档的字段表与库里的实际结构（列名、类型、可空）；
3. 找出文档里引用了、但库里不存在的列（只提示，不计入结论）。

## 准备

本机能用 `psql` 连上 PostgreSQL 17，连接参数用标准环境变量 `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD`，该用户要有建库权限。本地那套共享实例的取值见 `CLAUDE.md` 第 9 节。缺省流程只用 Python 标准库与 `psql`，不用装依赖。

## 运行

```bash
python3 tools/schema-check/check.py                               # 建临时库、跑全部迁移、比对、删库
python3 tools/schema-check/check.py --existing lyx_migrate_check  # 不建库：拿已经跑完迁移的库来比，只读（CI 里这样跑）
python3 tools/schema-check/check.py --from-draft                  # 旧流程：由冻结的草稿建库再比
```

- 缺省建一个名为 `lyx_schema_check` 的临时库，跑完删除；加 `--keep` 保留，便于手工查看（[tools/api-check](../api-check/README.md) 也用它）。
- `--db` 给的是**临时库名**，不是“要检查的库”。脚本会先删除再重建这个库，所以只接受以 `lyx_` 开头的名字；运行前确认 `PGHOST` 指向的是本机或专用的校验实例。几个 worktree 共用一个实例时，各自换一个库名，免得互相删库。
- `--existing <库>` 不建不删，只读，不限库名。
- `--from-draft` 是接管之前的流程：Prisma（版本锁定 7.9.1）校验草稿 `schema.prisma` → 离线生成建表语句 → 在临时库里执行 → 按顺序执行 `constraints/` 里的手写约束，再做同样的比对。要先 `cd tools/schema-check && npm install`。草稿已冻结，这条流程只用来复核“首版迁移与草稿等价”（`pnpm db:catalog-diff` 的参照库）。
- `--docs <目录>` 换一个目录读分组文档（门禁自测拿改过的副本来试）。
- 全部通过时退出码为 0；文档与库有差异为 2；没比成（连不上、建库或迁移失败）为 1。建表、迁移语句出错即停，按 `psql` 的退出码判断成败；失败时不保留半成品库。

## 说明

- 结构以迁移为准：改表结构是写新迁移（`packages/db/README.md` 第 4 节），同一个 PR 改分组文档，再用本工具核对；不回头改草稿。
- 这里只比字段表（列名、类型、可空）。约束、索引、触发器、函数由结构快照把关（`pnpm db:snapshot:check`、`pnpm db:constraints:check`，见 [infra/ci/README.md](../../infra/ci/README.md) 第 8 节）。
- 手写约束当初只用 PostgreSQL 14 也支持的语法；目标库与 CI 都是 17。
