// assertConsents：同意记录的唯一写入口（W1-03；m01 第 2.7 节“同意记录的写入口径”；13 分组 第 2.12、5.2 节）。
// 登录、重新同意、加入，以及订购、广告需求、付款单四个交易场景都经这里，与各自的业务写同一事务。
//
//   每份协议一行，INSERT … ON CONFLICT DO NOTHING；命中唯一索引即返回已有记录（同一账号同一版本重复提交只有一行）。
//   协议键与版本不一致、用户级场景里混进别的协议 → VALIDATION_FAILED；
//   不是这份协议此刻的当前版本（含尚未生效的、已被取代的）→ AGREEMENT_VERSION_STALE，带当前版本 id；
//   交易接口只交版本 id，交成别的协议的版本同样按过期处理（协议键取自版本行）。
//
// 手机号密文与脱敏串、称呼脱敏串、角色、openid 的 HMAC、主体快照都由调用方带入：docs 不读身份表与主体表。
// docs 只返回“用户级协议是否已齐”与指纹，不写 merchant_user.consent_stamp（由 identity 自己写）。
// 表是只增的：没有改、删的入口，库里另有触发器拦 UPDATE、DELETE、TRUNCATE。
import type {
  AGREEMENT_CONSENT_BIZ_TYPE,
  AGREEMENT_CONSENT_METHOD,
  AGREEMENT_CONSENT_SCENE,
  EnumValue,
  MerchantRole,
} from "@liyoxi/contract/enums";
import type { AgreementVersionStaleDetails, DeviceInfo, PendingConsent } from "@liyoxi/contract";

import { AppError, uuidv7 } from "../kernel/index.js";
import type { IdentityContext, Tx } from "../kernel/index.js";
import { consentStamps, pendingConsents } from "./pending.js";
import { currentVersions } from "./versions.js";

export type ConsentScene = EnumValue<typeof AGREEMENT_CONSENT_SCENE>;
export type ConsentMethod = EnumValue<typeof AGREEMENT_CONSENT_METHOD>;
export type ConsentBizType = EnumValue<typeof AGREEMENT_CONSENT_BIZ_TYPE>;

/** 只收用户级协议、没有主体与单据的三个场景 */
export const USER_CONSENT_SCENES: readonly ConsentScene[] = ["login", "reconsent", "member_join"];

/** 谁在同意：调用方从请求上下文带入的快照 */
export interface ConsentSigner {
  readonly merchantUserId: string;
  /** 当时的登录手机号密文与脱敏串 */
  readonly phoneEnc: string;
  readonly phoneMask: string;
  /** 经办人称呼的脱敏串（保留首字）：成员关系上的称呼，没有则账号称呼，都没有为空 */
  readonly operatorNameMask: string | null;
  /** 当时的商家角色；首次登录还没有成员关系为空 */
  readonly role: MerchantRole | null;
  /** 当时登录的小程序 appid 与 openid 的 HMAC（32 字节）；两样同有同无 */
  readonly appid: string | null;
  readonly openidHmac: Uint8Array | null;
}

/** 主体快照：四个交易场景必给 */
export interface ConsentEntity {
  readonly entityId: string;
  readonly entityName: string | null;
  /** 信用代码密文与脱敏串同有同无；主体还没提交营业执照时为空 */
  readonly usccEnc: string | null;
  readonly usccMask: string | null;
  /** 下单门店：订购与广告需求必给 */
  readonly storeId: string | null;
}

/** 关联单据：四个交易场景必给。单号在业务行插入前已取得 */
export interface ConsentBiz {
  readonly type: ConsentBizType;
  readonly id: string;
  readonly no: string;
}

export interface AssertConsentsInput {
  readonly scene: ConsentScene;
  /** 每份协议一项。交易接口只有版本 id，协议键由版本行补 */
  readonly consents: readonly { agreementKey?: string; agreementVersionId: string }[];
  readonly signer: ConsentSigner;
  readonly entity?: ConsentEntity;
  readonly biz?: ConsentBiz;
  /** 同意方式；不给即取协议清单上的同意方式（勾选或付款即同意）。prior_consent 由广告需求显式给 */
  readonly method?: ConsentMethod;
  /** 设备快照；appVersion 由调用方从请求头补 */
  readonly device?: DeviceInfo & { appVersion?: string };
}

export interface ConsentReceiptItem {
  readonly agreementConsentId: string;
  /** agreement_consent.seq 的十进制字符串 */
  readonly consentNo: string;
  readonly agreementKey: string;
  readonly agreementVersionId: string;
  readonly consentedAt: string;
}

export interface AssertConsentsResult {
  /** 每份提交的协议一项，次序同入参（重复的版本只出一项）；重复提交返回已有记录 */
  readonly consents: ConsentReceiptItem[];
  /** 这次写完之后，本人仍待同意的用户级协议 */
  readonly pendingConsents: PendingConsent[];
  /** 用户级协议是否已齐 */
  readonly complete: boolean;
  /** 用户级协议当前版本集合的指纹：已齐时由 identity 写进 merchant_user.consent_stamp */
  readonly stamp: string;
}

const USER_AGENT_MAX = 300;
const REQUEST_ID_MAX = 40;

