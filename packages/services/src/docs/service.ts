// docs 的装配入口（W1-03）：把时钟与开事务的入口绑上，给出协议与同意的全部函数。api、worker 启动时各建一次。
//
//   const docs = createDocs({ tx: runtime.tx, clock: runtime.clock });
//   await docs.listAgreements(query);                         // 用例：自己开只读的事务
//   await tx.run((handle) => docs.assertConsents(handle, ctx, input));   // 在调用方的事务里
//
// 两类函数：用例函数（路由直接调，自己开事务）与收事务句柄的函数（别的域在自己的事务里调）。
import type {
  AgreementConsentReceipt,
  AgreementCurrent,
  AgreementVersionDetail,
  PendingConsent,
  SignedAgreementList,
} from "@liyoxi/contract";

import type { Clock, IdempotencyContext, IdentityContext, Tx, TxRunner } from "../kernel/index.js";
import { assertConsents } from "./consents.js";
import type { AssertConsentsInput, AssertConsentsResult } from "./consents.js";
import type { Page } from "./cursor.js";
import { consentStamps, pendingConsents } from "./pending.js";
import type { ConsentStamps } from "./pending.js";
import { getAgreementVersion, listAgreements } from "./read.js";
import type { AgreementListQuery } from "./read.js";
import { countSignedAgreements, listSignedAgreements } from "./signed.js";
import type {
  SignedAgreementFilter,
  SignedAgreementQuery,
  SignedAgreementViewer,
} from "./signed.js";
import { currentVersions } from "./versions.js";
import type { DocsReader, VersionRow } from "./versions.js";

export interface DocsDeps {
  /** 开事务的入口：用例函数用它 */
  readonly tx: TxRunner;
  /** 业务时钟：“当前版本”按它解析，同意时间取它 */
  readonly clock: Clock;
}

/** 重新同意（m.agreementConsent.create）的入参：场景固定 reconsent、方式固定勾选 */
export type ReconsentInput = Pick<AssertConsentsInput, "consents" | "signer" | "device">;

export interface Docs {
  // ---------- 用例函数：自己开事务 ----------
  /** m.agreement.list */
  listAgreements(query: AgreementListQuery): Promise<Page<AgreementCurrent>>;
  /** m.agreementVersion.get：草稿、已撤回、不存在都是 NOT_FOUND */
  getAgreementVersion(agreementVersionId: string): Promise<AgreementVersionDetail>;
  /** m.agreementConsent.create：已登录用户的重新同意，只收用户级协议 */
  reconsent(
    ctx: IdentityContext,
    input: ReconsentInput,
    options?: { idem?: IdempotencyContext },
  ): Promise<AgreementConsentReceipt>;
  /** m.agreementConsent.list */
  listSignedAgreements(
    viewer: SignedAgreementViewer,
    query: SignedAgreementQuery,
  ): Promise<SignedAgreementList>;
  /** m.agreementConsent.summary */
  countSignedAgreements(
    viewer: Pick<SignedAgreementViewer, "merchantUserId" | "entityId">,
    filter: SignedAgreementFilter,
  ): Promise<{ all: number }>;

  // ---------- 在调用方的事务里 ----------
  /** 各协议此刻的当前版本（全仓唯一的解析口径）：协议键 → 版本 */
  currentVersions(db: DocsReader): Promise<Map<string, VersionRow>>;
  /** 同意记录的唯一写入口 */
  assertConsents(
    tx: Tx,
    ctx: IdentityContext,
    input: AssertConsentsInput,
  ): Promise<AssertConsentsResult>;
  /** 本人此刻待同意的用户级协议：现算，不写库 */
  pendingConsents(db: DocsReader, merchantUserId: string): Promise<PendingConsent[]>;
  /** 两个指纹：用户级协议的、全部协议的 */
  consentStamps(db: DocsReader): Promise<ConsentStamps>;
}

export function createDocs(deps: DocsDeps): Docs {
  const now = (): Date => deps.clock.now();
  const read = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => deps.tx.run(fn);
  return {
    listAgreements: (query) => read((tx) => listAgreements(tx, now(), query)),
    getAgreementVersion: (id) => read((tx) => getAgreementVersion(tx, now(), id)),
    reconsent: (ctx, input, options = {}) =>
      deps.tx.run(async (tx) => {
        const result = await assertConsents(tx, now(), ctx, {
          ...input,
          scene: "reconsent",
          method: "checkbox",
        });
        return { consents: result.consents, pendingConsents: result.pendingConsents };
      }, options),
    listSignedAgreements: (viewer, query) =>
      read((tx) => listSignedAgreements(tx, now(), viewer, query)),
    countSignedAgreements: (viewer, filter) =>
      read((tx) => countSignedAgreements(tx, now(), viewer, filter)),
    currentVersions: (db) => currentVersions(db, now()),
    assertConsents: (tx, ctx, input) => assertConsents(tx, now(), ctx, input),
    pendingConsents: (db, merchantUserId) => pendingConsents(db, now(), merchantUserId),
    consentStamps: (db) => consentStamps(db, now()),
  };
}
