# 页面清单

<!-- 生成物，勿手改。重新生成：node infra/ci/pages/generate.mjs；CI 用 --check 核对无差异。 -->

| 项 | 内容 |
| --- | --- |
| 用途 | 三个前端的逐页清单：一页一行，写里程碑、工作包与是否已实现。CI 由它统计“应实现未实现页面数”，每个里程碑退出时为 0（[计划](../08-development-plan.md) 第 5.7 节“页面”行、第 8.3 节） |
| 来源 | 运营管理后台：`apps/admin/src/lib/menu/`（菜单登记表，一个模块一个文件）；电脑端下载页：`apps/portal/src/pages.ts`；商家端小程序：`apps/weapp/src/pages.ts` |
| 怎么改 | 改登记文件，再跑 `node infra/ci/pages/generate.mjs`，与登记文件同一个 PR 提交。页面包合并时把自己那一页的“已实现”改成 true；改里程碑归属另在 `docs/plan/changes/` 记一条（计划 第 5.7 节） |
| 还没有的 | 商家端小程序的部分由 W0-27a 加数据源（`infra/ci/pages/sources/`） |

## 1. 汇总

| 端 | 登记 | V1.0 应实现 | 已实现 | 未实现 | V1.1 只登记 | 入口隐藏 |
| --- | --- | --- | --- | --- | --- | --- |
| 运营管理后台 | 80 | 67 | 0 | 67 | 13 | 2 |
| 电脑端下载页 | 8 | 7 | 0 | 7 | 1 | 0 |
| 商家端小程序 | 49 | 48 | 0 | 48 | 1 | 0 |

应实现未实现页面数，按里程碑：

| 端 | M1 | M2 | M3 | M4 | M5 | M6 | M7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 运营管理后台 | 18 | 12 | 6 | 14 | 1 | 4 | 12 |
| 电脑端下载页 | 0 | 0 | 0 | 0 | 0 | 7 | 0 |
| 商家端小程序 | 25 | 8 | 5 | 4 | 3 | 1 | 2 |

“入口隐藏”的页面照做、外壳不给入口（规范 第 14 节第 12 项），计入应实现，不算留桩。

## 2. 运营管理后台

菜单登记表是菜单、面包屑、路由守卫、角标的唯一来源（D7 第 5.2 节）。画板 56 个：V1.0 43 个，V1.1 13 个只登记、带开关键、默认不显示。无画板业务页 16 个。

“工作包”一栏：已拆包的写编号，未拆包的写工作包组（如 G2-A），拆包 PR 改成编号。

### 2.1 画板页（56）

