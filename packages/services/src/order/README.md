# order：订剧、选剧单与订单读侧

W1-15a 交 `m.order.quote`、`m.order.create`；a 的 #91 已合主干；W1-15b 交选剧单与读侧 12 条。公开入口为 `createOrderService`、`OrderActor`、`OrderDeps`，API 只转交真实商家身份、当前门店和 `idemOf`。

阅读顺序：`checks.ts` / `accounts.ts` → `quote.ts` → `submit.ts` → `read.ts` → `register.ts` / `invariants.ts`。契约在 contract 的 m04 `order.schemas.ts`，完整 `OrderDetail` 与 C50 首响应/重放从 a 起共用。

## 报价

报价不锁账户、不推进周期、不写业务行或同意证据。生效权益和钱包来自 billing 的公共只读函数；逐部 HALF_UP 复用 shared/pricing，分摊预览复用 shared/alloc。退款处理中可花积分为 0，分摊为空、短缺为整单应冻数。档案、闸门、行业、账号和可订判定与提交同源；业务错误进入 blockers，请求形状错误仍拒绝。不存在的剧不捏造卡片，而返回对应 blocker 与空的逐部报价。发布配置缓存先在事务外读；当前开放广告位在事务内按实际参数求交集；图片签名在事务结束后。

渠道账号只读本域需要的 channel_account 列，不 import publish。查询先限定门店（保留解绑以区分 not_available），展示排除解绑；每个平台至多 1 个、只有 available 可选，选中顺序保留输入顺序。

## 同一事务

1. 幂等登记后按实际 entity100 → entity_member120 → store130 锁定；重核老板成员与当前档案、闸门、行业、订阅、账号、许可、素材/广告和上线日。
2. 预生成订单/项 id、LYX 单号与 immutable 整单账本标题；公共 Docs 在真实 Tc 追加同意证据。
3. 按请求顺序逐部调用真实 `billing.hold`，只传 `{kind: 'drama', dramaId, topModel}` 与该部 expectS；第一次 hold 才取得账户420锁，计价、周期推进、批次和操作键都归账本。
4. 捕获 QUOTE_CHANGED / POINTS_INSUFFICIENT 两种纯应用拒绝时，在已持有账户锁和账本时刻读取整单真实报价；不足余额加回本次已冻部分，使 details 使用提交前余额与 ΣS。向外抛错让幂等、同意、账本和整单全部回滚。其余异常原样抛出。
5. 首次 HoldResult.now 的复制为 Tf。再次核对不可变标题用到的 P/R/T（即使变化抵消为相同 S 也拒绝），并在公共 currentVersions 的真实 Tv 晚检协议版本；标准 stale 整笔回滚。Tc/Tf/Tv 不保证相等，既不回填证据也不预锁账户。
6. 以 Tf 插完整订单/项/账号行，fresh `created:true` 初始迁移的专用 Flow 仅把时钟适配为该真实 Tf，仍依赖实际 assembly/events；普通后继迁移继续用 runtime.clock。逐项与整单产生历史/审计，清理本次选剧单，full 闸门 arm 真正 scheduled 的 order.start，最后发唯一 order.submitted。parallel 不 arm，子状态 qualification_reviewing。

新建 submit 的响应使用本事务实际 INSERT RETURNING 的母单和各项（包括数据库默认值）；纯 DTO mapper 与正常详情 GET 共用。GET 始终 fresh 回库；新建响应的套餐、协议版本/名称及账号关联/名称仍在事务末尾读取。详情内字典一次按 type+code 批读，保留输入顺序、重复、停用名称和缺码回落；没有跨请求缓存或手造默认值。`detail-created.db.test.ts` 将三剧新建结果每字段与同TX fresh详情比较，并验证末尾名称变更。

提交入口只 freeze，不 capture、不建 placement/工单。首响应提交后签海报；幂等持久结果及重放 `items[].posterUrl` 为 null，重放不再签发。真正扣减与工单交给下述异步开工入口。

## 移交

