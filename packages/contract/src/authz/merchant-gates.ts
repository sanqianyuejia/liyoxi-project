// 商家鉴权链的两张名单（W1-04），都按 operationId 登记（约定 C71、C73；裁决 A39、A85）。纯常量：本文件不引任何包。
// 加减条目先改约定里的那一条，再改这里；自测（merchant-gates.test.ts）钉住条目，并核对每一条都在路由清单里。

/**
 * 版本门槛的豁免：X-Client-Version 低于开关 client.min_version 也照常放行（约定 C71）。
 * 启动引导、埋点、协议读取、错误上报：旧版本要拿得到“请更新”的信息，也报得出错。
 */
export const VERSION_GATE_EXEMPT_OPERATIONS = [
  "m.bootstrap.get",
  "m.analyticsEvent.batchCreate",
  "m.agreement.list",
  "m.agreementVersion.get",
  "m.clientError.create",
] as const;

/**
 * 协议同意的白名单：有未同意的现行用户级协议时，这几条照常放行，其余回 428 CONSENT_REQUIRED（约定 C73）。
 * 协议读取与提交同意、退出登录、当前账号、注销，以及两条 optional 的上报（否则有待同意协议的登录用户报不出埋点与错误）。
 */
export const CONSENT_WHITELIST_OPERATIONS = [
  "m.bootstrap.get",
  "m.agreement.list",
  "m.agreementVersion.get",
  "m.agreementConsent.create",
  "m.session.current.delete",
  "m.me.get",
  "m.me.deletion.create",
  "m.analyticsEvent.batchCreate",
  "m.clientError.create",
] as const;

export type VersionGateExemptOperation = (typeof VERSION_GATE_EXEMPT_OPERATIONS)[number];
export type ConsentWhitelistOperation = (typeof CONSENT_WHITELIST_OPERATIONS)[number];

/** 这条接口受不受版本门槛拦 */
export const isVersionGateExempt = (operationId: string): boolean =>
  (VERSION_GATE_EXEMPT_OPERATIONS as readonly string[]).includes(operationId);

/** 这条接口在不在协议同意的白名单里 */
export const isConsentWhitelisted = (operationId: string): boolean =>
  (CONSENT_WHITELIST_OPERATIONS as readonly string[]).includes(operationId);