| 模块 | 页面 | 地址 | 画板 | 骨架 | 进菜单 | 开关 | 里程碑 | 工作包 | 已实现 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 工作台 | 工作台 | `/` | Main | 仪表盘 | 是 | — | M7 | G7-B | 否 |
| 短剧库 | 短剧列表 | `/dramas` | Dramas | 筛选表格 | 是 | — | M3 | G3-B | 否 |
| 短剧库 | 编辑短剧 | `/dramas/$id` | DramaEdit | 详情页 | 否 | — | M3 | G3-B | 否 |
| 套餐与积分 | 套餐管理 | `/billing/plans` | Plans | 配置页 | 是 | — | M4 | G4-C | 否 |
| 套餐与积分 | 积分包管理 | `/billing/point-packs` | PointPacks | 筛选表格 | 是 | — | M4 | G4-C | 否 |
| 套餐与积分 | 积分价模板与参数 | `/billing/params` | Params | 配置页 | 是 | — | M4 | G4-C | 否 |
| 套餐与积分 | 单剧积分价 | `/billing/pricing` | Pricing | 筛选表格 | 是 | — | M3 | G3-B | 否 |
| 套餐与积分 | 积分账户与流水 | `/billing/accounts` | PointAccounts | 筛选表格 | 是 | — | M4 | G4-C | 否 |
| 商家 | 商家列表 | `/merchants` | Merchants | 筛选表格 | 是 | — | M2 | G2-B | 否 |
| 商家 | 商家详情 | `/merchants/$storeId` | MerchantDetail | 详情页 | 否 | — | M2 | G2-B | 否 |
| 商家 | 资质审核 | `/merchants/review` | Review | 审核工作台 | 是 | — | M1 | W1-09 | 否 |
| 订单 | 订购单与付款单 | `/orders` | Orders | 筛选表格 | 是 | — | M1 | W1-19 | 否 |
| 订单 | 订单详情 | `/orders/$orderNo` | OrderDetail | 详情页 | 否 | — | M1 | W1-19 | 否 |
| 订单 | 对公收款确认 | `/orders/receipts` | Receipts | 审核工作台 | 是 | — | M1 | W1-12 | 否 |
| 订单 | 套餐到期 | `/orders/renewals` | Renewals | 主从页 | 是 | — | M4 | G4-C | 否 |
| 交付 | 工单池 | `/delivery/tickets` | Tickets | 筛选表格 | 是 | — | M1 | W1-19 | 否 |
| 交付 | 工单详情 | `/delivery/tickets/$ticketNo` | TicketDetail | 详情页 | 否 | — | M1 | W1-19 | 否 |
| 交付 | 广告制作任务 | `/delivery/ad-tasks` | AdTasks | 审核工作台 | 是 | — | M5 | G5-C | 否 |
| 发布 | 成片交付 | `/publish/deliveries` | Delivery | 审核工作台 | 是 | — | M1 | W1-20 | 否 |
| 发布 | 上线日历 | `/publish/calendar` | Calendar | 月历页 | 是 | — | M6 | G6-B | 否 |
| 发布 | 链接核验 | `/publish/verify` | Verify | 审核工作台 | 是 | — | M1 | W1-20 | 否 |
| 发布 | 账号核验 | `/publish/accounts` | Accounts | 审核工作台 | 是 | — | M1 | W1-19 | 否 |
| 发布 | 逾期跟踪 | `/publish/overdue` | Overdue | 筛选表格 | 是 | — | M6 | G6-B | 否 |
| 发布 | 作品巡检 | `/publish/patrol` | Patrol | 主从页 | 是 | — | M6 | G6-B | 否 |
| 发布 | 下架核查 | `/publish/offline` | Offline | 审核工作台 | 是 | — | M6 | G6-B | 否 |
| 发布 | 数据录入 | `/publish/data-entry` | DataEntry | — | 是 | `release.publish_metrics` | V1.1 | — | 否 |
| 客服 | 工单池 | `/service/tickets` | Service | 筛选表格 | 是 | — | M7 | G7-A | 否 |
| 客服 | 工单详情 | `/service/tickets/$ticketNo` | ServiceDetail | 详情页 | 否 | — | M7 | G7-A | 否 |
| 财务 | 收款流水 | `/finance/payments` | Payments | 筛选表格 | 是 | — | M4 | G4-C | 否 |
| 财务 | 退款管理 | `/finance/refunds` | Refunds | 审核工作台 | 是 | — | M4 | G4-C | 否 |
| 财务 | 积分调整审批 | `/finance/credit-adjust` | CreditAdjust | 筛选表格 | 是 | — | M4 | G4-C | 否 |
| 财务 | 发票管理 | `/finance/invoices` | Invoices | 审核工作台 | 是 | — | M4 | G4-C | 否 |
| 财务 | 对账 | `/finance/reconcile` | Reconcile | 筛选表格 | 是 | — | M4 | G4-C | 否 |
| 财务 | 服务商结算 | `/finance/settle` | FinSettle | — | 是 | `release.partner` | V1.1 | — | 否 |
| 报表 | 经营概览 | `/reports/overview` | RptOverview | 报表页 | 是 | — | M7 | G7-B | 否 |
| 报表 | 积分报表 | `/reports/points` | RptPoints | 报表页 | 是 | — | M7 | G7-B | 否 |
| 报表 | 短剧销售排行 | `/reports/dramas` | RptDramas | — | 是 | `release.reports_v11` | V1.1 | — | 否 |
| 报表 | 交付效率 | `/reports/delivery` | RptDelivery | — | 是 | `release.reports_v11` | V1.1 | — | 否 |
| 报表 | 广告制作 | `/reports/ads` | RptAds | — | 是 | `release.reports_v11` | V1.1 | — | 否 |
| 报表 | 客服报表 | `/reports/service` | RptService | — | 是 | `release.reports_v11` | V1.1 | — | 否 |
| 报表 | 服务商业绩 | `/reports/partners` | RptPartners | — | 是 | `release.partner` | V1.1 | — | 否 |
| 运营 | 首页配置 | `/ops/home` | OpsHome | 配置页 | 是 | — | M3 | G3-B | 否 |
| 运营 | 商城配置 | `/ops/mall` | OpsMall | 配置页 | 是 | — | M3 | G3-B | 否 |
| 运营 | 协议管理 | `/ops/agreements` | OpsAgreements | 主从页 | 是 | — | M2 | G2-B | 否 |
| 运营 | 消息模板 | `/ops/templates` | OpsTemplates | 主从页 | 是 | — | M7 | G7-A | 否 |
| 运营 | 公告与常见问题 | `/ops/notice` | OpsNotice | — | 是 | `release.notice_faq` | V1.1 | — | 否 |
| 系统 | 员工账号 | `/sys/staff` | SysStaff | 筛选表格 | 是 | — | M1 | W1-02 | 否 |
| 系统 | 角色权限 | `/sys/roles` | SysRoles | 主从页 | 是 | — | M2 | G2-A | 否 |
| 系统 | 数据字典 | `/sys/dict` | SysDict | 主从页 | 是 | — | M2 | G2-A | 否 |
| 系统 | 参数配置 | `/sys/params` | SysParams | 配置页 | 是 | — | M2 | G2-A | 否 |
| 系统 | 操作日志 | `/sys/logs` | SysLogs | 主从页 | 是 | — | M2 | G2-A | 否 |
| 渠道 | 服务商列表 | `/partners` | Partners | — | 是 | `release.partner` | V1.1 | — | 否 |
| 渠道 | 入驻审核 | `/partners/review` | PartnerReview | — | 是 | `release.partner` | V1.1 | — | 否 |
| 渠道 | 等级与返佣 | `/partners/levels` | PartnerLevels | — | 是 | `release.partner` | V1.1 | — | 否 |
| 渠道 | 商家归属 | `/partners/binding` | PartnerBinding | — | 是 | `release.partner` | V1.1 | — | 否 |
| 渠道 | 结算单 | `/partners/settle` | PartnerSettle | — | 是 | `release.partner` | V1.1 | — | 否 |