- `profile.order_manager_sync` 已实现：调用方先持 store130，本端口再按 UUID 顺序锁未结 orders160，按明确 input.staffId 改写、返回实际 count。同值返回 0，结束/取消/已退单不改；不读取旧门店经理来猜目标。
- `order.start` 已登记真实 critical / rearmAfterSkip 处理器；下单、资质决定与补偿扫描仅 arm，处理器在每张单自己的事务内开工。
- 待办/售后/授权书/履约字段为已登记留桩。order.submitted 是 analytics 目录的 outbox 来源，M7 的 analytics.fromOutbox 尚未实现；不重复直记 order_submit 或声称已有 analytics 行。通知 orderForNotify 公共读端口尚为空。
- b 复用完整 DTO 和 read.ts，补常规列表/详情与阶段读侧。a 的 pointsEvents 验收覆盖实际冻结流水，后续 capture 的套餐/加购消费分拆及真实工单/方案内容由 W1-17 履约读侧补齐。

## 验收

公开测试前置在 `@liyoxi/services/testing` 的 prepareOrderFixture，接受真实 prisma / runtime.order / api.clock 及 API 已建主体、门店、老板，准备真实档案、订阅入账、账号、许可、协议；私有服务 harness 复用其档案/剧/协议准备。没有在应用测试跨入领域私有夹具。

`src/order/quote.property.test.ts`：种子 115、116、117，各 200 轮真实库；三部逐次 HALF_UP、真实 expect 提交、套餐+加购预览与 hold 分摊。
`src/order/submit.concurrency.test.ts`：5 条独立连接、k=3 的 20 轮 n>k；同键两连接；实际账户锁 3–4 秒 ACCOUNT_BUSY。
`submit.test.ts` / `guards.test.ts` / `quote.test.ts` / `manager.test.ts` / `invariants.test.ts`：全/并行副作用、整单变价/同S标题变化、真实周期切换、跨零点 Tc/Tf、Tv 协议变化、16 守卫、只读边界、真实同步数及已登记 full 不变量。API 的 order.test 与 clerk 回放验证实际鉴权和 C50。

## 选剧单与读侧（b）

`cart.ts` 对同一店的新增、删除与接受变价持咨询锁50；新增先查自然唯一行，已有项原 P 和加入时间不变，即使已满50或已下架也返回该行。当前 P 来自公开 content/billing 读侧，套餐仅影响逐部 S：只改折扣而 P 不变仍 valid。接受价格必须提交当前 P，失效卡片不可接受；同P不写 priceAckedAt。接受首响应事务后签海报，持久幂等结果与重放海报为空，重放不再次签名。物理删除按门店/主体归属校验，通过 required 幂等使原 key 重放继续返回 null。

`merchant-read.ts` 按当前老板门店和主体查询，商家订单号按完整值匹配。订单按提交时间降序，订单项按上线中、待上线、已结束三组分别以使用期结束日升序、约定上线日升序（空值最后）、提交时间降序排列，UUID升序打破同刻并列。`cursor.ts` 绑定过滤条件与门店/主体；不合法或换条件的游标按 C42 回首屏。真实 SQL keyset 分页不会先取全表再切片。快照标题/标价/折扣/加扣保留订购时事实，当前渠道账号名称/UID/type 只读查询。remainingDays 只在 live 返回 max(0, 使用期结束日减北京今日)，其余阶段为 null。

`admin-read.ts` 与三个 defineAdminHandler 的 order:view、真实 all/group/own DataScope 接线；订单范围仅按负责门店，剪辑/发布任务不会额外扩大范围。页码默认20、上限100，三种排序均以 UUID 打破并列。summary 接同一筛选（不含tab），列表与总数取同一条件。下单日期按北京自然日双端包含；“只看资质驳回超期”取该门店最近一次真实 qualification rejected decidedAt，严格超过实时参数天数，false 不作此限制。详情复用已校验归属的公共账本流水读侧，不写资金、审计、状态历史或派生记录。

`counts.ts` 的公开 `countCartBadge(tx,storeId,at)`、`countOrderItemsByPhase(tx,storeId,orderId?)`、`countOpenOrdersByEntity(tx,entityId)`、`countBlockingStoreOrders(tx,storeId)` 为纯读。前者过滤下架、许可失效与非正价，显式接调用方时刻，空集合返回0；实体未结数排除 ended/cancelled/refunded，门店停用阻挡数只含 pending_start/producing/to_launch/after_sale。当前 tenant 尚无 StoreCloseGuard 注册口，交真实计数供后继接线，不声称停用守卫已落地。`register.ts` 的 order MerchantFacts 返回实际 live/producing+to_launch/cart，待办仍 M7 的0。商城首页三数量与详情 cartItemId 已回补，店员/游客裁剪保持。

