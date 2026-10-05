# 错误码登记表

由各文档的结构化清单（`working/frag/*.json`）与约定 C27 生成，请勿手改。错误体与分段规则见 [约定](00-conventions.md) 第 4 节；数值区间见裁决 A70。

## 1. 通用错误码（28 个，约定 C27）

| 符号 | 数值 | HTTP | 可重试 | 何时 | 引用文档数 |
| --- | --- | --- | --- | --- | --- |
| `VALIDATION_FAILED` | 40001 | 400 | 否 | 入参不合 schema（含路径参数不是 uuid） | 18 |
| `IDEMPOTENCY_KEY_REQUIRED` | 40002 | 400 | 否 | `required` 路由缺键或键格式不对 | 0 |
| `AUTH_REQUIRED` | 40101 | 401 | — | 没带凭据 | 2 |
| `SESSION_INVALID` | 40102 | 401 | — | 凭据过期、被吊销、账号已禁用 | 0 |
| `AUTH_FAILED` | 40103 | 401 | 否 | 后台登录失败（不区分原因） | 1 |
| `PERMISSION_DENIED` | 40301 | 403 | 否 | 后台模块等级或权限点不足 | 8 |
| `NOT_A_MEMBER` | 40302 | 403 | 否 | 缺 `X-Store-Id` 或对该门店无成员关系 | 2 |
| `ROLE_FORBIDDEN` | 40303 | 403 | 否 | 商家角色没有该能力点，或该角色没有该资源的视图（`clerkView: none`） | 3 |
| `STEP_UP_REQUIRED` | 40304 | 403 | 否 | 注册表标了再验证的权限点超出 10 分钟窗口；C86 登记的驳回接口不检查 | 7 |
| `ORIGIN_REJECTED` | 40305 | 403 | 否 | 非 GET 缺 `X-LYX-*` 头或 `Origin` 不符 | 1 |
| `FEATURE_DISABLED` | 40306 | 403 | 否 | 受开关控制的路由已关闭 | 4 |
| `IP_NOT_ALLOWED` | 40307 | 403 | 否 | 后台访问面白名单拒绝 | 1 |
| `NOT_FOUND` | 40401 | 404 | 否 | 资源不存在或不在范围内 | 16 |
| `VERSION_CONFLICT` | 40901 | 409 | 否 | `lockVersion`（或 C52 列出的例外字段）不符 | 9 |
| `STATE_NOT_ALLOWED` | 40902 | 409 | 否 | 当前状态不允许该动作（新请求；同键重放不会走到这里，C47） | 16 |
| `IDEMPOTENCY_KEY_REUSED` | 40903 | 409 | 否 | 同一键、不同请求内容 | 1 |
| `IDEMPOTENCY_IN_PROGRESS` | 40904 | 409 | 是 | 三段式用例处理中 | 7 |
| `CONFIRM_MISMATCH` | 40905 | 409 | 否 | 二次确认回显与库中当前值不一致 | 8 |
| `PRECONDITION_CHANGED` | 40906 | 409 | 否 | 审批或执行时前提已变 | 5 |
| `REMINDED_TODAY` | 40920 | 409 | 否 | 同一对象同一场景当日已人工催办过一次（`manual_reminder_log` 唯一冲突，`13-notify-docs.md:614`）；用于交付工单、广告、巡检、套餐周期等的催办 | 3 |
| `CLIENT_OUTDATED` | 42601 | 426 | 否 | 版本低于最低版本 | 0 |
| `CONSENT_REQUIRED` | 42801 | 428 | 否 | 有未同意的现行协议版本 | 1 |
| `RATE_LIMITED` | 42901 | 429 | 是 | 限流 | 7 |
| `INTERNAL` | 50000 | 500 | 否 | 未预期错误 | 1 |
| `PROVIDER_UNAVAILABLE` | 50001 | 503 | 是 | 外部能力不可用（含文本内容安全检测不可用，A137，见下） | 10 |
| `UPSTREAM_TIMEOUT` | 50002 | 504 | 是 | 外部能力超时 | 2 |
| `BUSY` | 50003 | 503 | 是 | 锁等待超时、事务超时、死锁重试失败 | 1 |
| `MAINTENANCE` | 50004 | 503 | 是 | 停机维护（A39 采纳，见 C72） | 0 |

## 2. 领域错误码（285 个，按数值排序）

