# 「狸有戏」数据模型

| 项 | 内容 |
| --- | --- |
| 状态 | 评审稿。166 张表已写到字段级，并在 PostgreSQL 上真正建表、执行全部手写约束校验通过；没有写业务代码，没有跑迁移工具，没有测性能 |
| 日期 | 2026-10-03 |
| 依据 | [01 技术架构](01-architecture.md)第 5–7 节、[03 关键技术方案](03-key-designs.md)（含第 9 节裁决 R1–R15）、[04 架构决策记录](04-adr.md)、七份子系统设计草案与新补的两份（[d8 短剧库](appendix/design/d8-content.md)、[d9 门店档案与资质审核](appendix/design/d9-profile.md)）、PRD 第 7 稿、两套原型 |
| 产物 | 本文（总览与约定）、[data-model/](data-model/README.md) 下 15 份分组文档、[schema.prisma](data-model/schema.prisma)（数据库结构草稿）、[constraints/](data-model/constraints/)（手写约束）、[tools/schema-check/](../tools/schema-check/README.md)（校验工具） |

## 1. 一页结论

- **规模**：166 张表，分 15 个分组，对应 [01](01-architecture.md) 第 5 节的领域模块。外键 477 个（其中 54 个是保证“门店属于该主体”的复合外键），CHECK 约束 1,284 条，索引 782 个（含 183 个部分索引），触发器 126 个，排他约束 1 个。这几个数是在校验库里数的，含埋点事件表的 5 个按月分区子表（兜底、当月、未来 3 个月）；只数 166 张逻辑表是 CHECK 1,234 条、索引 757 个（部分索引 168 个）、触发器 121 个，外键与排他约束不变。
- **唯一依据**：表结构以本文、15 份分组文档、`schema.prisma` 与 `constraints/` 为准。七份设计草案（d1–d7）里的表定义不再回改，与草案的差异逐表记在分组文档的“相对草案的改动”里。
- **怎么得出的**：先把七份草案的表合成一份统一清单，补写了此前没有设计的短剧库（d8）与门店档案和资质审核（d9）；再由 15 位作者分组写到字段级，每人必须让自己那组表在数据库里建成；之后经两轮复核与修订、一轮跨分组收尾。过程中的 112 条裁决记在 [working/rulings.md](data-model/working/rulings.md)。
- **校验结果**：合并后的结构用 Prisma 7.9.1 校验通过，生成的建表语句在 PostgreSQL 上执行成功，约 1,750 条手写约束全部执行成功；15 份文档的字段表与库里的实际结构逐列比对，0 处差异。任何人都可以用 [tools/schema-check](../tools/schema-check/README.md) 在本机重跑。
- **需要拍板的事**：四十多个会影响表结构的问题，按法务、业务与产品、财务、架构分组汇总在第 7 节，每项都有默认做法。没有回复就按默认做法实现。

## 2. 文档怎么读

| 想知道 | 看哪里 |
| --- | --- |
| 有哪些表、各属于哪个模块 | 本文第 4 节 |
| 某张表的字段、约束、状态机、不变量 | 对应分组文档的第 2 节 |
| 某个枚举有哪些取值 | 分组文档第 3 节 |
| jsonb 快照列里存什么 | 分组文档第 4 节 |
| 这组表与其他分组怎么关联 | 分组文档第 5 节 |
| 为什么这样定、与草案哪里不同 | 分组文档每张表的“相对草案的改动”与文末“修订记录”；全局裁决见 [working/rulings.md](data-model/working/rulings.md) |
| 建表语句长什么样 | 用 `schema.prisma` 生成，方法见 [tools/schema-check](../tools/schema-check/README.md) |

## 3. 建模约定

下列约定全仓一致，分组文档只写例外。

### 3.1 主键与编号

| 项 | 约定 |
| --- | --- |
| 主键 | 业务表一律 `id uuid`，UUID v7，由应用生成，库里不设默认值（R1）。约束名 `pk_<表>` |
| 只增表的序号 | 积分流水、审计、状态历史、出站事件这类只增表另带 `seq bigint`（自增、唯一），只用于排序与回放，不出接口 |
| 不用 uuid 主键的表 | 以代码登记常量为键的配置表用自然键（如 `staff_role.key`、`agreement.key`）；与父表一对一的扩展表用父表主键（如 `billing_account` 的主键就是 `entity_id`）；纯关联表与明细表用复合主键 |
| “第几个” | `seq` 只用于上面那种自增列。同一父行下的排列顺序叫 `position`；轮次、版本、序号叫 `<含义>_no`（`round_no`、`version_no`、`item_no`） |
| 业务单号 | 对人展示用单号，列名 `<对象>_no`、唯一。前缀：订购单 `LYX`、付款单 `FK`、广告 `GG`、客服工单 `KF`、退款与取消 `TK`、积分调整 `TZ`、补偿延长 `YQ`、开票申请 `KP`、差异单 `CY`、账号变更 `ZH`、导出任务 `DC`；交付工单 `JF` 与授权书 `SQ` 由订购单号派生，不另取号 |