b 的完整 AdminOrderDetail 声明参考素材、售后、授权书、工单/方案后继字段；参考素材/售后/授权书为登记过的空数组或0，工单/方案为null。openCancelRequest 卡片只读已存在的真实行，actions 在未有取消实现前为空。read.ts 的 detail 参数仅需 membership 的 storeId/entityId，后台在已完成实际 DataScope 归属判断后复用；未替换履约时间轴，W1-17 可普通同步后续接线。

b 目标验收：`cart.test.ts`（两独立真连接49→50/51、P/S、自然重复、C50、跨店与店员）、`read.test.ts`（八状态、三组稳定分页、北京日期、最新驳回阈值、真实计数与零资金写）；API `order-read.test.ts` 覆盖12处理器及商城三事实、clerk全回放保留原黄金，admin矩阵只增本包3条。

## 原子开工与触发点（W1-17b）

`startOrder(tx,deps,id)` 先预读待开工/full/无在途取消，再把两池候选和现有经理按 UUID 升序取员工共享锁，锁后重验并调用真实分配口。先锁门店及指派可能同步的未结父单、项、工单，首次经理指派在账户锁之前完成。M1 的池仍按工号最小启用员工选人，城市和轮询由 G2-A 回补；池空时经理为空，工单进入 assigning。

整张单逐项调用真实 `ledger.capture`，只允许 held 冻结单，任一项失败整单回滚并告警一次。真实 capturedAt 来自账本账户锁后的写入；以首次捕获时点创建局部 Flow，订单项 captured_at/phase 和父单 started_at/status 在对应迁移的同一 UPDATE 写下。随后调同事务 `createTickets` 创建每项一工单和一份方案初稿，发携真实工单 ID 的唯一 `order.started`。资金、经理同步、工单、历史、审计和事件一起提交；等待期间订阅已过期仍开工。已非待开工的重试只返回 skipped。

两个 critical 订阅者分别处理资质决定与套餐生效。资质决定按当前门店事实逐单登记 `max(now,submittedAt+delay)`，重复不推迟既有 scheduled/dispatched 行；驳回仅改 qualification_rejected。套餐生效只给同主体启用且缺经理的门店指派、同步未结单，既有经理不动，池空不写。每 5 分钟的 tx 补偿只为 full/待开工/无取消且缺 scheduled/dispatched 的单补登记或复活 failed/skipped，每命中报 P3；不在补偿事务内直接扣减。

组合根绑定 `OrderStartBinding` 的真实公开依赖，关闭时解除本作用域；未绑定明确 INTERNAL。通知取数仍调 `orderForNotify` 空端口；正式 x01 的 `order.started` 下游为 docs/notify，授权书 M5、通知 M2；未登记的直记埋点不自造，M7 接收方再按正式事件目录接线。

`start.concurrency.test.ts` 用 3 条 max=1 的独立连接、实际 backend PID 和事务栅栏重复 20 轮：真实 skipped → 补偿同键复活后，重复定时器执行与资质订阅者并发，整单每项仅扣减/建工单/迁移一次。`start.fault.test.ts` 由子进程真实 capture 后停在断点，父进程发 SIGKILL；父连接在断点上看不到未提交写，连接死后整笔回滚，同条消息重试只扣减一次。既有 a 的状态推导与读侧验收不重复改写。

W2-24 同阶段资料守卫经 profile 公口读取一次事实，再依原顺序拒绝基础缺项、资格不符和行业未开放。资格 `blocked` 仍真实重读当前门店与按 `createdAt DESC` 的最新轮次后给原原因；报价仍分别收集三个守卫的 blockers。取号前初检、真实 Tf 后守卫各自 fresh：正常路径资料读取由每阶段三次变一次（设计减少总4次/取号后2次 RPC），无新性能通过结论；No、Tc/Tf/Tv、账户锁、资金与自检时序保持。
