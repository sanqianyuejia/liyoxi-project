# content 最小集（W1-13）

所有写函数第一参数是内核 `Tx`，由调用方在 `tx.run` 内使用；时钟、flow、media 与装配显式注入 `createContent`。M1 写侧只处理从未上架的草稿：`createDraft`、`saveBasic`、`saveCommercial`、`saveRoles`、`createPermit`、`saveCopyrightDraft`、首次 `list`。签名取 a04 的对应请求体；总集数保存同步集号，版权用自己的 `lockVersion`，其余聚合修改推进剧目版本。

`list` 在剧目行锁内执行 L1–L14，再由 flow 在同一事务写状态与随迁列、活动审计、首次版权修订与指针、证明引用和 `drama.listed`。创建同样经 flow 发主干已有的 `drama.created`。M1 不含下架、重上架、版权变更、归档或定价写侧。

`DramaPricePort` 由 billing 的真实 `priceAt` / `paramsAt` 实现。`getDramaCards`、`visibleCatalog`、`getOrderability`、`assertOrderable` 使用该端口与 shared/catalog 自然月谓词；后者返回供 W1-15 保存的 `DramaSnapshot`（公开字段及所选平台的有效许可）。折扣与广告计价归 workbench/mall，用 shared/pricing 的同一 HALF_UP 函数。

静态 `content.I1` 需要进程装配 `bindContent(assembly)`：API runtime 和独立 worker 均已连接；未绑定明确报错。绑定返回退出作用域的恢复函数，测试须调用；业务工厂不取全局状态。M1 登记 I1、I2、I4–I7，I2 仅检测并告警（`heal=none`），I3/授权到期定时器与迁移随 M3。

四种文件引用经 kernel 的 fileRefTypePort 登记，content 不引 media 私有文件。海报被替换后保留旧引用；从未上架草稿的移除证明可释放；上架后的许可与版权证明保留，归档释放及按授权止日计算保留期随 M3 写侧补齐。

`seedDemoContent` 拒绝 prod，以服务函数造 S/A/B、一/二/三类三部双平台/单平台剧；自带纯色 PNG 经 media 入库，按固定剧名跳过已上架行。字典补项只新增缺失编码，保留运营已修改或停用的项。集数、授权平台、两年止日在 `demo-seed.ts` 可核对。

验收：`vitest run src/content/ src/config/insert-dict-items.db.test.ts src/ops/content-worker.db.test.ts`；接口层 `apps/api/test/mall.test.ts` 与全已挂载店员回放。M1 留桩见 docs/plan/status/W1-13.md；四条 route 与输出契约在 m04。Banner 只使用本域契约里已明确的 DeepLink 键和参数，未知规则拒绝下发，后续由 notify/m08 公共 DeepLink 契约包统一并覆盖其余正式合法键，本包 13 键只是 M1 参数已明确的子集。

W2-24 性能伴随将 assertOrderable 的私有 facts 读取收窄到实际消费的剧目快照字段、当前授权平台/止日和按 id 排序的 active 许可。此入口原来未消费的剧集和海报状态不再回读；完整 listingChecks 仍用原完整 dramaFacts，许可/类别/平台/日期判断和返回快照不变。