### 3.2 类型

| 项 | 约定 |
| --- | --- |
| 时间 | 时刻用 `timestamptz`（库内 UTC），列名以 `_at` 结尾；“哪一天”用 `date`，按北京时间取日，列名以 `_date` 结尾（报表分组列叫 `biz_date`）。业务时间由应用注入的时钟写入，不用库的 `now()`；基础设施表例外 |
| 金额 | 整数分，`integer`，列名以 `_fen` 结尾。例外：对账日汇总 `recon_day` 的 7 个汇总列与媒体成本估算用 `bigint` |
| 积分 | 整数，业务表列名以 `_points` 结尾，账本表内部用 `qty` |
| 比例 | 万分比整数，列名以 `_bp` 结尾（9 折 = 9000） |
| 大整数 | 字节数等用 `bigint`；凡 `bigint` 出接口时转字符串 |
| 枚举 | `text` + CHECK，不用数据库原生枚举；取值的唯一来源是 `packages/contract`。状态机或账本逻辑依赖其取值的原因码也是枚举（M55）；其余可维护的分类用字典编码，不建外键，由每日不变量校验存在 |
| 多态引用 | `<角色>_type` + `<角色>_id`，`_id` 为 `uuid`，取值用最终表名。跨模块的多态类型列只校验写法（小写蛇形），取值清单在契约的登记表里，启动时核对（M52） |
| jsonb 快照 | 列名以 `_snapshot` 结尾，每列对应契约里的一个 schema，结构写在分组文档第 4 节 |
| 敏感字段 | 手机号、统一社会信用代码、银行账号等用三件套：`<名>_enc`（AES-256-GCM 密文，`text`）、`<名>_bidx`（HMAC 盲索引，只在需要等值查找时建）、`<名>_mask`（脱敏串） |
| IP 地址 | `text` |

### 3.3 归属与操作人

| 项 | 约定 |
| --- | --- |
| 归属列 | 门店维度的表同时带 `entity_id` 与 `store_id`，主体维度的表只带 `entity_id`；平台级或主体未知的行归属列为空。接口会按 id 直接读写的子表也带归属列（创建时从父行复制，不可改） |
| 归属一致性 | L1 及以上同时带两列的表，门店外键写成复合外键 `(store_id, entity_id) → store(id, entity_id)`，库级保证“门店属于该主体”（M47） |
| 操作人 | 可能是多种身份时用三列：`actor_type`（`merchant` / `staff` / `system` / `partner`，后者 V1.0 只声明）、`actor_id`、`client`（`weapp` / `portal` / `admin`；审计日志另有 `cli`）。固定为某类身份时用单列，如 `created_by_staff_id`、`placed_by_user_id` |
| 乐观锁 | 多人会改的行带 `lock_version integer NOT NULL DEFAULT 0`。状态迁移用事务内行锁加状态守卫，内容编辑用乐观锁 |

### 3.4 状态、只增与删除

| 项 | 约定 |
| --- | --- |
| 状态机 | 25 张业务状态机表的状态只经 `flow.transition()` 迁移，每次写一行 `status_transition`（含 `state_field`，区分同一张表的不同状态列，M53），并在同一事务补一条审计活动流。账本内部状态（订阅周期、发放计划、冻结单）由计费函数在账户锁内推进，历史在订阅事件与积分流水；任务、投递、文件这类技术状态不写状态历史 |
| 只增表 | 应用角色只有插入与查询权限，另有触发器拦截修改、删除、清空。带生效时间的修订行只允许在生效前写一次撤销时间 |
| 删除 | 不设全局软删除列，业务对象用状态或时间戳表达停用；证据类数据不删。允许物理删除的只有：过期幂等记录、埋点去重行、已触发的周期定时器行、过期票据与会话、验证码、关联表的增删（选剧单、订单项账号与广告位、店员所属门店、客服工单关联）、特定条件下的剧集行、已恢复超过 180 天的告警（M63、M95）。门店（含草稿门店）不物理删除（M93） |
| 在途唯一 | “同一对象只允许一张在途申请”建在领域表上：领域行带 `closed_at`，部分唯一索引 `WHERE closed_at IS NULL`；审批单的去重索引只覆盖待审批状态（M12） |
| 领域申请单状态 | 退款申请与取消申请统一为 `pending_approval` → `pending_execution` → （`executing`）→ `done`，未执行即关闭为 `not_executed`，原因 `rejected` / `withdrawn` / `voided`（M54） |

### 3.5 命名与约束名