function invalid(message: string): never {
  throw new AppError("VALIDATION_FAILED", { message });
}

export async function assertConsents(
  tx: Tx,
  now: Date,
  ctx: IdentityContext,
  input: AssertConsentsInput,
): Promise<AssertConsentsResult> {
  const { scene, signer, entity, biz } = input;
  const userScene = USER_CONSENT_SCENES.includes(scene);
  // 入参的组合不对是调用方的代码缺陷，不是用户输入：库的 CHECK 也会拒，这里先说清楚
  if (userScene && (entity !== undefined || biz !== undefined)) {
    throw new TypeError(`场景 ${scene} 只收用户级协议：不带主体与单据`);
  }
  if (!userScene && (entity === undefined || biz === undefined)) {
    throw new TypeError(`场景 ${scene} 是交易场景：要带主体快照与单据`);
  }

  const versionIds = [...new Set(input.consents.map((consent) => consent.agreementVersionId))];
  const versions = await tx.agreementVersion.findMany({
    where: { id: { in: versionIds } },
    select: {
      id: true,
      agreementKey: true,
      contentSha256: true,
      agreement: { select: { scenes: true, consentMode: true } },
    },
  });
  const current = await currentVersions(tx, now);

  const rows = versionIds.map((versionId) => {
    const asked = input.consents.find((consent) => consent.agreementVersionId === versionId);
    const version = versions.find((item) => item.id === versionId);
    const key = version?.agreementKey ?? asked?.agreementKey;
    // 版本行不存在：给了协议键的按“不是当前版本”处理（端上刷新后重新同意）；没给键的无从判断
    if (key === undefined) invalid("协议版本不存在");
    if (asked?.agreementKey !== undefined && version !== undefined && asked.agreementKey !== key) {
      invalid("协议键与版本不一致");
    }
    const live = current.get(key);
    const stale = (): never => {
      const details: AgreementVersionStaleDetails = {
        agreementKey: key,
        currentAgreementVersionId: live?.id ?? null,
      };
      throw new AppError("AGREEMENT_VERSION_STALE", { details });
    };
    if (version !== undefined && !version.agreement.scenes.includes(scene)) {
      // 用户级场景里混进别的协议是入参不对；交易接口只交版本 id，交成别的协议的版本按过期处理（m01 第 2.7 节末段）
      if (userScene) invalid("本场景只收用户级协议");
      stale();
    }
    if (version === undefined || version.contentSha256 === null || live?.id !== versionId) {
      return stale();
    }
    const consentMode = version.agreement.consentMode;
    return {
      id: uuidv7(),
      agreementKey: key,
      agreementVersionId: versionId,
      contentSha256: version.contentSha256,
      merchantUserId: signer.merchantUserId,
      appid: signer.appid,
      openidHmac: signer.openidHmac === null ? null : new Uint8Array(signer.openidHmac),
      phoneEnc: signer.phoneEnc,
      phoneMask: signer.phoneMask,
      operatorNameMask: signer.operatorNameMask,
      role: signer.role,
      entityId: entity?.entityId ?? null,
      entityName: entity?.entityName ?? null,
      usccEnc: entity?.usccEnc ?? null,
      usccMask: entity?.usccMask ?? null,
      storeId: entity?.storeId ?? null,
      scene,
      bizType: biz?.type ?? null,
      bizId: biz?.id ?? null,
      bizNo: biz?.no ?? null,
      // 协议清单上的 esign 在 V1.0 只声明：没有显式给方式时按勾选记
      method: input.method ?? (consentMode === "by_action" ? "by_action" : "checkbox"),
      consentedAt: now,
      // 证据列不留空：取不到来源 IP、请求号时写明“未知”，不拦业务
      ip: ctx.ip ?? "unknown",
      userAgent: ctx.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
      deviceSnapshot: { ...input.device },
      requestId: (ctx.requestId ?? "unknown").slice(0, REQUEST_ID_MAX),
      createdAt: now,
    };
  });

  // 命中两个部分唯一索引之一即跳过（同一账号同一版本、无单据只一条；有单据每单一条）
  const created = await tx.agreementConsent.createManyAndReturn({
    data: rows,
    skipDuplicates: true,
    select: { id: true },
  });
  const createdIds = new Set(created.map((row) => row.id));
  const receipts: ConsentReceiptItem[] = [];
  for (const row of rows) {
    const stored = await tx.agreementConsent.findFirst({
      where: createdIds.has(row.id)
        ? { id: row.id }
        : {
            merchantUserId: row.merchantUserId,
            agreementVersionId: row.agreementVersionId,
            bizType: row.bizType,
            bizId: row.bizId,
          },
      select: { id: true, seq: true, consentedAt: true },
    });
    if (stored === null) throw new Error("同意记录既没有插入，也没有查到已有的那一行");
    receipts.push({
      agreementConsentId: stored.id,
      consentNo: stored.seq.toString(),
      agreementKey: row.agreementKey,
      agreementVersionId: row.agreementVersionId,
      consentedAt: stored.consentedAt.toISOString(),
    });
  }

  const pending = await pendingConsents(tx, now, signer.merchantUserId);
  const { user: stamp } = await consentStamps(tx, now);
  return { consents: receipts, pendingConsents: pending, complete: pending.length === 0, stamp };
}