| 符号 | 数值 | HTTP | 可重试 | 含义 | `details` | 定义方 | 其他引用方 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `WECHAT_UNAVAILABLE` | 41001 | 503 | 是 | code2Session 或 getPhoneNumber 失败、超时；默认文案“手机号验证服务暂不可用，请稍后重试”（不出现“微信”） | — | [m01-account](m01-account.md) | — |
| `WECHAT_CODE_INVALID` | 41002 | 400 | 否 | loginCode 或 phoneCode 无效、过期或已使用 | — | [m01-account](m01-account.md) | — |
| `PHONE_REGION_UNSUPPORTED` | 41003 | 400 | 否 | 非中国大陆手机号 | — | [m01-account](m01-account.md) | — |
| `ACCOUNT_DISABLED` | 41004 | 403 | 否 | 手机号登录时账号已被后台禁用 | — | [m01-account](m01-account.md) | — |
| `REVERIFY_REQUIRED` | 41005 | 403 | 否 | 休眠保护：长期未登录的老板账号换微信，需人工复核 | — | [m01-account](m01-account.md) | — |
| `CONTENT_REJECTED` | 41006 | 400 | 否 | 提交的文字未通过内容安全检测（共用码，A77；details { fields: string[] }） | { fields: string[] } | [m01-account](m01-account.md) | a03-merchant、m02-tenant、m03-profile-asset、m06-ad |
| `SMS_UNAVAILABLE` | 41007 | 503 | 否 | 短信通道未配置、模板不可用或发送失败（共用码，A77；m03 资质联系人验证码共用） | — | [m01-account](m01-account.md) | m03-profile-asset |
| `SMS_CODE_INVALID` | 41008 | 400 | 否 | 短信验证码错误、过期、已用或已作废（共用码，A77；m03 共用） | { attemptsLeft: integer \| null } | [m01-account](m01-account.md) | m03-profile-asset |
| `PHONE_UNCHANGED` | 41009 | 400 | 否 | 新手机号与当前手机号相同 | — | [m01-account](m01-account.md) | a03-merchant |
| `PHONE_TAKEN` | 41010 | 409 | 否 | 新手机号已被有成员关系或已禁用的账号使用 | — | [m01-account](m01-account.md) | a03-merchant |
| `IDENTITY_TOO_NEW` | 41011 | 403 | 否 | 当前微信绑定不足 7 天，不能移除其他微信 | { removableAt: string(date-time) } | [m01-account](m01-account.md) | — |
| `ACCOUNT_DELETION_BLOCKED` | 41012 | 409 | 否 | 老板注销时主体有未办结事项（details.blockers） | { blockers: DeletionBlocker[] } | [m01-account](m01-account.md) | — |
| `ALREADY_IN_ENTITY` | 41101 | 409 | 否 | 已是其他主体的店员，不能再建主体 | { storeName: string \| null } | [m02-tenant](m02-tenant.md) | — |
| `ALREADY_OWNER` | 41102 | 409 | 否 | 已是该主体的老板，不能接受店员邀请 | — | [m02-tenant](m02-tenant.md) | — |
| `PHONE_IN_OTHER_ENTITY` | 41103 | 409 | 否 | 手机号已属其他主体 | { currentRole: 'owner' \| 'clerk' } | [m02-tenant](m02-tenant.md) | a03-merchant |
| `SEAT_LIMIT_REACHED` | 41104 | 409 | 否 | 成员名额已满（含待接受的邀请） | { seatsUsed, memberLimit, limitReason } | [m02-tenant](m02-tenant.md) | — |
| `STORE_LIMIT_REACHED` | 41105 | 409 | 否 | 门店额度已满 | { storesUsed, storeLimit, limitReason } | [m02-tenant](m02-tenant.md) | — |
| `QUOTA_EXCEEDED` | 41106 | 409 | 否 | 门店数超过上限，须先停用门店才能新订购、提交广告需求（共用领域码，A77 归 m02；由 m04 m.order.create、m06 m.ad.create 返回，两者的 quote 列为 blockers） | { storesUsed, storeLimit, storesOver } | [m02-tenant](m02-tenant.md) | m04-mall-order、m06-ad |
| `STORE_ARCHIVED` | 41107 | 403 | 否 | 门店已停用，只能做收尾操作（门店上下文中间件返回） | — | [m02-tenant](m02-tenant.md) | m04-mall-order、m06-ad、m08-support-misc |
| `STORE_HAS_OPEN_WORK` | 41108 | 409 | 否 | 门店有在办事项，不能停用或删除 | { blockers: StoreBlocker[] } | [m02-tenant](m02-tenant.md) | — |
| `LAST_ACTIVE_STORE` | 41109 | 409 | 否 | 是主体最后一家启用中的门店 | — | [m02-tenant](m02-tenant.md) | — |
| `STORE_NOT_DRAFT` | 41110 | 409 | 否 | 不是草稿门店，只能停用 | { reasons: StoreNotDraftReason[] } | [m02-tenant](m02-tenant.md) | — |
| `INVITATION_INVALID` | 41111 | 404 | 否 | 邀请令牌不存在或与邀请不符 | — | [m02-tenant](m02-tenant.md) | — |
| `INVITATION_USED` | 41112 | 410 | 否 | 邀请已被使用 | — | [m02-tenant](m02-tenant.md) | — |
| `INVITATION_REVOKED` | 41113 | 410 | 否 | 邀请已撤回 | — | [m02-tenant](m02-tenant.md) | — |
| `INVITATION_EXPIRED` | 41114 | 410 | 否 | 邀请已过期 | — | [m02-tenant](m02-tenant.md) | — |
| `INVITATION_NOT_FOR_YOU` | 41115 | 403 | 否 | 邀请限定了手机号，与当前账号不符 | — | [m02-tenant](m02-tenant.md) | — |
| `INVITATION_DAILY_LIMIT` | 41116 | 409 | 否 | 当天发出的邀请已达上限 | { dailyCap: integer } | [m02-tenant](m02-tenant.md) | — |
| `OWNER_CANNOT_LEAVE` | 41117 | 409 | 否 | 老板不能退出门店 | — | [m02-tenant](m02-tenant.md) | — |
| `PORTAL_TICKET_INVALID` | 41201 | 410 | 否 | 扫码登录票据不能用于本次操作：不存在、已过期、已作废、已换过会话、已被确认（m02 的三条接口），或待确认时密钥不符（d4-identity.md:2329）。只用于不写库的情形；要作废票据的拒绝返回 200 与 status = rejected（A101）。m02-tenant 的 lookup、approve、reject 同样返回它 | { reason: not_found \| expired \| rejected \| consumed \| approved \| secret_mismatch }（各接口取值见文档第 5 节） | [p01-portal](p01-portal.md) | m02-tenant |
| `PORTAL_SESSION_INVALID` | 41202 | 401 | 否 | 下载页会话失效：不存在、已过期、已吊销，或授权人已不是该主体的有效老板。带了 Cookie 而 portalAuth 不通过时返回；没带 Cookie 返回 AUTH_REQUIRED。归属 p01（A77，C28 共用领域码归属表） | { reason: not_found \| expired \| revoked \| authorizer_invalid, revokeReason: portal_session.revoke_reason \| null } | [p01-portal](p01-portal.md) | — |
| `ENTITY_CLOSE_BLOCKED` | 41301 | 409 | 否 | 主体还有未办结的事项，暂不能关闭 | { blockers: DeletionBlocker[] } | [a03-merchant](a03-merchant.md) | — |
| `REFERRAL_CODE_TAKEN` | 41302 | 409 | 否 | 该码值已被登记 | { code } | [a03-merchant](a03-merchant.md) | — |
| `STORE_MANAGER_UNASSIGNED` | 41303 | 409 | 否 | 门店还没有交付经理，不能转移，请先指派 | — | [a03-merchant](a03-merchant.md) | — |
| `STORE_MANAGER_ASSIGNED` | 41305 | 409 | 否 | 门店已有交付经理，请用“转移交付经理” | { deliveryManagerId } | [a03-merchant](a03-merchant.md) | — |
| `PLAN_NOT_AVAILABLE` | 43001 | 409 | 否 | 套餐版本未上架、没有生效的价目，或积分包已下架 | — | [m07-billing](m07-billing.md) | a05-order-delivery、a07-billing-finance |
| `CYCLE_NOT_AVAILABLE` | 43002 | 400 | 否 | 购买周期未启用 | { enabledCycles } | [m07-billing](m07-billing.md) | a07-billing-finance |
| `UPGRADE_NOT_ALLOWED_TODAY` | 43003 | 409 | 否 | 今天不能立即升级；details.suggest = renew_next_term | { suggest: 'renew_next_term' } | [m07-billing](m07-billing.md) | a07-billing-finance |
| `SCHEDULED_TERM_LIMIT` | 43004 | 409 | 否 | 预约的未生效周期已达上限 | { maxScheduledTerms } | [m07-billing](m07-billing.md) | a07-billing-finance |
| `TOPUP_REQUIRES_ACTIVE_PLAN` | 43005 | 409 | 否 | 套餐未生效，不能加购积分 | — | [m07-billing](m07-billing.md) | a07-billing-finance |
| `PLAN_REFUND_IN_PROGRESS` | 43006 | 409 | 否 | 套餐退款处理中（主体级），暂不能购买、订购或提交广告 | — | [m07-billing](m07-billing.md) | a07-billing-finance、m04-mall-order、m06-ad |
| `QUOTE_CHANGED` | 43007 | 409 | 否 | 价格已变化，请确认新报价；details 按 kind 判别（plan / topup / points） | QuoteChangedDetails：{ kind: 'plan', amountFen, quote: PlanQuote } \| { kind: 'topup', amountFen, pointPack: { pointPackId, points, priceFen } } \| { kind: 'points', totalChargePoints, items: [{ dramaId: uuid \| null, chargePoints }] } | [m07-billing](m07-billing.md) | a07-billing-finance、m04-mall-order、m06-ad |
| `ACCOUNT_BUSY` | 43008 | 503 | 是 | 积分账户正忙（等账户锁超过 3 秒），可用同一请求重试 | — | [m07-billing](m07-billing.md) | a05-order-delivery、a07-billing-finance、m04-mall-order、m06-ad |
| `POINTS_INSUFFICIENT` | 43009 | 409 | 否 | 可用积分不足（账本在账户锁内判定；共用码，A77） | { requiredPoints, spendablePoints, shortfallPoints } | [m07-billing](m07-billing.md) | m04-mall-order、m06-ad |
| `SUBSCRIPTION_INACTIVE` | 43010 | 409 | 否 | 套餐未生效，不能订购、提交广告或超次修改（共用码，A77） | — | [m07-billing](m07-billing.md) | m04-mall-order、m06-ad |
| `REVISION_PENDING_EXISTS` | 43101 | 409 | 否 | 该套餐已有待生效的价目修订，请先撤销再改 | `{ planRevisionId, effectiveAt }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `PARAM_PENDING_EXISTS` | 43102 | 409 | 否 | 参数已有待生效的修订，请先撤销再改 | `{ items: [{ key, billingParamId, effectiveAt }] }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `NOTICE_PERIOD_REQUIRED` | 43103 | 400 | 否 | 生效时间须在公告期之后 | `{ earliestEffectiveDate, keys? }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `REVISION_ALREADY_EFFECTIVE` | 43104 | 409 | 否 | 修订已生效或已撤销，不能撤销 | `{ effectiveAt, cancelledAt }` | [a07-billing-finance](a07-billing-finance.md) | a04-content |
| `CHANGESET_EMPTY` | 43105 | 400 | 否 | 没有需要保存的变化 | — | [a07-billing-finance](a07-billing-finance.md) | — |
| `PLAN_CODE_TAKEN` | 43106 | 409 | 否 | 版本码已存在 | — | [a07-billing-finance](a07-billing-finance.md) | — |
| `PLAN_RANK_TAKEN` | 43107 | 409 | 否 | 版本等级已被占用 | `{ planId }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `PLAN_TIER_ORDER_INVALID` | 43108 | 409 | 否 | 高等级版本的价格与积分须高于低等级版本 | `{ conflictPlanId, field }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `PLAN_REVISION_MISSING` | 43109 | 409 | 否 | 套餐没有生效价目或缺少启用周期的价格，不能上架 | `{ missingCycles }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `POINT_PACK_DUPLICATE` | 43110 | 409 | 否 | 上架中已有相同积分数的积分包 | `{ pointPackId }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `ADJUST_ACCOUNT_INACTIVE` | 43111 | 409 | 否 | 套餐未生效的账户不能手动调整，续费后再处理 | — | [a07-billing-finance](a07-billing-finance.md) | — |
| `ADJUST_EXCEEDS_AVAILABLE` | 43112 | 409 | 否 | 扣减数量超过该类型的可用积分 | `{ availablePoints }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `ADJUST_HOLD_INVALID` | 43113 | 409 | 否 | 关联的订购或广告不能做平台原因退回 | `{ holdStatus, returnablePoints }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `EXTENSION_NOT_APPLICABLE` | 43114 | 409 | 否 | 当前周期不能发起补偿延长 | `{ termStatus }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `PLAN_REFUND_NOT_ELIGIBLE` | 43115 | 409 | 否 | 不符合套餐退款规则（d2 的 422 按 C24 改为 409） | `{ rule, reasons }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `DRAMA_PRICE_LOCKED` | 43201 | 409 | 否 | 剧目已停止订购、授权已结束或已归档，不能调价 | { reason, stopOrderDate } | [a04-content](a04-content.md) | — |
| `DRAMA_PRICE_UNCHANGED` | 43202 | 400 | 否 | 新积分价与当前积分价相同 | { currentPoints } | [a04-content](a04-content.md) | — |
| `HEAT_TIER_MISSING` | 43203 | 409 | 否 | 剧目没有热度等级，不能按模板定价 | — | [a04-content](a04-content.md) | — |
| `DRAMA_PRICE_EFFECTIVE_AT_TAKEN` | 43204 | 409 | 否 | 该剧同一生效时间已有一条调价 | { dramaPriceRevisionId } | [a04-content](a04-content.md) | — |
| `PURCHASE_NOT_OFFERED` | 44001 | 403 | 否 | 当前不提供在线购买（购买策略 mode ≠ in_app） | { mode } | [m07-billing](m07-billing.md) | — |
| `CHANNEL_NOT_ALLOWED` | 44002 | 403 | 否 | 所选支付方式此时不可用；details.channels 带可用渠道 | { channels: PurchaseChannel[] } | [m07-billing](m07-billing.md) | — |
| `PURCHASE_QUALIFICATION_REQUIRED` | 44003 | 409 | 否 | 主体资质未提交或已驳回，不能购买 | { verificationStatus } | [m07-billing](m07-billing.md) | a07-billing-finance |
| `OPEN_ORDER_EXISTS` | 44004 | 409 | 否 | 已有未完成的套餐付款单；details 带单号 | { paymentOrderId, orderNo } | [m07-billing](m07-billing.md) | a07-billing-finance |
| `OPEN_ORDER_EXPIRING` | 44005 | 409 | 否 | 同内容的付款单即将超时，请取消后重新下单 | { paymentOrderId, orderNo, expiresAt } | [m07-billing](m07-billing.md) | — |
| `PAYMENT_ORDER_EXPIRED` | 44006 | 409 | 否 | 付款单已超时 | { expiresAt } | [m07-billing](m07-billing.md) | a07-billing-finance |
| `PAYMENT_ORDER_CLOSED` | 44007 | 409 | 否 | 付款单已取消（预下单期间被取消或尝试已关闭） | — | [m07-billing](m07-billing.md) | — |
| `TRANSFER_PROOF_PENDING` | 44008 | 409 | 否 | 转账凭证待财务确认，暂不能取消 | — | [m07-billing](m07-billing.md) | — |
| `TRANSFER_PROOF_LOCKED` | 44009 | 409 | 否 | 财务正在复核到账，暂不能更换凭证 | — | [m07-billing](m07-billing.md) | a07-billing-finance |
| `INVOICE_NOT_ELIGIBLE` | 44010 | 409 | 否 | 该付款单暂不能开票；details.reasons 列出不满足项 | { reasons: string[] } | [m07-billing](m07-billing.md) | — |
| `INVOICE_REQUEST_EXISTS` | 44011 | 409 | 否 | 该付款单已有有效开票申请 | { invoiceRequestId, requestNo } | [m07-billing](m07-billing.md) | — |
| `INVOICE_TITLE_UNVERIFIED` | 44012 | 409 | 否 | 主体认证通过后才能开票 | — | [m07-billing](m07-billing.md) | — |
| `INVOICE_APPLY_EXPIRED` | 44013 | 409 | 否 | 已超过开票申请期限 | { deadline } | [m07-billing](m07-billing.md) | — |
| `INVOICE_FILE_UNAVAILABLE` | 44014 | 409 | 否 | 该发票暂无可下载的文件 | — | [m07-billing](m07-billing.md) | — |
| `OFFLINE_ORDER_DISABLED` | 44101 | 403 | 否 | 线下开单未开启 | — | [a07-billing-finance](a07-billing-finance.md) | — |
| `BANK_ACCOUNT_NOT_CONFIGURED` | 44102 | 409 | 否 | 尚未配置生效的对公收款账户 | — | [a07-billing-finance](a07-billing-finance.md) | — |
| `CONFIRMER_IS_ORDER_CREATOR` | 44103 | 403 | 否 | 开单员工不能确认本单到账 | — | [a07-billing-finance](a07-billing-finance.md) | — |
| `TRANSFER_AMOUNT_MISMATCH` | 44104 | 409 | 否 | 到账金额与应付不一致，请驳回凭证并登记异常到账 | `{ amountFen }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `BANK_SERIAL_DUPLICATE` | 44105 | 409 | 否 | 该银行流水号已被使用 | `{ conflicts: [{ ref, payerBank: DictRef \\| null }] }`（`ref` 为付款单号或差异单号；`payerBank` 为字典 `bank`，C85） | [a07-billing-finance](a07-billing-finance.md) | — |
| `REFUND_NOT_SUPPORTED` | 44106 | 409 | 否 | 该付款单不支持现金退款（d2 的 422 按 C24 改为 409） | `{ reasonCode }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `REFUND_REQUEST_EXISTS` | 44107 | 409 | 否 | 该笔收款已有在途退款申请 | `{ refundRequestId, requestNo }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `RED_INVOICE_REQUIRED` | 44108 | 409 | 否 | 请先完成红字发票，再执行退款（d2:988） | `{ invoiceRequestId, requestNo, status }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `REFUND_EXCEEDS_REFUNDABLE` | 44109 | 409 | 否 | 退款金额超过可退余额 | `{ refundableFen }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `REFUND_TXN_OPEN` | 44110 | 409 | 否 | 申请名下有未完成或已成功的退款交易 | `{ refundTxnId, status }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `REFUND_ALREADY_REVOKED` | 44111 | 409 | 否 | 套餐权益已回收，申请不能作废，须完成退款 | `{ entitlementRevokedAt }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `REFUND_ROUTE_NOT_ALLOWED` | 44112 | 409 | 否 | 该退款不能走所选方式 | `{ allowedRoutes }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `REFUND_NOT_ACCEPTED_UNCONFIRMED` | 44113 | 409 | 否 | 还不能确认微信未受理 | `{ reasons }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `REFUND_EXECUTOR_CONFLICT` | 44114 | 403 | 否 | 执行人不能是审批人 | — | [a07-billing-finance](a07-billing-finance.md) | a05-order-delivery |
| `PAYEE_NAME_MISMATCH` | 44115 | 400 | 否 | 对公付款的退款，收款户名须与购买主体一致 | `{ expectedName }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `INVOICE_ISSUE_BLOCKED` | 44116 | 409 | 否 | 付款单已不满足开票条件 | `{ reasons }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `INVOICE_NO_TAKEN` | 44117 | 409 | 否 | 该发票代码与号码已被使用 | — | [a07-billing-finance](a07-billing-finance.md) | — |
| `RESOLUTION_NOT_ALLOWED` | 44118 | 409 | 否 | 该差异不能这样处理 | `{ allowed }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `CHANNEL_RECHECK_FAILED` | 44119 | 409 | 否 | 微信实时查询结果不支持该处理 | `{ channelState, channelAmountFen }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `LINK_ORDER_INVALID` | 44120 | 409 | 否 | 所选付款单不能关联这笔到账 | `{ reasons }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `RECON_BILL_NOT_READY` | 44121 | 409 | 否 | 该日账单尚未下载解析 | `{ billFileStatus }` | [a07-billing-finance](a07-billing-finance.md) | — |
| `CART_LIMIT_REACHED` | 45001 | 409 | 否 | 选剧单已达上限（50 部） | { limit } | [m04-mall-order](m04-mall-order.md) | — |
| `CART_PRICE_CHANGED` | 45002 | 409 | 否 | 确认新价格时标价又变了 | { currentPricePoints } | [m04-mall-order](m04-mall-order.md) | — |
| `ORDER_ACCOUNT_INVALID` | 45003 | 409 | 否 | 所选发布账号不可用于本次订购 | { channelAccountId, reason: not_in_store \| not_available } | [m04-mall-order](m04-mall-order.md) | — |
| `ORDER_AD_INVALID` | 45004 | 409 | 否 | 所选广告不可用于本次订购 | { adId, reason: not_in_store \| not_confirmed \| cancelled \| cancel_pending \| slot_not_allowed, dramaId? } | [m04-mall-order](m04-mall-order.md) | — |
| `LAUNCH_DATE_TOO_EARLY` | 45005 | 400 | 否 | 期望上线日早于订购日后第 7 个工作日 | { earliestLaunchDate } | [m04-mall-order](m04-mall-order.md) | — |
| `STORE_NOT_QUALIFIED` | 45008 | 409 | 否 | 门店资质尚未通过，暂不能订购、绑定发布账号或提交广告需求（门店闸门 blocked）；共用领域码，m05、m06 引用（A77） | { storeId, reason: not_submitted \| pending_review \| rejected \| final_rejected } | [m04-mall-order](m04-mall-order.md) | m05-delivery-publish、m06-ad |
| `ORDER_IN_AFTER_SALE` | 45101 | 409 | 否 | 订购单有在途取消申请，方案的推送、确认、提出修改都暂停（10-delivery.md:413；d3-flow.md:880）。后台 `admin.deliveryPlan.push` 同样返回它 | { orderId } | [m05-delivery-publish](m05-delivery-publish.md) | a05-order-delivery |
| `PLAN_VERSION_STALE` | 45102 | 409 | 否 | 确认的方案版本不是当前版本（d3-flow.md:1139、1161） | { currentVersionNo } | [m05-delivery-publish](m05-delivery-publish.md) | — |
| `TICKET_ON_HOLD` | 45103 | 409 | 否 | 交付工单暂停中（取消审批中、方案修订待确认），属于这张工单的对象一律拒绝操作（d3-flow.md:879）。后台的样片、成片接口同样返回它；a06 的链接核验只有通过与撤销返回它，退回不检查暂停（11-publish.md:302） | { reasons: ('cancel_review'\|'plan_amendment')[] } | [m05-delivery-publish](m05-delivery-publish.md) | a05-order-delivery、a06-publish |
| `SAMPLE_VERSION_STALE` | 45104 | 409 | 否 | 操作的样片不是当前已推送的版本 | { currentSampleId: string \| null, currentVersionNo: integer \| null } | [m05-delivery-publish](m05-delivery-publish.md) | a05-order-delivery |
| `AD_CHANGED` | 45105 | 409 | 否 | 样片所用的广告版本已不是当前确认版本，不能确认（d3-flow.md:838，沿用草案名） | { adIds: string[] } | [m05-delivery-publish](m05-delivery-publish.md) | a05-order-delivery |
| `SAMPLE_NOT_VIEWABLE` | 45106 | 409 | 否 | 声明的查看方式没有对应的提供或访问记录（d3-flow.md:1541 的 `422 SAMPLE_NOT_VIEWABLE` 按 C24 改为 409） | { viewedVia, requiredEvidence: 'album_saved'\|'portal_viewed'\|'wecom_sent'\|'album_or_portal' }（album_or_portal 用于开关被关闭后的 weapp 兜底） | [m05-delivery-publish](m05-delivery-publish.md) | — |
| `SAMPLE_VIEW_CHANNEL_NOT_OFFERED` | 45107 | 409 | 否 | 该样片版本推送时没有提供这种查看方式；details = { previewChannels: PreviewChannel[] } | { previewChannels: PreviewChannel[] }（该版本提供的查看方式；与 m06 AD_PREVIEW_CHANNEL_UNAVAILABLE 同一枚举） | [m05-delivery-publish](m05-delivery-publish.md) | p01-portal |
| `SAMPLE_PREVIEW_NOT_READY` | 45108 | 409 | 否 | 样片水印版尚未生成，请稍后再试 | — | [m05-delivery-publish](m05-delivery-publish.md) | p01-portal |
| `DOWNLOAD_GRANT_INVALID` | 45109 | 409 | 否 | 下载授权已过期、已被重新生成或已撤销（d7-platform.md:832）。下载页的 `portal.orderItem.downloadUrls` 同样返回它 | { reason: DownloadGrantInvalidReason, expiresAt: string \| null, canRegenerate: boolean } | [m05-delivery-publish](m05-delivery-publish.md) | a06-publish、p01-portal |
| `DOWNLOAD_NOT_AVAILABLE` | 45110 | 409 | 否 | 成片当前不可下载或不可重新生成授权（未交付、成片包已关闭、订单项已关闭、已过使用期、文件不可用）。下载页同样返回它 | { reason: DownloadUnavailableReason } | [m05-delivery-publish](m05-delivery-publish.md) | p01-portal |
| `DOWNLOAD_REGRANT_LIMIT` | 45111 | 409 | 否 | 今天重新生成下载授权已达 5 次 | { limit: 5, nextAvailableAt: string } | [m05-delivery-publish](m05-delivery-publish.md) | — |
| `LICENSE_LETTER_NOT_READY` | 45112 | 409 | 否 | 授权书（或指定版次）尚未出件 | { renderStatus: 'queued'\|'rendering'\|'failed'\|null } | [m05-delivery-publish](m05-delivery-publish.md) | — |
| `AD_CANCEL_IN_PROGRESS` | 45201 | 409 | 否 | 广告有在途的取消申请，审批结束前不能确认、提出修改或重新提交 | — | [m06-ad](m06-ad.md) | a05-order-delivery |
| `AD_VERSION_STALE` | 45202 | 409 | 否 | 请求里的版本号不是当前版本 | { currentVersionNo: integer \| null } | [m06-ad](m06-ad.md) | a05-order-delivery、p01-portal |
| `AD_PREVIEW_CHANNEL_UNAVAILABLE` | 45203 | 409 | 否 | 这一版推送时没有提供这种查看方式 | { previewChannels: PreviewChannel[] } | [m06-ad](m06-ad.md) | p01-portal |
| `AD_NOT_VIEWED` | 45204 | 409 | 否 | 还没有通过所选方式查看过这一版（含开关被关闭后以 weapp 确认的兜底） | { viewedVia: PreviewChannel, requiredEvidence: album_saved \| portal_viewed \| album_or_portal } | [m06-ad](m06-ad.md) | — |
| `CHARGE_CHANGED` | 45205 | 409 | 否 | 超次修改的扣减积分与页面提示不一致，或需要扣积分但尚未确认（沿用 d3-flow.md:1312 的符号名） | { isChargeable: boolean, chargePoints: integer, freeRevisionsRemaining: integer } | [m06-ad](m06-ad.md) | — |
| `PLAYABLE_UNAVAILABLE` | 45206 | 409 | 否 | 可播放资产不是 ready（处理中、失败或已停用） | { state: PlayableState } | [m06-ad](m06-ad.md) | p01-portal |
| `CANCEL_ITEM_NOT_ALLOWED` | 45301 | 409 | 否 | 选中的订单项不能取消，或没有可取消的订单项（d3-flow.md:2115-2127 的 `invalid` 分支） | `{ lines: [{ orderItemId, reason: CancelBlockReason }] }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `AD_NOT_CANCELLABLE` | 45302 | 409 | 否 | 广告已确认、已取消，或仍被在办订单项绑定（d3-flow.md:1404-1406） | `{ reason: 'ad_confirmed'\\|'ad_cancelled'\\|'ad_in_use', boundOrderItemIds: string[] }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `CANCEL_QUOTE_CHANGED` | 45303 | 409 | 否 | 发起取消时重算的退回合计与试算时不同 | `{ quote: CancelQuote }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `PLAN_CONTENT_INVALID` | 45304 | 409 | 否 | 方案内容校验不通过（d3-flow.md:1150-1156） | `{ issues: [{ orderItemId: string \\| null, field, reason: 'item_missing'\\|'placement_missing'\\|'placement_not_allowed'\\|'ad_invalid'\\|'ad_type_mismatch'\\|'account_invalid'\\|'account_missing'\\|'launch_date_missing'\\|'ticket_unassigned' }] }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `PLAN_CHANGE_WINDOW_CLOSED` | 45305 | 409 | 否 | 方案确认后的修订超出该剧的变更窗口（d3-flow.md:1167-1172） | `{ items: [{ orderItemId, step, changedKinds: PlanChangeKind[] }] }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `LAUNCH_DATE_OUT_OF_RANGE` | 45306 | 400 | 否 | 约定上线日早于订购日后第 7 个工作日（或今天），或晚于使用期止日 | `{ orderItemId, minDate, maxDate }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `LAUNCH_DATE_LOCKED` | 45307 | 409 | 否 | 首个账号已核验上线，或订单项不在制作中、待上线，不能改期 | `{ phase, usageStartDate: string \\| null }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `ASSIGNEE_INVALID` | 45308 | 409 | 否 | 接收人无效：未启用、角色不对口、与现任相同，或不在操作人的员工集合内（A77 归本文，a01、a03 引用；d4-identity.md:1324 第 4 条） | { staffId: string, reason: AssigneeInvalidReason }（not_active \| role_mismatch \| same_as_current \| out_of_scope，x-open-enum） | [a05-order-delivery](a05-order-delivery.md) | a01-system、a03-merchant、a08-support |
| `REMIND_NOT_APPLICABLE` | 45309 | 409 | 否 | 催办场景与对象当前状态不符 | `{ scene, reason }` | [a05-order-delivery](a05-order-delivery.md) | a07-billing-finance |
| `CORRECTION_NOT_ALLOWED` | 45310 | 409 | 否 | 人工纠偏的步骤对不在白名单，或更正后结构性不变量不成立 | `{ reason: 'not_whitelisted'\\|'invariant_failed', allowedSteps: string[], failedInvariants: string[] }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `QC_SELF_INSPECTION` | 45311 | 409 | 否 | 质检人是上传人（样片恒禁止；剧集按参数 `qc.episode.four_eyes`） | 无 | [a05-order-delivery](a05-order-delivery.md) | — |
| `PRODUCTION_NOT_READY` | 45312 | 409 | 否 | 制作文件入库或体检未完成、或体检未通过，不能质检或登记 | `{ fileId, pipelineState, gate: 'pass'\\|'reject'\\|null }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `PREVIEW_OFFLINE_NOT_SENT` | 45313 | 409 | 否 | 选了企业微信查看方式，但没有登记“已发送”（`ck_sample_offline_sent`、`ck_ad_version_offline_sent`） | 无 | [a05-order-delivery](a05-order-delivery.md) | — |
| `AD_FREE_REVISION_EXHAUSTED` | 45314 | 409 | 否 | 员工代录广告修改时免费次数已用完 | `{ adId, freeRevisionQuota, revisionCount }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `EPISODE_REGISTER_NOT_ALLOWED` | 45315 | 409 | 否 | 当前步骤不允许登记成片，或补发集号不在补发单范围内（d3-flow.md:1549-1553） | `{ step, reason: 'step'\\|'reissue_required'\\|'not_in_reissue' }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `EPISODE_NOT_LATEST` | 45316 | 409 | 否 | 质检只能作用于该集最新的修订（d5-media.md:1987） | `{ episodeNo, latestEpisodeOutputId }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `PACKAGE_PUSH_BLOCKED` | 45317 | 409 | 否 | 推送成片包或发布补发的守卫不通过（d3-flow.md:1641-1644） | `{ blockers: [{ code: 'episodes_incomplete'\\|'episode_qc_pending'\\|'package_qc_pending'\\|'publish_list_incomplete'\\|'license_letter_missing'\\|'account_unbound'\\|'abnormal_account_ack_required'\\|'launch_date_missing'\\|'usage_ended', episodeNos?: integer[], channelAccountId?: string, checklistKeys?: string[] }] }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `REISSUE_NOT_ALLOWED` | 45318 | 409 | 否 | 当前不能发起补发 | `{ reason: 'step'\\|'usage_ended'\\|'open_reissue_exists', openReissueId: string \\| null }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `REISSUE_INCOMPLETE` | 45319 | 409 | 否 | 补发单里还有集没有质检通过的替换行 | `{ missingEpisodeNos: integer[] }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `MATERIAL_NOT_AVAILABLE` | 45320 | 409 | 否 | 要下载的制作素材不可用 | `{ kind: MaterialKind, reason: 'master_not_ready'\\|'not_in_ticket'\\|'asset_unavailable', episodeNos?: integer[] }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `LICENSE_LETTER_UNCHANGED` | 45321 | 409 | 否 | 按当前事实生成的授权书与最新版次内容相同，无需更正 | `{ currentRevNo }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `AD_WAITING_QUALIFICATION` | 45322 | 409 | 否 | 门店资质未通过，广告暂不能指派（指派即扣积分） | `{ storeId, qualificationStatus }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `AD_VERSION_SPEC_INVALID` | 45323 | 409 | 否 | 广告版本规格不符（竖屏 9:16、1080×1920、时长与类型相符） | `{ checks: [{ code: 'aspect'\\|'resolution'\\|'duration'\\|'file_not_ready', actual, expected }] }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `PRODUCTION_ACTION_NOT_ALLOWED` | 45324 | 409 | 否 | 制作文件当前不能规格化或补标 | `{ action: 'normalize'\\|'restamp', reason: 'kind'\\|'pipeline_state'\\|'already_declared'\\|'file_unavailable' }` | [a05-order-delivery](a05-order-delivery.md) | — |
| `TICKET_REOPEN_WINDOW_CLOSED` | 45501 | 409 | 否 | 工单已解决超过可重新打开的天数（或参数为 0） | { resolvedAt, windowDays } | [m08-support-misc](m08-support-misc.md) | — |
| `SERVICE_TICKET_ALREADY_ASSIGNED` | 45601 | 409 | 否 | 工单已有负责人，请使用转派 | { ownerStaffId } | [a08-support](a08-support.md) | — |
| `SERVICE_TICKET_NOT_ASSIGNED` | 45602 | 409 | 否 | 工单还没有负责人，请使用分配 | — | [a08-support](a08-support.md) | — |
| `SERVICE_TICKET_NOT_OWNER` | 45604 | 403 | 否 | 只有当前负责人或主管可以执行这个操作 | { ownerStaffId } | [a08-support](a08-support.md) | — |
| `SERVICE_TICKET_REF_EXISTS` | 45605 | 409 | 否 | 这条业务已经关联在本工单上 | { refType, refId } | [a08-support](a08-support.md) | — |
| `FILE_NOT_USABLE` | 46001 | 400 | 否 | 文件不可用（未上传完成、类型不符、归属不符或已被拦截） | { fileIds: string[], reason: FileNotUsableReason }（x-open-enum：not_stored \| category_mismatch \| scope_mismatch \| blocked \| duplicate \| ext_mismatch \| context_mismatch） | [m03-profile-asset](m03-profile-asset.md) | a01-system、a03-merchant、a04-content、a05-order-delivery、a06-publish、a07-billing-finance、a08-support、a09-ops、m04-mall-order、m05-delivery-publish、m06-ad、m07-billing、m08-support-misc |
| `ASSET_UPLOAD_GATED` | 46002 | 409 | 否 | 门店资质审核通过前，店员暂不能上传素材 | — | [m03-profile-asset](m03-profile-asset.md) | m08-support-misc |
| `ASSET_PORTRAIT_AUTH_FORBIDDEN` | 46003 | 403 | 否 | 只有老板或素材上传人可以补交肖像授权 | — | [m03-profile-asset](m03-profile-asset.md) | — |
| `ASSET_FEEDBACK_DAILY_LIMIT` | 46004 | 409 | 否 | 今天对这条素材的反馈次数已达上限，请明天再试 | { limit: integer } | [m03-profile-asset](m03-profile-asset.md) | — |
| `CHANNEL_ACCOUNT_TAKEN` | 46101 | 409 | 否 | 同一平台同一账号 ID 已被绑定（PRD 6.10.2-1；`uq_channel_account_platform_uid_active`） | — | [m05-delivery-publish](m05-delivery-publish.md) | — |
| `CHANNEL_ACCOUNT_IN_USE` | 46102 | 409 | 否 | 账号仍被在办订单项引用或有未核查的下架任务，不能解绑（d3-flow.md:2042） | { activeOrderItemCount, openTakedownTaskCount } | [m05-delivery-publish](m05-delivery-publish.md) | — |
| `LINK_INVALID` | 46103 | 400 | 否 | 上线链接不合规（d3-flow.md:1759，沿用草案名；422 按 C24 改为 400） | { field: string, reason: 'unparsable'\|'not_https'\|'too_long'\|'has_credentials'\|'duplicate_episode'\|'episode_out_of_range' } | [m05-delivery-publish](m05-delivery-publish.md) | — |
| `LAUNCH_SUBMISSION_OUT_OF_RANGE` | 46104 | 400 | 否 | 回填的实际上线日期或声明集数超出允许范围（d3-flow.md:1754） | { field: 'actualLaunchDate'\|'reportedEpisodeCount', min: string\|integer, max: string\|integer } | [m05-delivery-publish](m05-delivery-publish.md) | — |
| `LAUNCH_WINDOW_CLOSED` | 46105 | 409 | 否 | 已过使用期止日，不能再回填（d3-flow.md:1754） | { usageEndDate } | [m05-delivery-publish](m05-delivery-publish.md) | — |
| `TAKEDOWN_METHOD_NOT_ALLOWED` | 46106 | 409 | 否 | 该账号已核验上线，不能选“未发布”（11-publish.md:654） | { basis, allowedMethods: string[] } | [m05-delivery-publish](m05-delivery-publish.md) | — |
| `PATROL_NOT_ELIGIBLE` | 46202 | 409 | 否 | 不能发起巡检：上线任务不在线、订单项不在上线中或工单不在服务中（11-publish.md:542） | { reason } | [a06-publish](a06-publish.md) | — |
| `PUBLISH_LIST_LOCKED` | 46204 | 409 | 否 | 首个上线任务已提交回填，发布清单已锁定（d3-flow.md:1635） | { lockedAt } | [a06-publish](a06-publish.md) | — |
| `PUBLISH_LIST_IMPORT_INVALID` | 46205 | 400 | 否 | 导入内容有错，整批未写入 | { rows: [{ rowNo, episodeNo, column, message }] } | [a06-publish](a06-publish.md) | — |
| `ACCOUNT_COMPARE_MISMATCH` | 46206 | 409 | 否 | 比对表有不一致项，或企业认证的认证主体与营业执照主体不一致，不能通过（11-publish.md:109、130） | { fields } | [a06-publish](a06-publish.md) | — |
| `LAUNCH_VERIFY_COUNT_OUT_OF_RANGE` | 46207 | 400 | 否 | 核验集数不在“max(1, 已核验集数) 至本次声明集数”之间（d3-flow.md:1755；ck_launch_submission_verified） | { min, max } | [a06-publish](a06-publish.md) | — |
| `LAUNCH_REVOKE_WINDOW_CLOSED` | 46208 | 409 | 否 | 已超过撤销核验通过的时限（参数 launch.verify_revoke_window） | { decidedAt, deadlineAt } | [a06-publish](a06-publish.md) | — |
| `LAUNCH_REVOKE_BLOCKED` | 46209 | 409 | 否 | 该订单项已有商家确认或已核查的下架任务，不能撤销核验通过（11-publish.md:303） | { takedownTaskIds } | [a06-publish](a06-publish.md) | — |
| `TAKEDOWN_NOT_OVERDUE` | 46210 | 409 | 否 | 今天未过应完成日，不能升级或发违约提醒（11-publish.md:659-660） | { dueDate } | [a06-publish](a06-publish.md) | — |
| `TAKEDOWN_BATCH_REJECTED` | 46211 | 409 | 否 | 批量核查中有任务不满足条件，整批未处理 | { items: [{ index, takedownTaskId, error, message }] } | [a06-publish](a06-publish.md) | — |
| `ASSET_ALREADY_ADOPTED` | 46301 | 409 | 否 | 素材已被采用，不能改为需补拍或需肖像授权 | { adoptedCount } | [a03-merchant](a03-merchant.md) | — |
| `ASSET_PORTRAIT_AUTH_MISSING` | 46302 | 409 | 否 | 还没有肖像授权材料，不能确认授权 | — | [a03-merchant](a03-merchant.md) | — |
| `ASSET_NOT_PROCESSED` | 46303 | 409 | 否 | 素材还在识别中，请稍后再整理 | { processingState } | [a03-merchant](a03-merchant.md) | — |
| `FILE_CATEGORY_NOT_ALLOWED` | 46401 | 400 | 否 | 该分类不能在此登记或签发 | { category } | [a01-system](a01-system.md) | — |
| `PRODUCTION_CONTEXT_REQUIRED` | 46402 | 400 | 否 | 制作文件缺制作上下文或 AI 使用声明 | { missing: string[] } | [a01-system](a01-system.md) | — |
| `FILE_NOT_AVAILABLE` | 46403 | 409 | 否 | 文件未入库、已清除或已拦截 | { status } | [a01-system](a01-system.md) | — |
| `FILE_RESTORE_WINDOW_PASSED` | 46404 | 409 | 否 | 已超过可恢复期限 | { deletedAt } | [a01-system](a01-system.md) | — |
| `FILE_IN_USE` | 46405 | 409 | 否 | 文件仍有在用引用 | { refs: array<{ refType, refId }> } | [a01-system](a01-system.md) | — |
| `MEDIA_JOB_NOT_RETRYABLE` | 46406 | 409 | 否 | 业务对象已不需要该任务 | { reason } | [a01-system](a01-system.md) | — |
| `WEBHOOK_SIGNATURE_INVALID` | 46601 | 401 | 否 | 验签失败：平台签名、每任务 sig 或回调令牌不符（含微信支付签名探测） | — | [h01-hooks](h01-hooks.md) | — |
| `WEBHOOK_TIMESTAMP_SKEWED` | 46602 | 401 | 否 | 带时间戳的协议与本机相差超过 5 分钟 | — | [h01-hooks](h01-hooks.md) | — |
| `WEBHOOK_KEY_NOT_FOUND` | 46603 | 401 | 否 | 微信支付 Wechatpay-Serial 在密钥表里查不到 | — | [h01-hooks](h01-hooks.md) | — |
| `WEBHOOK_DECRYPT_FAILED` | 46604 | 500 | 是 | 验签通过但解密失败（密钥或版本配置错误），由平台重试 | — | [h01-hooks](h01-hooks.md) | — |
| `WEBHOOK_PAYLOAD_INVALID` | 46605 | 400 | 否 | 验签通过但报文无法解析，或缺事件标识等必需字段 | — | [h01-hooks](h01-hooks.md) | — |
| `WEBHOOK_SOURCE_DISABLED` | 46606 | 404 | 否 | 该来源未启用（企业微信未开客户联系、语音识别未配置）；电子签 V1.0 不挂载路由，不用本码 | — | [h01-hooks](h01-hooks.md) | — |
| `WEBHOOK_PERSIST_FAILED` | 46607 | 500 | 是 | 收件行或资金事实落不了库，由平台重试 | — | [h01-hooks](h01-hooks.md) | — |
| `DICT_ITEM_DISABLED` | 47001 | 409 | 否 | 所选字典项已停用或不存在 | { dictTypeKey, code } | [m08-support-misc](m08-support-misc.md) | a01-system、a04-content、a06-publish、a08-support、m02-tenant、m03-profile-asset、m06-ad |
| `FILE_TYPE_NOT_ALLOWED` | 47051 | 400 | 否 | 扩展名不在该分类的白名单内 | { allowedExts: string[] } | [m08-support-misc](m08-support-misc.md) | a01-system |
| `FILE_TOO_LARGE` | 47052 | 400 | 否 | 文件超过分类与端的大小上限；小程序视频超限时引导服务经理代传（A35） | { maxBytes: string, canDelegate: boolean } | [m08-support-misc](m08-support-misc.md) | a01-system |
| `UPLOAD_EXPIRED` | 47053 | 409 | 否 | 上传登记已过期或已取消 | — | [m08-support-misc](m08-support-misc.md) | a01-system、a04-content |
| `UPLOAD_CREDENTIAL_LIMIT` | 47054 | 409 | 否 | 临时密钥已签发 30 次 | — | [m08-support-misc](m08-support-misc.md) | a01-system |
| `CONFIRM_IN_PROGRESS` | 47055 | 409 | 是 | 另一个确认请求正在处理 | — | [m08-support-misc](m08-support-misc.md) | a01-system、a04-content |
| `UPLOAD_NOT_FOUND` | 47056 | 409 | 否 | 写入区没有对象 | — | [m08-support-misc](m08-support-misc.md) | a01-system、a04-content |
| `UPLOAD_REJECTED` | 47057 | 400 | 否 | 文件与登记信息不符，已拒收 | { rejectReason } | [m08-support-misc](m08-support-misc.md) | a01-system、a04-content |
| `BANNER_LIMIT_EXCEEDED` | 47101 | 409 | 否 | 同一时间生效的 Banner 将超过上限 | { at, activeCount, maxActive } | [a09-ops](a09-ops.md) | — |
| `BANNER_ORDER_STALE` | 47102 | 409 | 否 | Banner 列表已变化，请刷新后重新排序 | { missingHomeBannerIds, unknownHomeBannerIds } | [a09-ops](a09-ops.md) | — |
| `BANNER_TARGET_INVALID` | 47103 | 400 | 否 | Banner 跳转目标无效（短剧不存在、未上架或不可订，分类不存在，页面不可选） | { jumpKind, reason: drama_not_found \| drama_not_listed \| drama_not_orderable \| category_not_found \| route_not_allowed \| params_invalid } | [a09-ops](a09-ops.md) | — |
| `CONFIG_REV_CONFLICT` | 47104 | 409 | 否 | 站点配置已有人发布过新版本 | { publishedRevNo, publishedAt, publishedByName } | [a09-ops](a09-ops.md) | — |
| `CONFIG_REF_INVALID` | 47105 | 409 | 否 | 站点配置引用的题材、行业或短剧已失效 | { items: ConfigRefIssue[] } | [a09-ops](a09-ops.md) | — |
| `AGREEMENT_DRAFT_EXISTS` | 47106 | 409 | 否 | 该协议已有草稿 | { draftAgreementVersionId, versionLabel } | [a09-ops](a09-ops.md) | — |
| `AGREEMENT_DRAFT_INCOMPLETE` | 47107 | 409 | 否 | 协议草稿缺文件、摘要、生效时间或法务审定 | { missing } | [a09-ops](a09-ops.md) | — |
| `AGREEMENT_EFFECTIVE_TOO_SOON` | 47108 | 409 | 否 | 生效时间须晚于当前时间 10 分钟以上 | { earliestEffectiveAt } | [a09-ops](a09-ops.md) | — |
| `AGREEMENT_SHORT_NOTICE` | 47109 | 409 | 否 | 距生效不足公告期 | { minDays, leadDays, earliestEffectiveAt, canOverride } | [a09-ops](a09-ops.md) | — |
| `AGREEMENT_PENDING_EXISTS` | 47110 | 409 | 否 | 该协议已有待生效版本 | { pendingAgreementVersionId, versionLabel, effectiveAt } | [a09-ops](a09-ops.md) | — |
| `AGREEMENT_WITHDRAW_TOO_LATE` | 47111 | 409 | 否 | 版本即将或已经生效，或已有同意记录，不能撤回 | { reason, effectiveAt } | [a09-ops](a09-ops.md) | — |
| `AGREEMENT_CONTENT_CONVERT_FAILED` | 47112 | 400 | 否 | Word 正文无法转换为展示格式 | { fileId } | [a09-ops](a09-ops.md) | — |
| `NOTIFY_SCENE_NOT_CONFIGURABLE` | 47113 | 409 | 否 | 该通知场景不支持这项设置 | { sceneKey, reason } | [a09-ops](a09-ops.md) | — |
| `NOTIFY_CHANNEL_NOT_READY` | 47114 | 409 | 否 | 订阅消息模板或短信模板未配置或已停用 | { channel, slotKey, templateKey, status } | [a09-ops](a09-ops.md) | — |
| `NOTIFY_TEST_RECIPIENT_MISSING` | 47115 | 409 | 否 | 当前员工没有登记测试接收人，请联系超级管理员在参数配置里登记 | { channel } | [a09-ops](a09-ops.md) | — |
| `NOTIFY_RESEND_NOT_ALLOWED` | 47116 | 409 | 否 | 这条投递不能重发 | { reason, status } | [a09-ops](a09-ops.md) | — |
| `WX_SLOT_FIELDS_MISMATCH` | 47117 | 400 | 否 | 订阅消息模板字段与场景不一致 | { expected, actualFieldNames } | [a09-ops](a09-ops.md) | — |
| `SMS_TEMPLATE_CONFIG_INVALID` | 47118 | 400 | 否 | 短信模板配置不完整或不允许这样修改 | { reason } | [a09-ops](a09-ops.md) | — |
| `EXPORT_CONCURRENCY_LIMIT` | 47201 | 409 | 否 | 同时进行中的导出任务已达上限 | { maxConcurrent, inflightExportJobIds } | [a02-workbench-report](a02-workbench-report.md) | — |
| `EXPORT_ROW_LIMIT` | 47202 | 409 | 否 | 导出行数超过上限 | { rowCount, maxRows } | [a02-workbench-report](a02-workbench-report.md) | — |
| `EXPORT_NOT_DOWNLOADABLE` | 47203 | 409 | 否 | 导出任务尚未完成或未成功，暂不能下载 | { status } | [a02-workbench-report](a02-workbench-report.md) | — |
| `EXPORT_FILE_EXPIRED` | 47204 | 410 | 否 | 导出文件已过期 | { expiredAt } | [a02-workbench-report](a02-workbench-report.md) | — |
| `REPORT_CLOSE_NOT_CURRENT` | 47205 | 409 | 否 | 月度快照已被新的修订取代 | { currentReportMonthCloseId, currentRevisionNo } | [a02-workbench-report](a02-workbench-report.md) | — |
| `DICT_TYPE_NOT_EDITABLE` | 47301 | 409 | 否 | 字典类型不可新增 | — | [a01-system](a01-system.md) | — |
| `DICT_NAME_DUPLICATED` | 47302 | 409 | 否 | 同级重名 | — | [a01-system](a01-system.md) | — |
| `DICT_ITEM_IN_USE` | 47303 | 409 | 否 | 字典项被引用，不能停用 | { refCount: integer } | [a01-system](a01-system.md) | — |
| `DICT_ITEM_LOCKED` | 47304 | 409 | 否 | 字典项规则不允许该操作 | { rule } | [a01-system](a01-system.md) | — |
| `PARAM_WITHDRAW_TOO_LATE` | 47305 | 409 | 否 | 参数已生效或即将生效，不能撤销 | { effectiveAt } | [a01-system](a01-system.md) | — |
| `CHECKLIST_VERSION_STALE` | 47306 | 409 | 否 | 清单模板版本已不是当前版 | { code, currentVersionNo } | [a01-system](a01-system.md) | a05-order-delivery、a06-publish |
| `CHECKLIST_NOT_PASSED` | 47307 | 400 | 否 | 清单没有全部通过：必填条目缺结论、有不通过项，或在不允许“不适用”的条目上填了不适用 | { missingKeys: string[], failedKeys: string[], invalidNaKeys: string[] } | [a01-system](a01-system.md) | a05-order-delivery、a06-publish |
| `AGREEMENT_VERSION_STALE` | 47401 | 409 | 否 | 提交的协议版本不是当前版本（按 m.agreement.list 的唯一口径判定；登录、重新同意、交易共用，A77） | { agreementKey: string, currentAgreementVersionId: string(uuid) \| null } | [m01-account](m01-account.md) | m04-mall-order、m06-ad、m07-billing |
| `LICENSE_VERIFICATION_NOT_FOUND` | 47501 | 404 | 否 | 未查到这份授权书：验真码不存在、格式不对，或尚无已出件的版次 | — | [p01-portal](p01-portal.md) | — |
| `AUTH_TICKET_INVALID` | 48001 | 401 | 否 | 设置密码或绑定动态口令的票据无效或过期 | — | [a01-system](a01-system.md) | — |
| `TOTP_ALREADY_ENROLLED` | 48002 | 409 | 否 | 已绑定动态口令，不能用激活码重新绑定 | — | [a01-system](a01-system.md) | — |
| `PASSWORD_POLICY_VIOLATED` | 48003 | 400 | 否 | 密码不符合规则 | { rules: string[] }，取值 min_length、letters_and_digits、contains_phone、weak_password、same_as_current | [a01-system](a01-system.md) | — |
| `PASSWORD_INCORRECT` | 48004 | 400 | 否 | 当前密码不正确 | — | [a01-system](a01-system.md) | — |
| `MFA_CODE_INVALID` | 48005 | 400 | 否 | 动态口令或恢复码不正确 | — | [a01-system](a01-system.md) | — |
| `CANNOT_DISABLE_SELF` | 48006 | 409 | 否 | 不能禁用当前登录的账号 | — | [a01-system](a01-system.md) | — |
| `SELF_OPERATION_FORBIDDEN` | 48007 | 409 | 否 | 不能对自己执行该操作 | — | [a01-system](a01-system.md) | — |
| `LAST_SUPER_ADMIN` | 48008 | 409 | 否 | 至少保留一名启用的超级管理员 | — | [a01-system](a01-system.md) | — |
| `OPEN_WORK_EXISTS` | 48009 | 409 | 否 | 名下有在办事项，须先移交再改角色 | { openWork: array<{ source, count }> } | [a01-system](a01-system.md) | — |
| `NO_HANDOVER_CANDIDATE` | 48010 | 409 | 否 | 没有同岗位的启用员工可接收 | { roleKey } | [a01-system](a01-system.md) | — |
| `LEAD_REMOVAL_ACK_REQUIRED` | 48012 | 409 | 否 | 改动后该组没有主管，须确认 | { staffGroupId } | [a01-system](a01-system.md) | — |
| `STAFF_PHONE_TAKEN` | 48013 | 409 | 否 | 手机号已被其他员工使用 | — | [a01-system](a01-system.md) | — |
| `WECOM_USERID_TAKEN` | 48014 | 409 | 否 | 企业微信 userid 已绑定其他员工 | { staffId, staffName, staffStatus } | [a01-system](a01-system.md) | — |
| `WECOM_CODE_INVALID` | 48015 | 400 | 否 | 企业微信扫码 code 无效或过期 | — | [a01-system](a01-system.md) | — |
| `ROLE_LOCKED` | 48016 | 409 | 否 | 超级管理员角色不可修改 | — | [a01-system](a01-system.md) | — |
| `POOL_ROLE_MISMATCH` | 48017 | 409 | 否 | 员工岗位与分配池不符或未启用 | { pool, roleKey } | [a01-system](a01-system.md) | — |
| `APPROVAL_NOT_PENDING` | 48201 | 409 | 否 | 该申请已处理或已撤回（统一审批单通用码，其他文档引用） | { status, decidedAt } | [a03-merchant](a03-merchant.md) | a05-order-delivery、a06-publish、a07-billing-finance |
| `APPROVAL_SELF_FORBIDDEN` | 48202 | 403 | 否 | 不能审批自己发起的申请（统一审批单通用码） | — | [a03-merchant](a03-merchant.md) | a05-order-delivery、a06-publish、a07-billing-finance |
| `APPROVAL_ALREADY_PENDING` | 48203 | 409 | 否 | 该对象已有一张待审批的同类申请（统一审批单通用码） | { approvalId, requestNo } | [a03-merchant](a03-merchant.md) | a07-billing-finance |
| `APPROVAL_WITHDRAW_FORBIDDEN` | 48204 | 403 | 否 | 只有发起人可以撤回；发起人已停用时由有审批权的人代撤（统一审批单通用码） | — | [a03-merchant](a03-merchant.md) | a05-order-delivery、a07-billing-finance |
| `REVIEW_REQUIRED` | 49001 | 409 | 否 | 修改门店名称、地址或行业与品类须重新审核，请确认后再保存 | { changedFields: string[] } | [m03-profile-asset](m03-profile-asset.md) | — |
| `PROFILE_REQUIRED_MISSING` | 49002 | 400 | 否 | 已提交过资质的门店不能把必填项改空 | { fields: string[] } | [m03-profile-asset](m03-profile-asset.md) | a03-merchant |
| `QUALIFICATION_IN_REVIEW` | 49003 | 409 | 否 | 资质正在审核中，暂不能修改 | { qualificationSubmissionId, kind } | [m03-profile-asset](m03-profile-asset.md) | — |
| `QUALIFICATION_CLOSED` | 49004 | 409 | 否 | 资质审核已终局驳回，不能再提交 | — | [m03-profile-asset](m03-profile-asset.md) | — |
| `ENTITY_NOT_VERIFIED` | 49005 | 409 | 否 | 经营主体尚未认证，请先完成首家门店的资质审核 | — | [m03-profile-asset](m03-profile-asset.md) | — |
| `STORE_PROFILE_INCOMPLETE` | 49006 | 409 | 否 | 门店建档必填项未填齐 | { missing: [{ step, item: MissingItemKey, permitType: string \| null }] } | [m03-profile-asset](m03-profile-asset.md) | m04-mall-order |
| `INDUSTRY_NOT_OPEN` | 49007 | 409 | 否 | 所选行业品类或地区暂未开放 | { field: 'industry' \| 'region', code } | [m03-profile-asset](m03-profile-asset.md) | m02-tenant、m04-mall-order |
| `QUALIFICATION_DOCS_INCOMPLETE` | 49008 | 409 | 否 | 证照不齐、未核对或被驳回的证照未补传 | { missing: [{ docType, permitType }], withoutSubmittedFields: string[], rejectedNotReplaced: [{ docType, permitType }] } | [m03-profile-asset](m03-profile-asset.md) | — |
| `ENTITY_TYPE_MISMATCH` | 49009 | 409 | 否 | 所选主体类型与营业执照不一致 | { claimedEntityType, recognizedSubjectType } | [m03-profile-asset](m03-profile-asset.md) | — |
| `DECLARATION_REQUIRED` | 49010 | 400 | 否 | 请阅读并勾选信息确认 | { currentVersion } | [m03-profile-asset](m03-profile-asset.md) | — |
| `CONTACT_PHONE_UNVERIFIED` | 49011 | 409 | 否 | 联系人手机号未验证 | — | [m03-profile-asset](m03-profile-asset.md) | — |
| `USCC_TAKEN` | 49012 | 409 | 否 | 该统一社会信用代码已被其他主体认证 | — | [m03-profile-asset](m03-profile-asset.md) | a03-merchant |
| `ENTITY_LICENSE_CHANGE_PENDING` | 49013 | 409 | 否 | 本主体已有一轮更换营业执照的审核在进行（M108） | { storeId } | [m03-profile-asset](m03-profile-asset.md) | — |
| `QUALIFICATION_DOC_NOT_ALLOWED` | 49014 | 409 | 否 | 本轮不需要上传这种证照 | { docType, roundKind } | [m03-profile-asset](m03-profile-asset.md) | — |
| `QUALIFICATION_NO_CHANGE` | 49015 | 409 | 否 | 没有需要提交审核的修改 | — | [m03-profile-asset](m03-profile-asset.md) | — |
| `QUALIFICATION_CHECK_FAILED` | 49101 | 409 | 否 | 系统比对有不通过的项，请修正字段或驳回 | { items: array<{ qualificationDocId, code, field }> } | [a03-merchant](a03-merchant.md) | — |
| `QUALIFICATION_FINAL_NOT_ALLOWED` | 49102 | 409 | 否 | 变更重审不能终局驳回 | — | [a03-merchant](a03-merchant.md) | — |
| `FIELD_NOT_PROXY_EDITABLE` | 49103 | 400 | 否 | 门店名称、地址、行业与品类、联系人及资质须由商家提交修改 | { fields: string[] } | [a03-merchant](a03-merchant.md) | — |
| `PROXY_EDIT_NO_CHANGE` | 49104 | 400 | 否 | 没有检测到修改内容 | — | [a03-merchant](a03-merchant.md) | — |
| `DRAMA_ARCHIVED` | 49201 | 409 | 否 | 剧目已归档，资料只读，不能上架或变更版权 | { archivedAt } | [a04-content](a04-content.md) | — |
| `LISTING_CHECK_FAILED` | 49202 | 409 | 否 | 上架校验有阻断项未通过（上架、重新上架；已上架剧目的保存） | { failed: [{ code, note }] } | [a04-content](a04-content.md) | — |
| `TOTAL_EPISODES_LOCKED` | 49203 | 409 | 否 | 已上架的剧不能修改总集数，请先下架 | { totalEpisodes } | [a04-content](a04-content.md) | — |
| `EPISODE_HAS_MASTER` | 49204 | 409 | 否 | 要删去的剧集已有原片 | { episodeNos } | [a04-content](a04-content.md) | — |
| `PLACEMENT_NOT_OPEN` | 49205 | 400 | 否 | 所选植入形式未开放或不适用于该类别 | { slots, openSlots } | [a04-content](a04-content.md) | — |
| `COPYRIGHT_REVISION_REQUIRED` | 49206 | 409 | 否 | 剧目上架过，版权信息只能经“版权变更”修改 | — | [a04-content](a04-content.md) | — |
| `COPYRIGHT_CHANGE_KIND_MISMATCH` | 49207 | 400 | 否 | 修订类型与前后值的差异不符 | { allowedKinds } | [a04-content](a04-content.md) | — |
| `LICENSE_SHORTEN_NOT_OPEN` | 49208 | 409 | 否 | 缩短授权期或把止日改早暂不开放 | { currentEndDate } | [a04-content](a04-content.md) | — |
| `COPYRIGHT_NO_CHANGE` | 49209 | 400 | 否 | 版权信息没有变化 | — | [a04-content](a04-content.md) | — |
| `PERMIT_ACTIVE_EXISTS` | 49210 | 409 | 否 | 同一平台、同一编号种类已有活动的许可行 | { dramaPermitId } | [a04-content](a04-content.md) | — |
| `PERMIT_FROZEN` | 49211 | 409 | 否 | 剧目上架过，许可行的平台、种类、编号不能原地修改，请换号 | — | [a04-content](a04-content.md) | — |
| `TRAILER_SOURCE_REJECTED` | 49212 | 409 | 否 | 预告片源文件未通过体检，或该源文件的预告片资产已停用 | { reason: rejected \| retired, failed: [{ code, actual, expected }] } | [a04-content](a04-content.md) | — |
| `BATCH_FILE_INVALID` | 49213 | 400 | 否 | 上传清单里有不合规的文件 | { files: [{ index, reason }] } | [a04-content](a04-content.md) | — |
| `BATCH_MATCH_INCOMPLETE` | 49214 | 409 | 否 | 集号匹配或覆盖不完整，不能开始上传或提交 | { missingEpisodeNos, duplicateEpisodeNos, unmatchedItemIds, needsSequenceConfirm } | [a04-content](a04-content.md) | — |
| `BATCH_PURPOSE_MISMATCH` | 49215 | 409 | 否 | 批次用途不符（成片批次由交付登记提交） | { purpose } | [a04-content](a04-content.md) | a05-order-delivery |
| `TOTAL_EPISODES_MISSING` | 49216 | 409 | 否 | 剧目还没有填写总集数，不能上传原片 | — | [a04-content](a04-content.md) | — |
| `BATCH_EPISODE_TAKEN` | 49217 | 409 | 否 | 该集已被本批次的另一个条目占用 | { uploadBatchItemId } | [a04-content](a04-content.md) | — |
| `TRAILER_SOURCE_CHECKING` | 49218 | 409 | 是 | 预告片源文件还在体检，请稍后再试 | { fileId } | [a04-content](a04-content.md) | — |
| `DRAMA_NOT_ORDERABLE` | 49301 | 409 | 否 | 剧目当前不可订购 | { dramaId, reason: not_listed \| stopped \| platform_not_licensed \| permit_missing } | [m04-mall-order](m04-mall-order.md) | — |