- 表名单数蛇形（R2），子表带父表前缀。Prisma 模型名用帕斯卡命名并映射。
- 外键列用“被引用表全名 + `_id`”（`delivery_ticket_id`、`point_hold_id`），按角色命名的除外（`delivery_manager_id`、`created_by_staff_id`）；指向文件的统一叫 `file_id` 或 `<角色>_file_id`；指向自然键表的用“表名 + 主键列名”（`staff_role_key`）。
- 布尔列以 `is_` / `has_` / `can_` 开头或以 `_enabled` 结尾，非空带默认值；能用时间戳表达的不用布尔。
- 约束与索引名：`pk_`、`fk_`、`uq_`、`ix_`、`ck_`、`ex_`、`trg_` 加表名与列名，不超过 63 个字符。
- 公共触发器函数五个（`lyx_forbid_mutation`、`lyx_forbid_update`、`lyx_forbid_delete`、`lyx_write_once`、`lyx_forbid_column_change`），定义在 [constraints/00-common.sql](data-model/constraints/00-common.sql)。

### 3.6 跨模块关系

- 下层的表不引用上层的表（[01](01-architecture.md) 第 5 节）。需要关联时由上层表持有外键；下层必须记住上层对象时只存 id、不建外键。L0（内核）的表一律只存 id。
- 下层要写上层的表时用端口：内核定义，上层注册实现（埋点、不变量违规、告警都是这种形态）。
- 同层模块之间允许外键；同层的同步调用只允许下列方向（在 d7 原有白名单上增补）：

| 层 | 允许的同层调用 |
| --- | --- |
| L1 | identity → tenant、approval、docs、notify（只限验证码与换绑通知的直发）、media；tenant → docs；staff → approval、media；portal → identity；profile → approval、tenant、media、identity；content → media |
| L3 | order → ad、delivery；delivery → ad、publish |

### 3.7 数据库能力的要求

- 目标库 PostgreSQL 17。手写约束只用 14 也支持的语法，便于本机校验。
- 需要两个扩展：`btree_gist`（订阅周期不重叠的排他约束）与 `pg_trgm`（素材搜索）。托管库是否提供 `btree_gist` 待确认，不提供时去掉那一条排他约束，改为服务层校验加每日不变量。
- 埋点事件表按月分区，由手写 SQL 建立（Prisma 表达不了）。

## 4. 表清单

“归属列”指表上有哪些归属列（L0 的表只存 id、不建外键）；“只增”指有触发器拦截修改与删除；“状态机”指状态经 `flow.transition()` 迁移并写状态历史；“锁序”见第 5 节。中文名链接到分组文档。

#### [01 内核与流程基础（kernel、events、timers、flow、sla）](data-model/01-kernel-flow.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `idempotency_record` | 幂等记录 | — | scope + actor_key + key |  |  |  |
| `biz_sequence` | 业务单号流水 | — | prefix + biz_date |  |  |  |
| `outbox_event` | 出站事件 | 主体 + 门店 | uuid + seq | 是 |  |  |
| `outbox_delivery` | 出站投递 | — | outbox_event_id + subscriber |  |  |  |
| `timer` | 定时器 | 主体 + 门店 | uuid |  |  |  |
| `status_transition` | 状态变更历史 | 主体 + 门店 | uuid + seq | 是 |  |  |
| `work_calendar_day` | 工作日历 | — | day |  |  |  |

#### [02 身份与租户](data-model/02-identity-tenant.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `merchant_user` | 商家用户账号 | — | uuid |  | 是 | 80 |
| `wechat_identity` | 微信身份 | — | uuid |  |  | 90 |
| `user_session` | 商家端会话 | — | uuid |  |  |  |
| `portal_session` | 下载页会话 | 主体 + 门店 | uuid |  |  |  |
| `merchant_user_notice` | 账号一次性提示 | — | uuid |  |  |  |
| `sms_verification` | 商家侧短信验证码 | — | uuid |  |  |  |
| `wecom_contact` | 企业微信外部联系人关系 | — | uuid |  |  |  |
| `account_change_request` | 账号类变更申请 | 主体 | uuid |  |  | 40 |
| `entity` | 经营主体 | — | uuid |  | 是 | 100 |
| `store` | 门店 | 主体 | uuid |  | 是 | 130 |
| `entity_member` | 成员关系 | 主体 | uuid |  | 是 | 120 |
| `store_member` | 店员所属门店 | 主体 + 门店 | entity_member_id + store_id |  |  |  |
| `invitation` | 店员邀请 | 主体 + 门店 | uuid |  | 是 | 110 |
| `referral_code` | 渠道码与邀请码登记 | — | uuid |  |  |  |
| `portal_ticket` | 下载页扫码票据 | 主体 + 门店 | uuid |  |  |  |

#### [03 员工、运营跟进记录、权限、审计与统一审批单（staff、authz、audit、approval）](data-model/03-staff-authz-audit.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `staff` | 员工账号 | — | uuid |  | 是 | 20 |
| `staff_group` | 员工分组 | — | uuid |  |  |  |
| `staff_role` | 后台角色 | — | key |  |  |  |
| `staff_activation` | 员工激活码与重置码 | — | uuid |  |  |  |
| `staff_session` | 员工会话 | — | uuid |  |  |  |
| `assignment_pool_member` | 分配池成员 | — | pool + staff_id + city_code |  |  |  |
| `assignment_cursor` | 轮询游标 | — | pool + scope_key |  |  | 10 |
| `assignment_history` | 改派记录 | — | uuid + seq | 是 |  |  |
| `follow_up` | 运营跟进记录 | 主体 + 门店 | uuid |  |  |  |
| `audit_log` | 审计日志 | 主体 + 门店 | uuid + seq | 是 |  |  |
| `auth_event` | 登录与安全事件 | — | uuid + seq | 是 |  |  |
| `approval_request` | 统一审批单 | 主体 + 门店 | uuid |  | 是 | 30 |

