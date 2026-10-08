# 商家档案与首店资质（W1-08a、b）

a 已合并交付商家十三条 API 与进程内核心；b 补后台六条，总计十九条。依据任务书第 2、9、10 节，M1 只做首店 `initial`，含非终局驳回后的补传、重新送审。

qualification 审批类型在 a 登记既定权限与决定 operationId；b 在生产清单挂载六条后台处理器，并用 `handlerOf` 只读取门店真实交付经理；经理为空仍沿既有门店范围回退。W1-09 后台页面必须等 b 实际合入 main 后开工。

`createProfile` 从事务入口、时钟、tenant、approval、media、事件、密钥环与微信能力装配。API 在 `apps/api/src/merchant/services.ts` 最小接线；模块登记由组合根加载，API 和 worker 都能看到 qualification 审批类型、四种文件引用与九项不变量。没有改兄弟 factory 或 runtime 的既有行为。

- 阅读顺序：共享 `profileCompleteness` 与契约 → `repo.ts` / `views.ts` → `service.ts` / `write.ts` → `draft.ts` / `documents.ts` → `submit.ts` / `qualification-kind.ts` → `gate.ts` / `assign-manager.ts` → `register.ts` / `invariants.ts`。
- 基础、服务、联系人保存复用 ThreePhaseRunner：只读 claim、事务外 `wechat.checkText`、settle 锁行重读版本与守卫。done 重放不检测；不可用拒收，业务表不变。当前会话 raw openid 只在该外呼使用，不进响应、审计或日志。
- GET 现算完整度、不写缓存。写事务末尾同步缓存三列。`assertProfileComplete` 只查前三步，与完整快照共用基础字段计算；每次真实读基础档案、未移除媒体/服务和媒体stored/moderation状态，未消费的资格历史不参与该守卫。资质提交查四步；`storeGate` 为 full / parallel / blocked；`industryOpen` 按当前行业、品类和区域开放值读取，历史停用字典仍能显示名称和保留。
- 明文解密集中在仓储；联系人登录号按源列 AAD 解开后按目标列重新加密。DTO 只回 mask。审计公开门店电话以 `publicContactNumber` 记，避免被手机号键词误遮；敏感键规则没改。
- 文件经真实 media.link/release。先锁完整文件集合再逐项重入；资格草稿替换保留7天，档案引用替换保留30天。DTO 入幂等记录时 URL 均空，首响应与 GET 在事务后签发（含视频封面），done 重放不重新签。
- 提交锁轮次65→主体100→门店130→档案135；决定由 approval 先锁员工20、审批30，再进入领域回调。tenant 写门店/主体状态与认证字段；审批、资格、租户三条链与事件同事务。认证唯一冲突只在保存点认 `uq_entity_uscc_bidx_verified`，并发失败方保持在审。
- 首次指派经理核心收 Tx：员工共享锁20→门店130；员工停用、角色与接收范围有独立错误原因；两个下游端口和门店更新同事务。W1-15 回补 `orderManagerPort`，W1-16a 回补 `deliveryManagerPort`。

M2/M3 规定留桩、首页三个聚合与两项 M1 写端口均在 `docs/plan/stubs/`。`profile.I7` 的检查、自愈与资质通过订阅者在 M2；已登记 I1–I6、I8–I10，其中 I6 同事务修正三列并返回 healed。I1 真库反例夹具只在测试会话独立库内暂时移除两索引、强制事务回滚，随后核对索引恢复及正常唯一约束；迁移与共享库不变。

API 的响应沿既有 `respondByRole` 以本请求会员角色裁剪，写路由的店员能力统一拒绝。clerk 样例追加全部十三条，旧黄金不改；A86 的服务现价与原价按现有完整路径登记例外。卖点 `sellingPoints` 与 C57 键扫描词冲突由调度单独 gate-change 收口，本业务包不放松扫描逻辑。

## 后台六条（W1-08b）