### 2.2 无画板业务页（16）

不补稿，按规范 第 12 节实现，PR 附截图（计划 第 4.2 节 Q5 的默认）。地址与是否进菜单在登记时拿不准的，见“备注”。

| 模块 | 页面 | 地址 | 骨架 | 入口 | 里程碑 | 工作包 | 已实现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 工作台 | 我的待审批 | `/approvals` | 筛选表格 | 页面内 | M2 | G2-A | 否 | 无画板页：地址与是否进菜单文档没写，先按登记值；页面包实现时定，并把 inMenu 改过来。M2 只含已落地的审批类型，M4、M5 各补一段 |
| 商家 | 渠道码登记 | `/merchants/referral-codes` | 筛选表格 | 页面内 | M2 | G2-B | 否 | 无画板页：地址与是否进菜单文档没写，先按登记值；页面包实现时定，并把 inMenu 改过来 |
| 订单 | 线下开单 | — | 表单弹层 | 页面内 | M4 | G4-C | 否 | 无画板页：按表单弹层登记，没有独立地址；页面包实现时定 |
| 财务 | 线下退款登记 | — | 表单弹层 | 页面内 | M4 | G4-C | 否 | 无画板页：按表单弹层登记，没有独立地址；页面包实现时定 |
| 财务 | 红字发票 | — | 表单弹层 | 页面内 | M4 | G4-C | 否 | 无画板页：按表单弹层登记，没有独立地址；页面包实现时定 |
| 财务 | 受控财务配置 | `/finance/settings` | 配置页 | 页面内 | M4 | G4-C | 否 | 无画板页：地址与是否进菜单文档没写，先按登记值；页面包实现时定，并把 inMenu 改过来 |
| 运营 | 发送日志与重发 | `/ops/notify-logs` | 筛选表格 | 页面内 | M7 | G7-A | 否 | 无画板页：地址与是否进菜单文档没写，先按登记值；页面包实现时定，并把 inMenu 改过来 |
| 运营 | 通道配置 | `/ops/channels` | 配置页 | 页面内 | M7 | G7-A | 否 | 无画板页：地址与是否进菜单文档没写，先按登记值；页面包实现时定，并把 inMenu 改过来 |
| 系统 | 开关管理 | `/sys/flags` | 筛选表格 | 页面内 | M2 | G2-A | 否 | 无画板页：地址照 D7 第 5.2 节；是否进菜单文档没写，页面包实现时定，并把 inMenu 改过来 |
| 系统 | 清单模板管理 | `/sys/checklists` | 筛选表格 | 页面内 | M2 | G2-A | 否 | 无画板页：地址与是否进菜单文档没写，先按登记值；页面包实现时定，并把 inMenu 改过来 |
| 系统 | 流程运维 | `/sys/flow-ops` | 筛选表格 | 页面内 | M2 | G2-D | 否 | 无画板页：地址与是否进菜单文档没写，先按登记值；页面包实现时定，并把 inMenu 改过来。M3 的 G3-A 在本页接入媒体任务 |
| 系统 | 文件清除放行 | `/sys/file-purges` | 筛选表格 | 页面内 | M3 | G3-A | 否 | 无画板页：地址与是否进菜单文档没写，先按登记值；页面包实现时定，并把 inMenu 改过来 |
| 系统 | 系统健康 | `/sys/health` | 筛选表格 | 页面内 | M7 | G7-B | 否 | 无画板页：地址照 D7 第 5.2 节；是否进菜单文档没写，页面包实现时定，并把 inMenu 改过来 |
| — | 导出记录抽屉 | — | 弹层或抽屉 | 页面内 | M7 | G7-B | 否 |  |
| — | 通知面板 | — | 弹层或抽屉 | 入口隐藏 | M7 | G7-B | 否 |  |
| — | 全局搜索 | — | 弹层或抽屉 | 入口隐藏 | M7 | G7-B | 否 |  |