#### [04 门店档案与资质审核](data-model/04-profile.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `store_profile` | 门店档案 | 主体 + 门店 | store_id |  |  | 135 |
| `store_profile_media` | 档案媒体行 | 主体 + 门店 | uuid |  |  |  |
| `store_service_item` | 主推服务 | 主体 + 门店 | uuid |  |  |  |
| `qualification_submission` | 资质轮次 | 主体 + 门店 | uuid |  |  | 65 |
| `qualification_doc` | 证照行 | 主体 + 门店 | uuid |  |  |  |

#### [05 短剧库（content）](data-model/05-content.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `drama` | 剧目 | — | uuid |  | 是 | 140 |
| `drama_episode` | 剧集 | — | uuid |  |  |  |
| `drama_permit` | 许可信息 | — | uuid |  |  |  |
| `drama_copyright` | 版权信息当前值 | — | drama_id |  |  |  |
| `drama_copyright_revision` | 版权信息修订 | — | uuid + seq | 是 |  |  |
| `drama_stat` | 订购统计 | — | drama_id |  |  |  |

#### [06 媒体：文件、媒体任务、素材、素材理解、证照识别、ZIP 缓存](data-model/06-media.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `file_object` | 文件对象 | 主体 + 门店 | uuid |  |  | 410 |
| `file_ref` | 文件引用 | — | uuid |  |  |  |
| `file_purge_run` | 清除运行 | — | uuid |  |  |  |
| `media_info` | 媒体探测事实 | — | file_id |  |  |  |
| `media_check` | 体检结论 | — | file_id |  |  |  |
| `upload_batch` | 批量上传批次 | — | uuid |  |  | 380 |
| `upload_batch_item` | 批次条目 | — | uuid |  |  |  |
| `media_job` | 媒体任务 | — | uuid |  |  | 400 |
| `production_record` | 制作留痕 | — | file_id |  |  | 360 |
| `master_checkout` | 取料记录 | — | order_item_id + episode_no + staff_id |  |  |  |
| `playable_asset` | 可播放资产 | 主体 + 门店 | uuid |  |  | 350 |
| `zip_bundle` | ZIP 缓存 | — | uuid |  |  | 390 |
| `drama_trailer` | 预告片指针 | — | drama_id |  |  |  |
| `drama_episode_master` | 原片版本 | — | uuid |  |  |  |
| `store_asset` | 门店素材 | 主体 + 门店 | uuid |  |  | 370 |
| `store_asset_file` | 素材文件 | — | store_asset_id + position |  |  |  |
| `store_asset_insight` | 素材理解结果 | — | uuid |  |  |  |
| `store_asset_tag` | 素材标签 | — | uuid |  |  |  |
| `store_asset_usage` | 素材使用记录 | — | uuid |  |  |  |
| `store_asset_demand` | 素材需求 | 主体 + 门店 | uuid |  |  |  |
| `ocr_result` | 证照识别结果 | 主体 + 门店 | uuid |  |  |  |

#### [07 价目、订阅、积分账本](data-model/07-billing-ledger.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `plan` | 套餐版本 | — | uuid |  |  |  |
| `plan_revision` | 套餐价目修订 | — | uuid |  |  |  |
| `plan_promo_claim` | 首期优惠使用记录 | 主体 | uuid |  |  |  |
| `point_pack` | 加购积分包 | — | uuid |  |  |  |
| `price_tier_revision` | 等级模板价修订 | — | uuid | 是 |  |  |
| `drama_price_revision` | 单剧定价修订 | — | uuid |  |  |  |
| `billing_param` | 积分规则参数 | — | uuid |  |  |  |
| `billing_account` | 主体计费账户 | 主体 | entity_id |  |  | 420 |
| `subscription_term` | 订阅周期 | 主体 | uuid |  |  |  |
| `subscription_event` | 订阅事件 | 主体 | uuid + seq | 是 |  |  |
| `grant_schedule` | 月度发放计划 | 主体 | uuid |  |  |  |
| `point_lot` | 积分批次 | 主体 | uuid |  |  |  |
| `point_hold` | 冻结单 | 主体 + 门店 | uuid |  |  |  |
| `point_hold_alloc` | 冻结分摊 | — | point_hold_id + alloc_no |  |  |  |
| `ledger_operation` | 账本操作 | 主体 + 门店 | uuid + seq | 是 |  |  |
| `point_ledger_entry` | 积分流水 | 主体 | uuid + seq | 是 |  |  |
| `billing_entity_daily` | 主体每日快照 | 主体 | biz_date + entity_id |  |  |  |
| `valuation_policy` | 估值口径版本 | — | version_no |  |  |  |
| `point_entry_valuation` | 流水的派生估值 | 主体 | point_ledger_entry_id + valuation_policy_version_no |  |  |  |
| `point_adjustment_request` | 积分调整单 | 主体 | uuid |  |  |  |
| `term_extension_request` | 补偿延长单 | 主体 | uuid |  |  |  |

