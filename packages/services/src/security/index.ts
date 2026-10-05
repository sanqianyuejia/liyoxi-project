// security：字段加密、盲索引、敏感字段三件套、密钥环与启动自检（W0-14）。用法见本目录的 README.md。
// 回调验签与收件箱（webhook_event）也归本模块，随 G2-0。
export { BIDX_PURPOSES, createKeyring, keyringFromEnv, SecurityError } from "./keyring.js";
export type { BidxPurpose, Keyring, KeyringInput, SecurityErrorCode } from "./keyring.js";
export { decryptField, encryptField, kidOf } from "./crypto.js";
export type { SensitiveColumn } from "./crypto.js";
export { blindIndex, normalizePhone, normalizeUscc } from "./bidx.js";
export type { BlindIndex } from "./bidx.js";
export { openField, phoneBidx, sealBankAccount, sealPhone, sealUscc, usccBidx } from "./pii.js";
export type { SealedField, SealedPhone } from "./pii.js";
export { loadKeyring, selfCheck } from "./selfcheck.js";
// W1-01a：后台登录的三把密钥（票据、设备 Cookie、MFA）的加载与自检，MFA 密钥的加解密
export * from "./auth-keys.js";