### 2.3 基础页与外壳部件（8）

| 种类 | 页面 | 地址 | 里程碑 | 工作包 | 已实现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 基础页 | 登录 | `/login` | M1 | W1-02 | 否 |  |
| 基础页 | 动态口令验证 | `/login/mfa` | M1 | W1-02 | 否 | 登录的第二步；地址由 W1-02 定 |
| 基础页 | 首次改密 | `/login/set-password` | M1 | W1-02 | 否 | 地址由 W1-02 定 |
| 基础页 | 绑定动态口令 | `/login/enroll-totp` | M1 | W1-02 | 否 | 地址由 W1-02 定 |
| 基础页 | 再验证弹层 | — | M1 | W1-02 | 否 |  |
| 基础页 | 没有访问权限 | `/403` | M1 | W1-02 | 否 | 本包先给占位页，W1-02 做真实页面 |
| 基础页 | 页面不存在 | — | M1 | W1-02 | 否 | 匹配不到路由时显示；本包先给占位页，W1-02 做真实页面 |
| 外壳部件 | 用户菜单 | — | M1 | W1-02 | 否 | 属外壳，不单算基础页（任务书 第 11 节第 5 项） |

## 3. 电脑端下载页

下载页是单独的 Vite 应用，没有原型；M0 只有空壳，页面都在 M6（D7 第 6 节；计划 第 8.3 节）。

### 3.1 页面（8）

| 页面 | 地址 | 要先有会话 | 里程碑 | 工作包 | 已实现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 扫码登录页 | `/` | 否 | M6 | G6-B | 否 | 二维码、配对数字、倒计时、手输代码 |
| 可下载清单 | `/items` | 是 | M6 | G6-B | 否 |  |
| 成片下载 | `/items/$id` | 是 | M6 | G6-B | 否 | 逐集下载、打包下载、发布清单 |
| 样片与广告只读预览 | `/preview/$kind/$id` | 是 | M6 | G6-B | 否 |  |
| 会话失效说明页 | — | 否 | M6 | G6-B | 否 | 当前会话接口返回 401 时进入，再回扫码页；没有独立地址 |
| 扫一扫落地页 | `/a` | 否 | M6 | G6-B | 否 | 用微信“扫一扫”而不是小程序里的按钮扫了码时的提示页 |
| 授权书验真页 | `/v` | 否 | M6 | G6-B | 否 | 地址 /v?code=<验真码>&rev=<版次>（p01 第 3.15 节） |
| 电脑端上传 | — | 是 | V1.1 | — | 否 | V1.1，只登记 |