#### [08 付款单、收款交易、退款、对账、发票](data-model/08-billing-payment.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `billing_order` | 付款单 | 主体 + 门店 | uuid |  | 是 | 290 |
| `payment_txn` | 收款交易 | 主体 | uuid |  |  | 300 |
| `transfer_proof` | 对公转账凭证 | 主体 | uuid |  |  | 310 |
| `refund_request` | 现金退款申请 | 主体 | uuid |  | 是 | 70 |
| `refund_txn` | 退款交易 | 主体 | uuid |  |  | 320 |
| `payment_exception` | 差异单 | 主体 | uuid |  | 是 | 340 |
| `wx_bill_file` | 微信交易账单文件 | — | uuid |  |  |  |
| `wx_bill_line` | 微信交易账单明细行 | — | uuid |  |  |  |
| `recon_day` | 每日对账汇总 | — | uuid |  |  |  |
| `invoice_request` | 开票申请 | 主体 | uuid |  | 是 | 330 |
| `invoice_doc` | 票据 | 主体 | uuid |  |  |  |
| `finance_config_revision` | 受控财务配置版本 | — | uuid | 是 |  |  |

#### [09 订购与广告（order、ad）](data-model/09-order-ad.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `cart_item` | 选剧单 | 主体 + 门店 | uuid |  |  |  |
| `drama_order` | 订购单 | 主体 + 门店 | uuid |  | 是 | 160 |
| `order_item` | 订单项 | 主体 + 门店 | uuid |  | 是 | 170 |
| `order_item_account` | 订单项的发布账号 | — | order_item_id + channel_account_id |  |  |  |
| `order_item_placement` | 广告位绑定 | — | uuid |  |  |  |
| `cancel_request` | 取消申请 | 主体 + 门店 | uuid |  | 是 | 50 |
| `cancel_request_line` | 取消申请明细 | 主体 + 门店 | uuid |  |  | 60 |
| `ad` | 广告 | 主体 + 门店 | uuid |  | 是 | 150 |
| `ad_version` | 广告视频版本 | 主体 + 门店 | uuid |  |  |  |
| `ad_revision` | 广告修改轮次 | 主体 + 门店 | uuid |  |  |  |

#### [10 交付（delivery）](data-model/10-delivery.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `delivery_ticket` | 交付工单 | 主体 + 门店 | uuid |  | 是 | 180 |
| `delivery_ticket_stage` | 环节记录 | — | uuid |  |  |  |
| `delivery_ticket_pause` | 工单暂停原因 | — | uuid |  |  |  |
| `delivery_plan` | 交付方案 | 主体 + 门店 | uuid |  | 是 | 200 |
| `delivery_plan_version` | 方案版本 | 主体 + 门店 | uuid |  |  |  |
| `delivery_plan_change_request` | 方案修改请求 | 主体 + 门店 | uuid |  |  |  |
| `sample` | 样片版本 | 主体 + 门店 | uuid |  | 是 | 260 |
| `episode_output` | 成片剧集 | 主体 + 门店 | uuid |  |  | 220 |
| `qc_record` | 质检记录 | 主体 + 门店 | uuid |  |  |  |
| `delivery_release` | 成片包 | 主体 + 门店 | uuid |  |  | 210 |
| `delivery_reissue` | 补发单 | 主体 + 门店 | uuid |  |  |  |
| `download_grant` | 下载授权 | 主体 + 门店 | uuid |  |  |  |
| `delivery_download_log` | 成片下载记录 | 主体 + 门店 | uuid + seq | 是 |  |  |
| `publish_list` | 发布清单 | 主体 + 门店 | uuid |  |  |  |
| `publish_list_episode` | 发布清单逐集内容 | — | delivery_ticket_id + episode_no |  |  |  |

#### [11 发布：渠道账号、上线、巡检、下架（publish）](data-model/11-publish.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `channel_account` | 渠道账号 | 主体 + 门店 | uuid |  | 是 | 190 |
| `channel_account_submission` | 账号核验提交 | 主体 + 门店 | uuid |  |  |  |
| `launch_task` | 上线任务 | 主体 + 门店 | uuid |  | 是 | 230 |
| `launch_submission` | 链接回填 | 主体 + 门店 | uuid |  |  |  |
| `patrol_batch` | 巡检批次 | — | uuid |  |  |  |
| `patrol_task` | 巡检任务 | 主体 + 门店 | uuid |  | 是 | 250 |
| `takedown_task` | 下架任务 | 主体 + 门店 | uuid |  | 是 | 280 |