`profile.admin` 提供 list/get/qualification/approve/reject/assign；API 薄壳统一声明 merchant:view，写侧另取契约权限点。读侧复用 storeScope，范围外与不存在都为404，GET 不补行、不刷新缓存。列表完整支持 q、regionCode（省市区/功能区）、行业品类、资质多值、交付经理/未分配互斥、主体、生命周期；M1 排序为 registeredAt（缺省倒序），其他筛选/排序明确400。详情 paid 是主体合计；列表仅首店展示 totalPaidFen。

决定按 staff20共享锁（同级UUID排序）→approval30→qualification65→entity100→store130→profile135。后台只补前置守卫的顺序：范围→待审→禁止自审→权限与override追加权限→版本→confirm；实际领域效果复用 a 的 approval 类型，不另写决定逻辑。缺回显交给领域返回 CONFIRM_MISMATCH，故请求 schema 允许缺 confirm/roundNo；M1 override/终局/变更不开放。决定与完整脱敏DTO同事务保存供幂等重放。资质DTO仅含证照 fileId；原图走既有 admin.file.downloadUrls 的5分钟地址与access审计，不在本DTO预签。

跨层后台字段由本域 keyed `adminProfileFactsPort`（profile.admin_facts）提供。实现方用 `implementAdminProfileFacts(source, provider)` 注册 billing/order/delivery/support/staff 各自的严格结构；传入 entityId/storeId/managerId/ownerId/now，只读、无外呼。订单来源拥有上线剧数、使用期汇总与最近约定上线日，交付来源拥有交付工单数与经理工单工作量。未注册键按字段给 none/0/null/空数组，M2 G2-B 回补，见后台聚合留桩。它不复用商家端 merchantFacts，以免放宽角色裁剪。

后台首次指派显式 allowArchived；既有商家/系统调用仍默认拒绝归档。锁目标staff20共享、门店130后校验原经理为空，再调用两个同步端口，最后 tenant 写门店及唯一ops审计。同步端口 Promise<void | number> 兼容旧空实现：void记0，实际实现必须返回本次改写数量；响应 synced 与审计 meta.synced 同值，note只写reason_text。同步端口应按明确 input.staffId 写入，调用时门店行已锁、deliveryManager列尚未更新；不得借旧列替代输入。下游新增锁须高于已持store130，order160/delivery180保持原锁序；任何端口失败整事务回滚。W1-15/W1-16a 回补同时补真实数量。

本域 m03 对 named schema 的可空引用改用 common.orNull，避免生成器把 DictRef、MediaFileView 等组件污染为可空或空对象交集；源 schema 行为不变，非空字典/null与媒体必有字段有真实类型消费者回归。没有改全局生成器、内核、DDL、锁序常量、依赖或 layers。

W2-24 的必要性能伴随把 `industryOpen` 当前字典读取合成一次批读，键为 type+code；仍按行业、品类、省市区、功能区的原顺序解析和短路，早项关闭不会触发后项坏ext错误。订购初检和真实Tf后的守卫各自读取当前值，没有跨请求缓存或省略二次守卫。

W2-24 的前三步守卫以一条当前事务查询读取 store LEFT profile、按 position 排列的未删除媒体及其当前 file 状态/检测结果、未删除服务的真实数量，再复用与完整 snapshot 同源的 basicFilled/profileCompleteness。缺档案保持 null，空媒体/服务保持真实空值，缺门店仍 NOT_FOUND；完整四步、资格历史和 I6 自愈不变。

W2-24 的订购同阶段 `getOrderProfileFacts(tx, storeId)` 以一条真实查询读取前三步资料、当前资格门及行业字典事实；前三步复用 `basicFilled/profileCompleteness`，行业仍在资格通过后用 `industryOpenFromOrderFacts` 按原顺序解析。初检与真实 hold 后各自重新查询；旧单项公开读取、完整四步、资质历史与 I6 自愈保持原范围。单阶段 READ COMMITTED 的三次 statement 快照合成一次，且该查询故障会暴露合并关系的错误，不缓存到下一个阶段。
