// h01-hooks 定义的领域错误码（docs/api/h01-hooks.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors("h01-hooks", [[46600, 46699]], {
  WEBHOOK_SIGNATURE_INVALID: def(46601, 401, false, "验签失败"),
  WEBHOOK_TIMESTAMP_SKEWED: def(46602, 401, false, "请求时间与服务器时间相差过大"),
  WEBHOOK_KEY_NOT_FOUND: def(46603, 401, false, "找不到对应的验签密钥"),
  WEBHOOK_DECRYPT_FAILED: def(46604, 500, true, "报文解密失败，请稍后重试"),
  WEBHOOK_PAYLOAD_INVALID: def(46605, 400, false, "报文无法解析或缺少必需的字段"),
  WEBHOOK_SOURCE_DISABLED: def(46606, 404, false, "该回调来源未启用"),
  WEBHOOK_PERSIST_FAILED: def(46607, 500, true, "回调暂时无法保存，请稍后重试"),
});
