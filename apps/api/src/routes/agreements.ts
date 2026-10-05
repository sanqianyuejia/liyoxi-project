// 商家端：协议（docs/api/m01-account.md 第 3.12、3.13 节）。W1-03 挂两条公开路由：协议清单与版本正文。
// 提交同意、已签署协议与计数三条要会话或成员关系，服务与契约结构已有，由 W1-04b 在本文件里接着挂。
import { mAgreementList, mAgreementVersionGet } from "@liyoxi/contract";
import { createDocs } from "@liyoxi/services";
import type { Docs, Runtime } from "@liyoxi/services";

import { ok } from "../http/errors.js";
import { defineHandler } from "../routing/define.js";

const built = new WeakMap<Runtime, Docs>();

/** 一个运行时建一次：docs 只要事务入口与时钟。别的域的处理器要用 docs 也取它 */
export function docsOf(runtime: Runtime): Docs {
  let docs = built.get(runtime);
  if (docs === undefined) {
    docs = createDocs({ tx: runtime.tx, clock: runtime.clock });
    built.set(runtime, docs);
  }
  return docs;
}

export const agreementHandlers = [
  // m.agreement.list：登录前可读
  defineHandler(mAgreementList, async (c) => {
    const page = await docsOf(c.var.runtime).listAgreements(c.req.valid("query"));
    return ok(c, page);
  }),
  // m.agreementVersion.get：草稿、已撤回、不存在都是 404；回包含签名地址，不缓存（约定 C18）
  defineHandler(mAgreementVersionGet, async (c) => {
    const { agreementVersionId } = c.req.valid("param");
    const detail = await docsOf(c.var.runtime).getAgreementVersion(agreementVersionId);
    c.header("Cache-Control", "no-store");
    return ok(c, detail);
  }),
];
