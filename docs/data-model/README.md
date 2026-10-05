# 数据模型：分组文档

总览、建模约定、表清单与待确认问题见 [../06-data-model.md](../06-data-model.md)。本目录是字段级的定义。

| 分组 | 文档 | 表数 | 主要依据 |
| --- | --- | --- | --- |
| 01 内核与流程基础 | [01-kernel-flow.md](01-kernel-flow.md) | 7 | d3、d7 |
| 02 身份与租户 | [02-identity-tenant.md](02-identity-tenant.md) | 15 | d4、d7、d9 |
| 03 员工、权限、审计与审批 | [03-staff-authz-audit.md](03-staff-authz-audit.md) | 12 | d4、d3 |
| 04 门店档案与资质审核 | [04-profile.md](04-profile.md) | 5 | d9 |
| 05 短剧库 | [05-content.md](05-content.md) | 6 | d8 |
| 06 文件、媒体与素材 | [06-media.md](06-media.md) | 21 | d5 |
| 07 价目、订阅与积分账本 | [07-billing-ledger.md](07-billing-ledger.md) | 21 | d1 |
| 08 付款、退款、对账与发票 | [08-billing-payment.md](08-billing-payment.md) | 12 | d2 |
| 09 选剧单、订购、取消与广告 | [09-order-ad.md](09-order-ad.md) | 10 | d3 |
| 10 交付 | [10-delivery.md](10-delivery.md) | 15 | d3、d5 |
| 11 发布 | [11-publish.md](11-publish.md) | 7 | d3 |
| 12 客服工单 | [12-support.md](12-support.md) | 3 | d3 |
| 13 通知与文书 | [13-notify-docs.md](13-notify-docs.md) | 14 | d6 |
| 14 配置、埋点、报表与导出 | [14-config-data.md](14-config-data.md) | 13 | d6、d3 |
| 15 回调、告警与不变量 | [15-integration-ops.md](15-integration-ops.md) | 5 | d4、d2、d7 |

每份文档的结构相同：概览与关系图 → 逐表的字段、键与索引、手写约束、状态机、不变量、相对草案的改动 → 枚举汇总 → jsonb 快照结构 → 与其他分组的关系 → 待确认 → 修订记录。

其他文件：

| 文件 | 内容 |
| --- | --- |
| [schema.prisma](schema.prisma) | 数据库结构草稿（Prisma 7.9.1），按分组分段 |
| [constraints/](constraints/) | 手写约束：`00-common.sql`（扩展与公共触发器函数）与各分组的 CHECK、部分唯一索引、排他约束、触发器；按文件名顺序执行 |
| [working/](working/README.md) | 建模过程的工作底稿与裁决记录 |

校验方法见 [tools/schema-check](../../tools/schema-check/README.md)：`python3 tools/schema-check/check.py` 拿分组文档的字段表与跑完全部迁移的库逐列比。草稿（`schema.prisma` 与 `constraints/`）已冻结，结构以 `packages/db` 的迁移为准；分组文档跟着迁移改。
