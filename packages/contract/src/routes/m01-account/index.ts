// 商家端：账号与登录（docs/api/m01-account.md）：一个顶层资源一个文件，整个文件交给 defineRouteDoc 分拣。
// 加资源文件时在这里加一行 import，并放进下面的数组。
import { defineRouteDoc } from "../doc.js";

import * as agreementConsents from "./agreement-consents.js";
import * as agreementVersions from "./agreement-versions.js";
import * as agreements from "./agreements.js";
import * as me from "./me.js";
import * as sessions from "./sessions.js";
import * as smsCodes from "./sms-codes.js";

export const M01_ACCOUNT = defineRouteDoc("m01-account", [
  agreementConsents,
  agreementVersions,
  agreements,
  me,
  sessions,
  smsCodes,
]);

// 已带结构的路由与本文档的结构：api 的处理器与别的域从契约入口取（W1-03 起；各域补结构时在这里各加自己的资源文件）
export * from "./agreement-consents.js";
export * from "./agreement-versions.js";
export * from "./agreement.schemas.js";
export * from "./agreements.js";
export * from "./error-details.js";
