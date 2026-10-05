// W0-21 种子：6 份协议的清单
export { AGREEMENT_SEEDS, seed } from "./seed.js";
export type { AgreementSeed } from "./seed.js";
// W1-03 协议与同意：装配入口 createDocs（当前版本解析、两条公开接口的读、同意记录的唯一写入口、待同意与指纹、已签署协议）。
// 用法见本目录的 README.md
export { createDocs } from "./service.js";
export type { Docs, DocsDeps, ReconsentInput } from "./service.js";
export { USER_CONSENT_SCENES } from "./consents.js";
export type {
  AssertConsentsInput,
  AssertConsentsResult,
  ConsentBiz,
  ConsentBizType,
  ConsentEntity,
  ConsentMethod,
  ConsentReceiptItem,
  ConsentScene,
  ConsentSigner,
} from "./consents.js";
export type { Page } from "./cursor.js";
export { stampOf } from "./pending.js";
export type { ConsentStamps } from "./pending.js";
export { AGREEMENT_PDF_URL_TTL_MS } from "./read.js";
export type { AgreementListQuery } from "./read.js";
export type {
  SignedAgreementFilter,
  SignedAgreementQuery,
  SignedAgreementViewer,
} from "./signed.js";
export { versionLabel } from "./versions.js";
export type { DocsReader, VersionRow } from "./versions.js";
export { DOCS_INVARIANT_LIMIT, findN13Violations, findN4Violations } from "./invariants.js";
export type { DocsInvariantOptions } from "./invariants.js";
export { registration } from "./register.js";
// W1-03 演示种子：六份协议的占位版本（只进本地、测试与预发；由演示种子的运行器调，接线在 W1-07）
export {
  PLACEHOLDER_SHORT_NOTICE_REASON,
  PLACEHOLDER_SUMMARY,
  placeholderHtml,
  seedPlaceholderAgreementVersions,
} from "./demo-seed.js";
export type { PlaceholderFile, PlaceholderSeedDeps, PlaceholderSeedInput } from "./demo-seed.js";
