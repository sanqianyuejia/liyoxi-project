# 升级、加购两种内容的履约

| 项 | 内容 |
| --- | --- |
| 状态 | 留桩中 |
| 留桩内容 | 付清后的履约只做套餐（开通、续费、降级续费）一种内容；升级补差（当期权益换版本、补发、改写其后的发放计划）与加购（经履约入账）还没有 |
| 骨架里的做法 | `packages/services/src/billing/subscription/fulfill.ts` 遇到内容快照 `kind` 为 `upgrade`、`topup` 的付款单即返回 `blocked`（`reasonCode = UNEXPECTED`，`detail.problem = content_kind_not_supported`），由入账函数开差异单；M1 没有入口能建出这两种付款单。加购入账的账本函数 `ledger.purchase` 已有（W1-10），到时在履约里接上 |
| 登记的工作包 | W1-11a |
| 回补里程碑 | M4 |
| 回补的工作包 | G4-A（待拆包后填编号） |
| 依据 | 计划 第 7.3 节留桩清单“微信支付、续费升级、退款、对账、发票”一行；任务书 W1-11a 第 5、7 节；D1 第 6.4、6.5 节 |
