// 两个登录用例（W1-04；m01 第 3.1、3.2 节；D4 第 3.2、3.6 节；02 分组 第 2.1–2.3 节）。
//
// 外部调用（code2Session、getPhoneNumber）在事务之外先做完，再开一个事务（硬性规则 9）：
//   静默登录  微信身份在、允许静默登录、账号 active → 发会话；其余一律 needPhone，不区分原因、不写库。
//   手机号登录 取号或建号 → 休眠检查 → 微信身份（新建、恢复、改绑）→ 新绑定的审计与事件 → 同意记录与指纹
//             → 会话、活跃时间、auth_event。
// 加锁：账号行（80）→ 微信身份行（90），同一账号、同一微信身份的并发登录在这两把锁上排队。
// 建号用 INSERT … ON CONFLICT (phone_bidx) DO NOTHING：同一手机号的两个首次登录只建出一个账号。
//
// M1 的范围（任务书的口径表）：休眠检查的五条放行条件做全；“已休眠”的新绑定一律走最保守的一支（回滚，
// 另起事务写 reverify_required，回 REVERIFY_REQUIRED），“移出休眠店员”“空草稿让位”两支随 M2（只会多拦，不会错放）；
// 企业微信联系人的回填随 M7；新微信绑定的一次性提示由订阅者 identity.onWechatBound 写，随 M2。
import type {
  Attribution,
  ConsentInput,
  DeviceInfo,
  PhoneLoginConsentScene,
  PhoneLoginResult,
  SilentLoginResult,
} from "@liyoxi/contract";
import type { SourceType } from "@liyoxi/contract/enums";
import { maskName } from "@liyoxi/shared/mask";

import { record as recordAudit, recordAuthEvent } from "../audit/index.js";
import type { Config } from "../config/index.js";
import type { Docs } from "../docs/index.js";
import type { Events } from "../events/index.js";
import type { Flow } from "../flow/index.js";
import { AppError, createIdentityContext, lockRows, trackOf, uuidv7 } from "../kernel/index.js";
import type { Assembly, Clock, IdentityContext, Tx, TxRunner } from "../kernel/index.js";
import type { ProviderResult, WechatProvider, WechatSession } from "../providers/types.js";
import { blindIndex, normalizePhone, sealPhone } from "../security/index.js";
import type { Keyring } from "../security/index.js";
import type { Tenant } from "../tenant/index.js";
import type { RegisterArgs } from "./machines.js";
import { buildMeView } from "./me.js";
import type { MeDeps } from "./me.js";
import { openSession, revokeIdentitySessions } from "./sessions.js";
import { deviceSummary } from "./types.js";
import type { RequestMeta } from "./types.js";

export interface LoginDeps {
  readonly tx: TxRunner;
  readonly clock: Clock;
  readonly flow: Flow;
  readonly events: Pick<Events, "emit">;
  readonly assembly: Assembly;
  readonly docs: Docs;
  readonly tenant: Tenant;
  readonly config: { readonly params: Pick<Config["params"], "get"> };
  /** 密钥环：用到时才取（会话校验用不到它，没配密钥的进程照样能校验会话） */
  readonly keyring: () => Keyring;
  /** 微信能力；没接上即 null，登录回 WECHAT_UNAVAILABLE（未配置不崩溃） */
  readonly wechat: Pick<WechatProvider, "code2Session" | "getPhoneNumber"> | null;
  /** 本小程序的 appid：进 wechat_identity 与同意记录的快照 */
  readonly appid: string;
  readonly me: MeDeps;
}

export interface SilentLoginInput {
  readonly loginCode: string;
  readonly device?: DeviceInfo | undefined;
}

export interface PhoneLoginInput {
  readonly loginCode: string;
  readonly phoneCode: string;
  readonly consents: readonly ConsentInput[];
  readonly consentScene?: PhoneLoginConsentScene | undefined;
  readonly attribution?: Attribution | undefined;
  readonly device?: DeviceInfo | undefined;
}