#### [12 客服工单（support）](data-model/12-support.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `service_ticket` | 客服工单 | 主体 + 门店 | uuid |  | 是 | 270 |
| `service_ticket_entry` | 工单时间线条目 | 主体 + 门店 | uuid |  |  |  |
| `service_ticket_ref` | 工单关联的业务对象 | — | service_ticket_id + ref_type + ref_id |  |  |  |

#### [13 通知与文书](data-model/13-notify-docs.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `notify_scene` | 通知场景开关 | — | scene_key |  |  |  |
| `wx_template_slot` | 订阅消息模板槽位 | — | slot_key |  |  |  |
| `sms_template` | 短信模板登记 | — | template_key |  |  |  |
| `notification` | 通知 | 主体 + 门店 | uuid |  |  |  |
| `notification_delivery` | 投递 | — | uuid |  |  |  |
| `merchant_message` | 商家端站内消息 | 主体 + 门店 | uuid |  |  |  |
| `staff_message` | 后台员工站内消息 | — | uuid |  |  |  |
| `wx_subscribe_quota` | 订阅消息额度估计值 | — | wechat_identity_id + wx_template_slot_key |  |  |  |
| `manual_reminder_log` | 人工催办限频闸 | — | uuid + seq | 是 |  |  |
| `agreement` | 协议清单 | — | key |  |  |  |
| `agreement_version` | 协议版本 | — | uuid |  |  |  |
| `agreement_consent` | 协议同意记录 | 主体 + 门店 | uuid + seq | 是 |  |  |
| `license_letter` | 定制内容授权书 | 主体 + 门店 | uuid |  | 是 | 240 |
| `license_letter_revision` | 授权书版次 | — | uuid |  |  |  |

#### [14 配置与数据（config、analytics、reports、exports）](data-model/14-config-data.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `dict_type` | 数据字典类型 | — | type_key |  |  |  |
| `dict_item` | 数据字典项 | — | uuid |  |  |  |
| `param_value` | 参数值 | — | uuid + seq | 是 |  |  |
| `site_config_revision` | 站点配置修订 | — | uuid |  |  |  |
| `home_banner` | 首页 Banner | — | uuid |  |  |  |
| `site_notice` | 规则变更公告记录 | — | uuid |  |  |  |
| `feature_flag` | 特性开关 | — | key |  |  |  |
| `checklist_template` | 清单模板 | — | uuid |  |  |  |
| `analytics_event` | 埋点事件 | 主体 + 门店 | occurred_at + id | 是 |  |  |
| `analytics_event_dedup` | 埋点事件去重 | — | event_id |  |  |  |
| `analytics_identity` | 匿名标识与用户的关联 | — | anonymous_id |  |  |  |
| `report_month_close` | 报表月度快照 | — | uuid |  |  |  |
| `export_job` | 导出任务 | — | uuid |  |  |  |

#### [15 回调收件、租约与告警、不变量校验结果（security、providers、ops）](data-model/15-integration-ops.md)

| 表 | 中文名 | 归属列 | 主键 | 只增 | 状态机 | 锁序 |
| --- | --- | --- | --- | --- | --- | --- |
| `webhook_event` | 回调收件箱 | — | uuid |  |  |  |
| `worker_lease` | 任务进程单活租约 | — | name |  |  |  |
| `alert_event` | 告警事件 | — | uuid |  |  |  |
| `invariant_run` | 不变量校验运行记录 | — | uuid |  |  |  |
| `invariant_violation` | 不变量违规明细 | — | uuid |  |  |  |

## 5. 加锁顺序

一个事务需要锁多行时，按下表从小到大加锁（[01](01-architecture.md) 第 7.1 节的九类为主干，并入了各草案的顺序）。表里没有的表不参与排序；计费账户永远最后锁，一个事务只锁一个主体的计费账户。