## 4. 商家端小程序

路由 49 个：主包 6 页，分包 9 个（D7 第 4.1 节）。V1.0 不做的 1 个只登记。全局配置的页面、分包、预下载由这份清单拼出，只输出已建的页。

“已实现”指页面包已交付。M0 的占位页（4 个，进构建、能打开）不算已实现，在“备注”里标出。“工作包”一栏：已拆包的写编号，未拆包的写工作包组（如 G2-B），拆包 PR 改成编号。

### 4.1 页面（49）

| 包 | 页面 | 路由 | 画板 | 编号 | 工作包 | 里程碑 | 已实现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 主包 | 首页 | `pages/home/index` | Main | M02 | W1-18 | M1 | 否 | M0 占位页 |
| 主包 | 短剧商城 | `pages/mall/index` | Mall | M04 | W1-18 | M1 | 否 | M0 占位页 |
| 主包 | 选剧单 | `pages/cart/index` | Cart | M08 | W1-18 | M1 | 否 | M0 占位页 |
| 主包 | 我的 | `pages/mine/index` | Mine | M32 | W1-05 | M1 | 否 | M0 占位页 |
| 主包 | 登录 | `pages/login/index` | Login | M01 | W1-05 | M1 | 否 |  |
| 主包 | 协议正文 | `pages/agreement/index` | — | — | W1-05 | M1 | 否 | 新增页：登录前可读 |
| `sub/catalog` | 搜索 | `sub/catalog/search/index` | Search | M03 | G3-B | M3 | 否 |  |
| `sub/catalog` | 预告片模式 | `sub/catalog/trailer/index` | Trailer | M05 | — | V1.0 不做 | 否 | V1.0 不做（规范 第 11 节） |
| `sub/catalog` | 短剧详情 | `sub/catalog/detail/index` | Detail | M06 | W1-18 | M1 | 否 |  |
| `sub/order` | 确认订购 | `sub/order/checkout/index` | Checkout | M09 | W1-18 | M1 | 否 |  |
| `sub/order` | 结果页 | `sub/order/result/index` | PayResult | M11 | W1-12 | M1 | 否 | 订购成功与付款成功共用，?type=order\|payment |
| `sub/order` | 订单列表 | `sub/order/orders/index` | Orders | M20 | W1-18 | M1 | 否 |  |
| `sub/order` | 订单详情 | `sub/order/order-detail/index` | OrderDetail | M21 | W1-18 | M1 | 否 |  |
| `sub/order` | 方案确认 | `sub/order/plan/index` | Plan | M22 | W1-20 | M1 | 否 |  |
| `sub/order` | 样片确认 | `sub/order/sample/index` | Sample | M23 | W1-20 | M1 | 否 |  |
| `sub/order` | 上线记录 | `sub/order/launch-record/index` | LaunchRecord | M24 | W1-20 | M1 | 否 |  |
| `sub/order` | 我的短剧 | `sub/order/my-dramas/index` | MyDramas | M33 | G5-A | M5 | 否 |  |
| `sub/publish` | 发布任务 | `sub/publish/tasks/index` | Publish | M28 | W1-20 | M1 | 否 |  |
| `sub/publish` | 逐集下载 | `sub/publish/downloads/index` | — | — | W1-20 | M1 | 否 | 新增页：逐集下载管理与“扫码在电脑上下载”入口 |
| `sub/publish` | 发布账号 | `sub/publish/accounts/index` | Accounts | M26 | W1-18 | M1 | 否 | 含 M27 弹层 |
| `sub/publish` | 扫码确认 | `sub/publish/portal-approve/index` | — | — | G6-B | M6 | 否 | 新增页：下载页扫码后的确认页 |
| `sub/billing` | 钱包 | `sub/billing/wallet/index` | Wallet、WalletExpired | M43 | W1-12 | M1 | 否 | 一页两态 |
| `sub/billing` | 套餐选择 | `sub/billing/plan-pick/index` | PlanPick | M44 | W1-12 | M1 | 否 | 含 M10 对公转账弹层与付款结果 |
| `sub/billing` | 积分充值 | `sub/billing/topup/index` | TopUp | M45 | G4-C | M4 | 否 |  |
| `sub/billing` | 积分流水 | `sub/billing/ledger/index` | Ledger | M46 | G4-C | M4 | 否 |  |
| `sub/billing` | 发票 | `sub/billing/invoices/index` | Invoices | M35 | G4-C | M4 | 否 |  |
| `sub/billing` | 合同 | `sub/billing/contracts/index` | Contracts | M34 | G4-C | M4 | 否 |  |
| `sub/profile` | 建档首页 | `sub/profile/profile/index` | Profile | M12 | W1-09 | M1 | 否 |  |
| `sub/profile` | 基础信息 | `sub/profile/basic/index` | ProfileBasic | M13 | W1-09 | M1 | 否 |  |
| `sub/profile` | 门店环境 | `sub/profile/store/index` | ProfileStore | M14 | W1-09 | M1 | 否 |  |
| `sub/profile` | 主推服务 | `sub/profile/service/index` | ProfileService | M15 | W1-09 | M1 | 否 |  |
| `sub/profile` | 证照 | `sub/profile/cert/index` | ProfileCert | M16 | W1-09 | M1 | 否 |  |
| `sub/profile` | 审核进度 | `sub/profile/review/index` | ProfileReview | M17 | W1-09 | M1 | 否 |  |
| `sub/profile` | 门店管理 | `sub/profile/stores/index` | Stores | M48 | G2-B | M2 | 否 |  |
| `sub/profile` | 新增门店 | `sub/profile/store-add/index` | StoreAdd | M49 | G2-B | M2 | 否 |  |
| `sub/profile` | 店员档案 | `sub/profile/staff-profile/index` | StaffProfile | M56 | G2-B | M2 | 否 | 仅店员 |
| `sub/asset` | 素材库 | `sub/asset/lib/index` | AssetLib | M50 | G3-C | M3 | 否 |  |
| `sub/asset` | 上传素材 | `sub/asset/upload/index` | AssetUpload | M51 | G3-C | M3 | 否 |  |
| `sub/asset` | 素材详情 | `sub/asset/detail/index` | AssetDetail | M52 | G3-C | M3 | 否 |  |
| `sub/asset` | 上传中心 | `sub/asset/uploader/index` | — | — | G3-C | M3 | 否 | 新增页：大文件上传 |
| `sub/ad` | 广告 | `sub/ad/ads/index` | Ads | M18 | G5-B | M5 | 否 | 含 M42 弹层 |
| `sub/ad` | 广告详情 | `sub/ad/ad-detail/index` | AdDetail | M19 | G5-B | M5 | 否 |  |
| `sub/service` | 客服中心 | `sub/service/service/index` | Service | M29 | G7-A | M7 | 否 | 含 M30 弹层 |
| `sub/service` | 工单 | `sub/service/ticket/index` | Ticket、TicketDone | M31 | G7-A | M7 | 否 | 一页两态 |
| `sub/service` | 消息 | `sub/service/messages/index` | Messages | M36 | G2-C | M2 | 否 |  |
| `sub/service` | 设置 | `sub/service/settings/index` | — | — | G2-B | M2 | 否 | 新增页：退出登录、注销、隐私协议、通知设置、已授权的电脑 |
| `sub/member` | 成员 | `sub/member/members/index` | Members | M53 | G2-B | M2 | 否 |  |
| `sub/member` | 邀请店员 | `sub/member/invite/index` | Invite | M54 | G2-B | M2 | 否 |  |
| `sub/member` | 加入门店 | `sub/member/join/index` | Join | M55 | G2-B | M2 | 否 | 游客可进 |
