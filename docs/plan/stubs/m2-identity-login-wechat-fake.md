# 登录走微信替身

| 项 | 内容 |
| --- | --- |
| 状态 | 留桩中 |
| 留桩内容 | 静默登录与手机号登录的两次外呼（登录凭证换 openid、手机号组件的凭证换手机号）走替身，没有真实的微信驱动；微信身份行与同意记录里的 appid 是占位值 |
| 骨架里的做法 | `packages/services/src/identity/login.ts` 只依赖 `WechatProvider` 的两个方法；接口进程的装配点 `apps/api/src/merchant/services.ts` 取运行时上的 `providers.wechat`（本地与测试是假实现：openid 由凭证推出），没有即两条登录回 503 `WECHAT_UNAVAILABLE`。appid 写占位值 `PLACEHOLDER_WEAPP_APPID`。用例经 `provideMerchantDeps` 换成测试替身 |
| 登记的工作包 | W1-04 |
| 回补里程碑 | M2，G2-D |
| 回补的工作包 | 待 W1-23 拆包后填；真实驱动在 G2-D（要 E2 的 AppID 与密钥；驱动要把手机号的区号交出来，现在 `identity/phone.ts` 只能看原串里的国际前缀），登录页的真实形态在 G2-B（V19） |
| 依据 | 计划 第 7.3 节留桩清单“微信登录、手机号组件、短信”“登录页、逐集下载页的真实形态”两行；m01 第 3.1、3.2 节；任务书 W1-04 第 7 节 |