| 次序 | 表 | 中文名 |
| --- | --- | --- |
| 10 | `assignment_cursor` | 轮询游标 |
| 20 | `staff` | 员工账号 |
| 30 | `approval_request` | 统一审批单 |
| 40 | `account_change_request` | 账号类变更申请 |
| 50 | `cancel_request` | 取消申请 |
| 60 | `cancel_request_line` | 取消申请明细 |
| 65 | `qualification_submission` | 资质轮次 |
| 70 | `refund_request` | 现金退款申请 |
| 80 | `merchant_user` | 商家用户账号 |
| 90 | `wechat_identity` | 微信身份 |
| 100 | `entity` | 经营主体 |
| 110 | `invitation` | 店员邀请 |
| 120 | `entity_member` | 成员关系 |
| 130 | `store` | 门店 |
| 135 | `store_profile` | 门店档案 |
| 140 | `drama` | 剧目 |
| 150 | `ad` | 广告 |
| 160 | `drama_order` | 订购单 |
| 170 | `order_item` | 订单项 |
| 180 | `delivery_ticket` | 交付工单 |
| 190 | `channel_account` | 渠道账号 |
| 200 | `delivery_plan` | 交付方案 |
| 210 | `delivery_release` | 成片包 |
| 220 | `episode_output` | 成片剧集 |
| 230 | `launch_task` | 上线任务 |
| 240 | `license_letter` | 定制内容授权书 |
| 250 | `patrol_task` | 巡检任务 |
| 260 | `sample` | 样片版本 |
| 270 | `service_ticket` | 客服工单 |
| 280 | `takedown_task` | 下架任务 |
| 290 | `billing_order` | 付款单 |
| 300 | `payment_txn` | 收款交易 |
| 310 | `transfer_proof` | 对公转账凭证 |
| 320 | `refund_txn` | 退款交易 |
| 330 | `invoice_request` | 开票申请 |
| 340 | `payment_exception` | 差异单 |
| 350 | `playable_asset` | 可播放资产 |
| 360 | `production_record` | 制作留痕 |
| 370 | `store_asset` | 门店素材 |
| 380 | `upload_batch` | 批量上传批次 |
| 390 | `zip_bundle` | ZIP 缓存 |
| 400 | `media_job` | 媒体任务 |
| 410 | `file_object` | 文件对象 |
| 420 | `billing_account` | 主体计费账户 |

要点：审批单在最前，领域申请单紧随其后，审批执行的事务都从审批单进入；账号与租户链（商家用户 → 微信身份 → 主体 → 邀请 → 成员 → 门店）排在申请单之后；跨订单共享的行（剧目、广告）排在订购单之前；资金类单据在履约之后；媒体与文件在最后、计费账户之前。

## 6. 相对主文档与草案的变化

### 6.1 已回写主文档的四处

| 原写法 | 现在 | 回写位置 |
| --- | --- | --- |
| 状态迁移只经 `flow.transition()`（01 第 6.3 节） | 只限 25 张业务状态机表；账本内部状态与技术状态不写状态历史 | 01 第 6.3 节 |
| 原片版本归短剧库（01 第 5 节） | 原片版本、预告片的表归 media（文件与体检在 media），短剧库经端口取用 | 01 第 5 节 |
| 金额一律 `integer`（ADR-007） | 对账日汇总与媒体成本估算用 `bigint` | 04 ADR-007 |
| 银行流水号、付款行在对公转账凭证上（03 第 1.2 节） | 放在实际到账的收款交易 `payment_txn` 上 | 03 第 1.2 节 |

### 6.2 相对草案的主要结构变化

| 变化 | 说明 |
| --- | --- |
| 主键统一为 UUID v7 | 多份草案用自增整数（R1） |
| 审批单收窄 | `approval_request` 只记“批没批”；内容与执行状态在一对一的领域表（`refund_request`、`cancel_request`、`point_adjustment_request`、`term_extension_request`、`account_change_request`、`qualification_submission`、`channel_account_submission`、`launch_submission`）。开票申请、对公收款确认、素材复核是处理队列，不进审批单 |
| 新增的表 | `cancel_request`（取消退回积分的头表）、`channel_account_submission`（账号核验每轮提交）、`sms_verification`、`referral_code`、`wecom_contact`、`zip_bundle`，以及 d8、d9 的 11 张表 |
| 不建的表 | 服务商（V1.1）、渲染任务（V1.1）、计费月结（首个月结前补） |
| 调整归属 | 下载页会话归身份模块；运营跟进记录归员工模块；人工催办限频归通知模块；ZIP 缓存从成片包拆到 media；多个“通用表”下沉到低层，避免同层互调 |
| 命名统一 | 外键列用被引用表全名；“第几个”统一为 `position` 或 `_no`；状态与多态取值用最终表名；清单模板引用统一为 `checklist_code`、`checklist_version_no` |

逐表的改动见各分组文档；七份草案不回改。

## 7. 待确认

下列问题会影响表结构，都已按默认做法写进了表里。结论与默认相反时，按“要改什么”一栏调整，影响局部。细节见对应分组文档第 6 节。

### 法务

| 问题 | 默认做法 | 分组 |
| --- | --- | --- |
| 统一社会信用代码能否明文存储 | 加密加盲索引 | [02](data-model/02-identity-tenant.md) |
| 建档“信息确认”算不算同意记录 | 记在资质轮次上，不进同意记录 | [04](data-model/04-profile.md)、[13](data-model/13-notify-docs.md) |
| 三类剧的节目编号是否必须按平台分别录入 | 库里不禁止“全平台”，下单拦截强度由参数控制 | [05](data-model/05-content.md) |
| 自有版权的止日口径；归档是否为终态 | 止日可空但不填不能上架；归档是终态 | [05](data-model/05-content.md) |
| 商家能否自助删除素材；个人信息删除后文件行是否保留；肖像授权材料怎么收、留多久 | 不提供自助删除；行保留；在素材上补交、被采用过的保留 3 年 | [06](data-model/06-media.md) |
| 广告视频的查看证据是否要与样片完全相同 | 不加访问回写列 | [09](data-model/09-order-ad.md) |
| 企业微信发送水印版能否作为样片确认证据 | 先保留这一种查看方式 | [10](data-model/10-delivery.md) |
| 注销后同意记录里的手机号能否留存；名称变更后授权书是否换版；只有 PDF 的协议能否生效；站内消息保留期；作废授权书后是否自动重出 | 留存；不联动换版；库里允许、服务层要求双文件；不清理；作废并重出 | [13](data-model/13-notify-docs.md) |