export interface PhoneLoginOptions {
  /**
   * code2Session 之后、换手机号之前调一次：接口层在这里按 openid 限流（每 openid 5 次 / 小时，约定 C68）。
   * 给的是 openid 的 HMAC（十六进制），不是 openid 本身。抛错即中止登录，手机号的 code 还没用掉。
   */
  readonly onOpenid?: (openidKey: string) => Promise<void>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAINLAND_MOBILE = /^1\d{10}$/;

/** 回滚登录事务、另起事务记一行 reverify_required 的信号：只在本文件里抛与接 */
class ReverifyNeeded extends Error {
  constructor(readonly merchantUserId: string) {
    super("休眠保护：需人工核实");
    this.name = "ReverifyNeeded";
  }
}

/** 外呼的结果翻成登录的两个码：明确拒绝是 code 无效；没配置、不支持、连不上都算服务不可用 */
async function exchange<T>(call: Promise<ProviderResult<T>>): Promise<T> {
  const result = await call;
  if (result.ok) return result.value;
  throw new AppError(result.reason === "rejected" ? "WECHAT_CODE_INVALID" : "WECHAT_UNAVAILABLE");
}

/**
 * openid 的 HMAC 快照（32 字节）：同意记录与限流键用，不存 openid 明文之外的第二份。
 * 密钥环里没有 openid 专用的用途：借 uscc 那把盲索引密钥，输入加 OPENID: 前缀分域
 *（十六进制大写，过 uscc 的归一化不变；信用代码里没有冒号，两类输入撞不上）。只是证据快照，不用于查找。
 */
export function openidHmac(keyring: Keyring, appid: string, openid: string): Buffer<ArrayBuffer> {
  const hex = Buffer.from(`${appid}\n${openid}`, "utf8").toString("hex").toUpperCase();
  return blindIndex(keyring, "uscc", `OPENID:${hex}`);
}

const merchantCtx = (merchantUserId: string, meta: RequestMeta): IdentityContext =>
  createIdentityContext({
    actor: { type: "merchant", id: merchantUserId, client: "weapp" },
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

/** 登录成功的收尾：会话（含上限）、auth_event、埋点。调用方已锁住微信身份行 */
async function finishLogin(
  tx: Tx,
  deps: LoginDeps,
  now: Date,
  meta: RequestMeta,
  input: {
    merchantUserId: string;
    wechatIdentityId: string;
    method: "silent" | "phone";
    device: DeviceInfo | undefined;
  },
): Promise<string> {
  const session = await openSession(tx, now, {
    merchantUserId: input.merchantUserId,
    wechatIdentityId: input.wechatIdentityId,
    ip: meta.ip,
    deviceInfo: deviceSummary(input.device),
  });
  await recordAuthEvent(tx, {
    space: "merchant",
    subjectId: input.merchantUserId,
    event: "login_success",
    method: input.method,
    ip: meta.ip,
    userAgent: meta.userAgent,
    detail: {
      sessionId: session.sessionId,
      identityId: input.wechatIdentityId,
      requestId: meta.requestId,
    },
    at: now,
  });
  // 埋点直记：端口的实现随 M7，现在是空实现；失败不带累登录事务（外壳用保存点包住）
  await trackOf(deps.assembly).record(tx, {
    name: "login_success",
    props: { method: input.method },
    subject: { userId: input.merchantUserId },
  });
  return session.token;
}

// ---------- 静默登录 ----------

export async function silentLogin(
  deps: LoginDeps,
  meta: RequestMeta,
  input: SilentLoginInput,
): Promise<SilentLoginResult> {
  if (deps.wechat === null) throw new AppError("WECHAT_UNAVAILABLE");
  const session = await exchange(deps.wechat.code2Session({ code: input.loginCode }));
  const needPhone: SilentLoginResult = { needPhone: true, token: null, me: null };

  return deps.tx.run(async (tx) => {
    const now = deps.clock.now();
    const found = await tx.wechatIdentity.findUnique({
      where: { appid_openid: { appid: deps.appid, openid: session.openid } },
      select: { id: true, merchantUserId: true },
    });
    if (found === null) return needPhone;
    // 账号 → 微信身份：锁到之后再读一遍（等锁期间身份可能被改绑、移除，或被退出登录关掉静默登录）
    await lockRows(tx, "merchant_user", [found.merchantUserId], "update");
    const [lockedIdentity] = await lockRows(tx, "wechat_identity", [found.id], "update");
    if (lockedIdentity === undefined) return needPhone;
    const identity = await tx.wechatIdentity.findUnique({
      where: { id: found.id },
      select: {
        merchantUserId: true,
        silentLoginEnabled: true,
        unionid: true,
        merchantUser: { select: { status: true } },
      },
    });
    if (
      identity === null ||
      identity.merchantUserId !== found.merchantUserId ||
      !identity.silentLoginEnabled ||
      identity.merchantUser.status !== "active"
    ) {
      return needPhone;
    }

    await tx.merchantUser.update({
      where: { id: found.merchantUserId },
      data: { lastActiveAt: now, updatedAt: now },
    });
    await tx.wechatIdentity.update({
      where: { id: found.id },
      data: {
        lastLoginAt: now,
        lastActiveAt: now,
        updatedAt: now,
        ...(identity.unionid === null && session.unionid !== undefined
          ? { unionid: session.unionid }
          : {}),
      },
    });
    const token = await finishLogin(tx, deps, now, meta, {
      merchantUserId: found.merchantUserId,
      wechatIdentityId: found.id,
      method: "silent",
      device: input.device,
    });
    const me = await buildMeView(tx, deps.me, found.merchantUserId);
    return { needPhone: false, token, me };
  });
}

// ---------- 手机号登录 ----------

interface AccountRow {
  readonly id: string;
  readonly status: string;
  readonly phoneEnc: string;
  readonly phoneMask: string;
  readonly displayName: string | null;
  readonly lastActiveAt: Date;
  readonly dormantBypassUntil: Date | null;
}

/** 第 1 步：按手机号盲索引取账号；没有则建（ON CONFLICT DO NOTHING），返回是不是这次建的 */
async function findOrCreateAccount(
  tx: Tx,
  deps: LoginDeps,
  now: Date,
  phone: string,
  attribution: Attribution | undefined,
): Promise<{
  account: AccountRow;
  isNew: boolean;
  sourceType: SourceType;
  referralId: string | null;
}> {
  const sealed = sealPhone(deps.keyring(), "merchant_user.phone_enc", phone);
  const select = {
    id: true,
    status: true,
    phoneEnc: true,
    phoneMask: true,
    displayName: true,
    lastActiveAt: true,
    dormantBypassUntil: true,
    sourceType: true,
    sourceReferralCodeId: true,
  } as const;
  let isNew = false;
  let row = await tx.merchantUser.findUnique({ where: { phoneBidx: sealed.bidx }, select });
  if (row === null) {
    // 首触来源只在建号时写，之后不可改（trg_merchant_user_immutable）
    const hit = await deps.tenant.findActiveReferralCode(tx, {
      inviteCode: attribution?.inviteCode,
      channelCode: attribution?.channelCode,
    });
    const id = uuidv7();
    const created = await tx.merchantUser.createMany({
      data: [
        {
          id,
          phoneEnc: sealed.enc,
          phoneBidx: sealed.bidx,
          phoneMask: sealed.mask,
          phoneLast4: sealed.last4,
          status: "active",
          sourceType: hit?.sourceType ?? "organic",
          sourceChannelCode: attribution?.channelCode ?? null,
          sourceInviteCode: attribution?.inviteCode ?? null,
          sourceScene: attribution?.scene ?? null,
          sourceReferralCodeId: hit?.referralCodeId ?? null,
          lastActiveAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    isNew = created.count === 1;
    // 没插进去：同一手机号的另一个首次登录先建好了（它提交之后这条语句才返回），取它建的那一行
    row = await tx.merchantUser.findUnique({ where: { phoneBidx: sealed.bidx }, select });
  }
  if (row === null) throw new AppError("BUSY");
  await lockRows(tx, "merchant_user", [row.id], "update");
  // 锁到之后再看状态：等锁期间可能被后台禁用
  const status = isNew
    ? row.status
    : ((await tx.merchantUser.findUnique({ where: { id: row.id }, select: { status: true } }))
        ?.status ?? "deleted");
  if (status === "disabled") throw new AppError("ACCOUNT_DISABLED");
  if (status !== "active" || row.phoneEnc === null || row.phoneMask === null) {
    // 注销的账号手机号已清空，按盲索引查不到；走到这里是等锁期间被注销了：让端上重来一次（会建新号）
    throw new AppError("BUSY");
  }
  return {
    account: { ...row, status, phoneEnc: row.phoneEnc, phoneMask: row.phoneMask },
    isNew,
    sourceType: row.sourceType as SourceType,
    referralId: row.sourceReferralCodeId,
  };
}

/**
 * 第 2 步：休眠检查（D4 第 3.6 节）。此前没绑定到本账号的 openid 要绑上来时才查。
 * 五条放行条件命中即放行；都不满足即“已休眠”，M1 一律转人工核实（任务书的口径表）。
 */
function passesDormantGuard(input: {
  isNew: boolean;
  hasMembership: boolean;
  account: Pick<AccountRow, "lastActiveAt" | "dormantBypassUntil">;
  dormantDays: number;
  now: Date;
}): boolean {
  const { account, now, dormantDays } = input;
  if (input.isNew) return true;
  if (!input.hasMembership) return true;
  if (account.dormantBypassUntil !== null && account.dormantBypassUntil.getTime() > now.getTime()) {
    return true;
  }
  if (dormantDays === 0) return true;
  return account.lastActiveAt.getTime() >= now.getTime() - dormantDays * DAY_MS;
}

export async function phoneLogin(
  deps: LoginDeps,
  meta: RequestMeta,
  input: PhoneLoginInput,
  options: PhoneLoginOptions = {},
): Promise<PhoneLoginResult> {
  // ---------- 事务之外：外呼、限流、参数 ----------
  if (deps.wechat === null) throw new AppError("WECHAT_UNAVAILABLE");
  const session: WechatSession = await exchange(
    deps.wechat.code2Session({ code: input.loginCode }),
  );
  const openidSnapshot = openidHmac(deps.keyring(), deps.appid, session.openid);
  await options.onOpenid?.(openidSnapshot.toString("hex"));
  const { phone: rawPhone } = await exchange(deps.wechat.getPhoneNumber({ code: input.phoneCode }));
  const phone = normalizePhone(rawPhone);
  if (!MAINLAND_MOBILE.test(phone)) throw new AppError("PHONE_REGION_UNSUPPORTED");
  const dormantDays = await deps.config.params.get("auth.dormant_days");
  const scene = input.consentScene ?? "login";

  try {
    return await deps.tx.run(async (tx) => {
      const now = deps.clock.now();

      // 1. 取号或建号
      const { account, isNew, sourceType, referralId } = await findOrCreateAccount(
        tx,
        deps,
        now,
        phone,
        input.attribution,
      );
      const ctx = merchantCtx(account.id, meta);
      const membership = await deps.tenant.activeMembership(tx, account.id);

      // 2. 休眠检查：只在新绑定时
      const bound = await tx.wechatIdentity.findUnique({
        where: { appid_openid: { appid: deps.appid, openid: session.openid } },
        select: { id: true, merchantUserId: true, unionid: true },
      });
      if (bound !== null) await lockRows(tx, "wechat_identity", [bound.id], "update");
      const newBinding = bound === null || bound.merchantUserId !== account.id;
      if (
        newBinding &&
        !passesDormantGuard({
          isNew,
          hasMembership: membership !== null,
          account,
          dormantDays,
          now,
        })
      ) {
        throw new ReverifyNeeded(account.id);
      }

      // 3. 微信身份
      let identityId: string;
      let switchedFrom: PhoneLoginResult["switchedFrom"] = null;
      if (bound !== null && !newBinding) {
        identityId = bound.id;
        await tx.wechatIdentity.update({
          where: { id: bound.id },
          data: {
            silentLoginEnabled: true,
            lastLoginAt: now,
            lastActiveAt: now,
            updatedAt: now,
            ...(bound.unionid === null && session.unionid !== undefined
              ? { unionid: session.unionid }
              : {}),
          },
        });
      } else {
        if (bound !== null) {
          // 改绑：吊销它在原账号下的会话 → 删旧行（订阅额度随之级联删除）→ 下面插绑定本账号的新行
          const previous = await tx.merchantUser.findUnique({
            where: { id: bound.merchantUserId },
            select: { id: true, phoneMask: true },
          });
          const revoked = await revokeIdentitySessions(tx, now, bound.id, "identity_rebound");
          await tx.wechatIdentity.delete({ where: { id: bound.id } });
          await recordAuthEvent(tx, {
            space: "merchant",
            subjectId: bound.merchantUserId,
            event: "identity_rebound",
            method: "phone",
            ip: meta.ip,
            userAgent: meta.userAgent,
            detail: {
              identityId: bound.id,
              reboundTo: account.id,
              revokedSessions: revoked,
              requestId: meta.requestId,
            },
            at: now,
          });
          const previousMembership = await deps.tenant.activeMembership(tx, bound.merchantUserId);
          if (previousMembership !== null && previous?.phoneMask) {
            switchedFrom = { phoneMask: previous.phoneMask };
          }
        }
        identityId = uuidv7();
        const inserted = await tx.wechatIdentity.createMany({
          data: [
            {
              id: identityId,
              merchantUserId: account.id,
              appid: deps.appid,
              openid: session.openid,
              unionid: session.unionid ?? null,
              silentLoginEnabled: true,
              lastLoginAt: now,
              lastActiveAt: now,
              createdAt: now,
              updatedAt: now,
            },
          ],
          skipDuplicates: true,
        });
        // 同一个 openid 正被另一个账号的登录绑走：少见，让端上重试，重试时按“绑定在别的账号上”走改绑
        if (inserted.count !== 1) throw new AppError("BUSY");
      }

      // 4. 新绑定、本账号还有别的微信身份、且有有效成员关系：审计与事件（一次性提示由订阅者写，随 M2）
      if (newBinding && membership !== null) {
        const others = await tx.wechatIdentity.count({
          where: { merchantUserId: account.id, NOT: { id: identityId } },
        });
        if (others > 0) {
          await recordAudit(
            tx,
            ctx.actor,
            {
              requestId: meta.requestId,
              ip: meta.ip,
              userAgent: meta.userAgent,
              authMethod: "weapp",
              sessionId: null,
            },
            {
              stream: "ops",
              category: "account_security",
              action: "identity.wechat_identity.bind",
              summary: "新微信绑定",
              target: { type: "merchant_user", id: account.id, label: account.phoneMask },
              entityId: membership.entityId,
            },
          );
          await deps.events.emit(tx, ctx, {
            type: "merchant_user.wechat_bound",
            aggregate: { type: "merchant_user", id: account.id },
            payload: { v: 1, merchantUserId: account.id, wechatIdentityId: identityId },
          });
        }
      }

      // 5. 同意：每份协议一行；用户级协议没齐即 428（整个事务回滚，账号也不建）
      const operatorName = membership?.displayName ?? account.displayName;
      const consent = await deps.docs.assertConsents(tx, ctx, {
        scene,
        consents: input.consents,
        method: "checkbox",
        signer: {
          merchantUserId: account.id,
          phoneEnc: account.phoneEnc,
          phoneMask: account.phoneMask,
          operatorNameMask: operatorName ? maskName(operatorName) : null,
          role: membership?.role ?? null,
          appid: deps.appid,
          openidHmac: openidSnapshot,
        },
        device: {
          ...input.device,
          ...(meta.clientVersion === null ? {} : { appVersion: meta.clientVersion }),
        },
      });
      if (!consent.complete) {
        throw new AppError("CONSENT_REQUIRED", {
          details: { pendingConsents: consent.pendingConsents },
        });
      }
      await tx.merchantUser.update({
        where: { id: account.id },
        data: { consentStamp: consent.stamp, lastActiveAt: now, updatedAt: now },
      });

      // 新建的账号：— → active 的迁移（守卫“协议已同意”此刻已满足），发 merchant_user.registered
      if (isNew) {
        const args: RegisterArgs = { consentComplete: consent.complete };
        await deps.flow.transition(tx, ctx, {
          machine: "merchant_user",
          stateField: "status",
          id: account.id,
          event: "merchant_user.register",
          created: true,
          entityId: null,
          storeId: null,
          args,
          audit: {
            stream: "ops",
            category: "account_security",
            action: "identity.merchant_user.register",
            summary: "首次手机号登录，建商家账号",
            target: { type: "merchant_user", id: account.id, label: account.phoneMask },
          },
          emit: {
            type: "merchant_user.registered",
            payload: {
              v: 1,
              merchantUserId: account.id,
              via: "phone_login",
              sourceType,
              sourceReferralCodeId: referralId,
            },
          },
        });
      }

      // 6. 会话、auth_event、埋点
      const token = await finishLogin(tx, deps, now, meta, {
        merchantUserId: account.id,
        wechatIdentityId: identityId,
        method: "phone",
        device: input.device,
      });
      const me = await buildMeView(tx, deps.me, account.id);
      return { token, me, isNewUser: isNew, switchedFrom };
    });
  } catch (error) {
    if (!(error instanceof ReverifyNeeded)) throw error;
    // 登录事务已回滚（不绑定、不发会话）：另起一个事务只记这一行，再回 REVERIFY_REQUIRED
    await deps.tx.run((tx) =>
      recordAuthEvent(tx, {
        space: "merchant",
        subjectId: error.merchantUserId,
        event: "reverify_required",
        method: "phone",
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { requestId: meta.requestId },
        at: deps.clock.now(),
      }),
    );
    throw new AppError("REVERIFY_REQUIRED");
  }
}
