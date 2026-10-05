// 商家端：账号与登录 · me（docs/api/m01-account.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。
import { errorResponses, okResponse } from "../../common/index.js";
import { merchantRoute } from "../builders.js";
import { merchantMeta } from "../meta-only.js";

import { MeViewSchema } from "./account.schemas.js";

// m.me.get 已带结构（W1-04）；其余 7 条随 M2
export const mMeGet = merchantRoute({
  method: "get",
  path: "/m/me",
  operationId: "m.me.get",
  summary:
    "当前账号：称呼与脱敏手机号、成员关系（主体概要、可访问门店与各门店角色）、待同意协议、一次性提示",
  "x-auth": "user",
  "x-clerk-view": "same",
  "x-idempotent-reason": "纯查询，GET 不写库（A18、A19）",
  responses: { ...okResponse(MeViewSchema), ...errorResponses(401, 426, 429) },
});

export const mMeUpdate = merchantMeta({
  method: "patch",
  path: "/m/me",
  operationId: "m.me.update",
  summary: "修改称呼（过内容安全检测）",
  "x-auth": "user",
  "x-capability": "me.*",
  "x-clerk-view": "same",
  "x-idempotent": "required",
});

export const mMeChangePhone = merchantMeta({
  method: "post",
  path: "/m/me/change-phone",
  operationId: "m.me.changePhone",
  summary:
    "换绑手机号：提交 {oldSmsCode, newPhoneCode}；保留当前会话、吊销其他会话（不换发令牌，A81）；新号码被从无成员关系的空账号占用时同事务清理该账号",
  "x-auth": "user",
  "x-capability": "me.*",
  "x-clerk-view": "same",
  "x-idempotent": "required",
});

export const mMeDeletionCreate = merchantMeta({
  method: "post",
  path: "/m/me/deletion",
  operationId: "m.me.deletion.create",
  summary:
    "注销账号：无成员关系或店员直接执行；老板须主体无生效套餐、在办订购、上线中成片、未完结资金单据，否则返回阻断项",
  "x-auth": "user",
  "x-capability": "me.*",
  "x-clerk-view": "same",
  "x-idempotent": "required",
});

export const mMeUserNoticeAcknowledge = merchantMeta({
  method: "post",
  path: "/m/me/user-notices/{userNoticeId}/acknowledge",
  operationId: "m.me.userNotice.acknowledge",
  summary: "关闭一次性提示（如“账号在新的微信上登录”，老板下次打开首页时置顶展示）",
  "x-auth": "user",
  "x-capability": "me.*",
  "x-clerk-view": "same",
  "x-idempotent": "required",
});

export const mMeWechatIdentityList = merchantMeta({
  method: "get",
  path: "/m/me/wechat-identities",
  operationId: "m.me.wechatIdentity.list",
  summary: "已登录的微信列表：首次绑定时间、最近登录、设备摘要、是否当前设备（不返回 openid）",
  "x-auth": "user",
  "x-capability": "me.*",
  "x-clerk-view": "same",
  "x-idempotent-reason": "纯查询，GET 不写库（A18、A19）",
});

export const mMeWechatIdentityDelete = merchantMeta({
  method: "delete",
  path: "/m/me/wechat-identities/{wechatIdentityId}",
  operationId: "m.me.wechatIdentity.delete",
  summary: "移除某个已登录的微信并吊销其全部会话；移除当前身份等同退出",
  "x-auth": "user",
  "x-capability": "me.*",
  "x-clerk-view": "same",
  "x-idempotent": "required",
});