### 业务、产品

| 问题 | 默认做法 | 分组 |
| --- | --- | --- |
| 下载页会话按确认起 2 小时过期，还是闲置过期 | 确认起 2 小时 | [02](data-model/02-identity-tenant.md) |
| 持有生效套餐的老板，新微信登录是否要已有微信确认 | 不做 | [02](data-model/02-identity-tenant.md) |
| 联系人手机号取登录手机号时是否记验证时间；主推服务草稿缺名称或现价时是否落库；营业时间的结构 | 不记；不落库；时段数组、不分星期 | [04](data-model/04-profile.md) |
| 详情页贴片时长是否按剧定义；改热度等级是否要定时生效与调价记录 | 不建列；即时生效 | [05](data-model/05-content.md) |
| 素材需求的状态与“完成时间”是日期还是时刻 | 三态、手动结束；记日期 | [06](data-model/06-media.md) |
| 首期优惠形式与退款后是否返还名额；大客户专属套餐 | 只有“沿用上一版价目一个周期”，不返还；只声明、不启用 | [07](data-model/07-billing-ledger.md) |
| 资质终审不通过时是否退套餐款 | 保留这条规则 | [08](data-model/08-billing-payment.md) |
| 选剧单按门店还是按用户保存；订购单子状态的取值；广告是指派时扣积分还是开始制作时扣；平台原因取消广告时超次修改的扣减退不退 | 按门店；按草案的 21 个取值；指派即扣；不退 | [09](data-model/09-order-ad.md) |
| 账号核验队列是否显示指定处理人 | 不指定，按权限进入角色队列 | [11](data-model/11-publish.md) |
| 店员能否提交客服工单 | 只有老板能提交 | [12](data-model/12-support.md) |
| 导出不脱敏数据是否要审批 | 不设审批流 | [14](data-model/14-config-data.md) |
| 年度放假安排的依据文号是否留存 | 只写进导入审计 | [01](data-model/01-kernel-flow.md) |

### 财务、税务

| 问题 | 默认做法 | 分组 |
| --- | --- | --- |
| 积分价值的估值口径 | 套餐款全额计入，口径带版本 | [07](data-model/07-billing-ledger.md) |
| 开票时点（充值时还是消耗时）与开票项目名称；开票申请的处理时限；线下退款回单是否必传；将来部分退款时的开票口径 | 按付款单全额、一对一；时限未配置时为空；必传；V1.0 不支持部分退款 | [08](data-model/08-billing-payment.md) |

### 架构与运维

| 问题 | 默认做法 | 分组 |
| --- | --- | --- |
| 托管 PostgreSQL 是否提供 `btree_gist` | 建订阅周期不重叠的排他约束 | [07](data-model/07-billing-ledger.md) |
| 文件存储是否用归档层 | 只用标准与低频存储，不建“恢复中”状态 | [06](data-model/06-media.md) |

## 8. 校验与下一步

**校验**：在本机执行 `python3 tools/schema-check/check.py`（准备步骤见 [tools/schema-check](../tools/schema-check/README.md)）。草稿已冻结，结构以迁移为准：它在临时库里跑完 `packages/db` 的全部迁移，再逐列比对分组文档与库结构；由草稿 `schema.prisma` 与 `constraints/` 建库的旧流程留在 `--from-draft`。改动任何一份分组文档后都应重跑；`schema.prisma` 与约束文件不再改（`pnpm db:draft-freeze:check` 把守），结构要变就写新迁移。

**没有验证的**：业务代码与真实数据下的行为；Prisma 迁移工具生成的迁移脚本（只用了离线生成建表语句）；PostgreSQL 17 上的执行（本机校验用 14）；性能与索引在真实数据量下的效果；各文档里的 mermaid 图没有用渲染工具检查。

**下一步**：

1. 接口契约（[07](07-api-contract.md)）以本文为依据，已完成。写契约时发现的数据模型缺口已回写到分组文档（各分组文末“接口阶段回写”一段；汇总见 07 第 6.1 节），回写后重跑校验通过；改了结构的只有 `file_object.erased_at` 一列与两处枚举取值。
2. 开工时由 `schema.prisma` 与 `constraints/` 生成 `packages/db` 的第一版迁移；之后表结构以迁移为准，本目录的草稿随之冻结。
3. 第 7 节的问题有结论后，按“要改什么”调整对应分组文档、`schema.prisma` 与约束文件，并重跑校验。
